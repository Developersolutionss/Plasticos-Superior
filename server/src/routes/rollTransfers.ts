import { Router } from "express";
import { z } from "zod";
import type { Prisma, ProductionRoll } from "../generated/prisma/client";
import { prisma } from "../prisma";
import { requireAuth, requireRole, ROLES, OPERARIO_STATIONS } from "../middleware/auth";
import {
  DERIVATIONS,
  OpStation,
  ROLL_CODE_PREFIX,
  STATION_LABELS,
  WAREHOUSE_LABELS,
  rollProducedKg,
  transferDestinations,
  warehousePhrase,
  type RollWarehouse,
} from "../services/opTemplates";
import { adjustRollBalance, remainingSourceKg } from "../services/rollBalance";
import { verifyPossessionToken } from "../services/rollPossessionToken";
import { checkRateLimit } from "../services/rateLimiter";
import { rollWhereFromCode } from "../services/rollCode";
import { localDayBoundary } from "../services/dateRange";
import { getRollLocation } from "../services/rollLocation";
import { notifyRoles } from "../services/notify";

/**
 * Despacho de rollos entre las bodegas internas de planta (ver
 * docs/notas-pendientes-raw.md, "Recibidas 2026-09-22": "3 bodegas
 * (sellado, pre-corte, impresion), debe haber un registro de que operario y
 * camionero lo recibe y registra"). Dos pasos, los dos escaneando el QR del
 * rollo (código + token de posesión — transportar es una operación que
 * exige tener el rollo en la mano, igual que consumirlo):
 *
 * 1. Salida (POST /): en la estación de origen. O el operario escanea y
 *    tipea a quién se lo entrega (`entrega`), o quien se lo lleva lo escanea
 *    con su propia cuenta (`retiro`).
 * 2. Recepción (POST /:id/receive): el operario de la bodega destino escanea
 *    el mismo QR cuando le llega.
 */
export const rollTransfersRouter = Router();
rollTransfersRouter.use(requireAuth);
rollTransfersRouter.use(requireRole(...ROLES.DESPACHO_BODEGAS));

const requireProduccionGestion = requireRole(...ROLES.PRODUCCION_GESTION);

const STATIONS = ["extrusion", "impresion", "sellado", "precorte"] as const;
/** Las bodegas donde puede estar un rollo: la de cada estación y la principal. */
const WAREHOUSES = [...STATIONS, "principal"] as const;

/** Mismo límite que la verificación de token en productionOrders.ts, con su
 * propia clave -- un loop acá no le come el cupo al operario en su OP. */
function checkTransferRateLimit(userId: number): boolean {
  return checkRateLimit(`roll-transfer-token:${userId}`, 50, 60_000);
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Zona horaria del celular que escanea (`Intl...resolvedOptions().timeZone`
 * y `-getTimezoneOffset()`). La hora en sí la pone el servidor: el reloj de
 * un celular puede estar mal, su zona horaria es solo para mostrarla. */
const clientClockSchema = {
  clientTimezone: z.string().trim().min(1).max(64).refine(isValidTimeZone, "Zona horaria del celular inválida"),
  clientUtcOffsetMinutes: z.number().int().min(-840).max(840),
};

/**
 * Nombre de quien se lleva el rollo, tipeado a mano en modo `entrega`: se
 * guarda siempre con la misma forma (espacios de más afuera, cada palabra con
 * mayúscula inicial) para que "juan  camionero" y "Juan Camionero" no queden
 * como dos transportistas distintos en el historial. Ver también
 * GET /carriers, que le sugiere a la pantalla los nombres ya usados.
 */
function normalizeCarrierName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("es")
    .replace(/(^|[\s'-])(\p{L})/gu, (_m, sep: string, letter: string) => sep + letter.toLocaleUpperCase("es"));
}

/** Diferencia máxima (kg) entre lo que salió y lo que pesó al llegar antes de
 * avisarle a Gestión — por debajo de esto es ruido de balanza. */
const RECEIVE_WEIGHT_TOLERANCE_KG = 0.5;

/** Si el peso medido al recibir difiere de lo despachado más que esto
 * (5 kg o 10%, lo mayor), probablemente es un error de tipeo (478 en vez de
 * 47,8): no se ajusta el saldo, solo se registra y se avisa a Gestión para
 * que lo verifique con un conteo. */
function receiveAutoAdjustLimitKg(dispatchedKg: number): number {
  return Math.max(5, dispatchedKg * 0.1);
}

function rollCode(roll: { station: string; stationSequence: number }): string {
  return `${ROLL_CODE_PREFIX[roll.station as OpStation]}-${roll.stationSequence}`;
}

const transferInclude = {
  roll: {
    select: {
      id: true,
      station: true,
      stationSequence: true,
      weightKg: true,
      productionOrder: { select: { id: true, orderNumber: true, product: { select: { name: true, sku: true } } } },
    },
  },
  registeredBy: { select: { name: true } },
  receivedBy: { select: { name: true } },
} satisfies Prisma.RollTransferInclude;

/** Agrega el código legible (`EXT-9`) para que la UI no tenga que armarlo. */
function withRollCode<T extends { roll: { station: string; stationSequence: number } }>(transfer: T) {
  return { ...transfer, rollCode: rollCode(transfer.roll) };
}

/** Unión discriminada explícita en vez de dejar que TS infiera el retorno de
 * los `return` sueltos de abajo -- sin esto, el compilador no reduce bien
 * `result.error` a definido dentro de cada `if ("error" in result)` de los
 * call sites (TS18048), aunque en runtime nunca puede faltar. */
type ScannedRollResult = { error: { status: number; error: string } } | { roll: ProductionRoll };

/**
 * Busca el rollo escaneado y verifica su token de posesión. Devuelve el
 * rollo o la respuesta de error ya armada ({ status, error }).
 */
async function resolveScannedRoll(code: string, token: string, userId: number): Promise<ScannedRollResult> {
  code = code.trim().toUpperCase();
  token = token.trim().toUpperCase();
  const where = rollWhereFromCode(code);
  if (!where) return { error: { status: 400, error: "Código de rollo inválido" } } as const;
  const roll = await prisma.productionRoll.findUnique({ where });
  if (!roll) return { error: { status: 404, error: "Rollo no encontrado" } } as const;
  if (!checkTransferRateLimit(userId)) {
    return { error: { status: 429, error: "Demasiados escaneos seguidos — esperá un momento y volvé a intentar" } } as const;
  }
  if (!token || !verifyPossessionToken(rollCode(roll), token, roll.possessionTokenHash)) {
    return {
      error: { status: 403, error: `Falta demostrar posesión física del rollo ${rollCode(roll)} — escaneá el QR de su etiqueta` },
    } as const;
  }
  return { roll } as const;
}

/** Un operario solo recibe en la bodega de SU estación; gestión/almacén en cualquiera. */
function canReceiveAt(role: string, station: string): boolean {
  const allowed = OPERARIO_STATIONS[role as keyof typeof OPERARIO_STATIONS];
  return !allowed || allowed.includes(station);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Historial de despachos, lo más nuevo primero. Filtros opcionales:
 * status, toStation, fromStation, from/to (YYYY-MM-DD). */
rollTransfersRouter.get("/", async (req, res) => {
  const { status, toStation, fromStation, from, to } = req.query as Record<string, string | undefined>;
  if (status && status !== "en_transito" && status !== "recibido") return res.status(400).json({ error: "Estado inválido" });
  for (const s of [toStation, fromStation]) {
    if (s && !(WAREHOUSES as readonly string[]).includes(s)) return res.status(400).json({ error: "Estación inválida" });
  }
  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) {
    return res.status(400).json({ error: "Fecha inválida (formato YYYY-MM-DD)" });
  }

  const transfers = await prisma.rollTransfer.findMany({
    where: {
      status: status as "en_transito" | "recibido" | undefined,
      toStation: toStation as RollWarehouse | undefined,
      fromStation: fromStation as RollWarehouse | undefined,
      createdAt: from || to ? { gte: from ? localDayBoundary(from, false) : undefined, lte: to ? localDayBoundary(to, true) : undefined } : undefined,
    },
    orderBy: { id: "desc" },
    take: 300,
    include: transferInclude,
  });
  res.json(transfers.map(withRollCode));
});

/** Rollos parados en una bodega por más de estos días se marcan en el
 * inventario (rollo que nadie está usando). */
const STALE_DAYS = 7;
/** Un despacho en camino por más de estas horas se marca (nadie lo recibió). */
const STALE_TRANSIT_HOURS = 24;

const OPEN_ORDER_STATUSES = ["pendiente", "en_proceso"] as const;

/**
 * A qué estaciones tiene OP derivada ABIERTA cada una de estas OPs — es a
 * donde está esperando material, y es lo que la pantalla usa para sugerir el
 * destino de un despacho (y "Pendiente de despachar a…" en el inventario).
 */
async function expectingStationsByOrder(orderIds: number[]): Promise<Map<number, OpStation[]>> {
  const children = orderIds.length
    ? await prisma.productionOrder.findMany({
        where: { parentOrderId: { in: orderIds }, status: { in: [...OPEN_ORDER_STATUSES] }, station: { not: null } },
        select: { parentOrderId: true, station: true },
        orderBy: { id: "asc" },
      })
    : [];
  const map = new Map<number, OpStation[]>();
  for (const c of children) {
    const list = map.get(c.parentOrderId!) ?? [];
    if (!list.includes(c.station as OpStation)) list.push(c.station as OpStation);
    map.set(c.parentOrderId!, list);
  }
  return map;
}

/** "Material para" (IMPRESION/SELLADO/PRECORTE) de la OP, como estación. */
function materialParaStation(specs: unknown): OpStation | null {
  const v = (specs as any)?.materialPara;
  const map: Record<string, OpStation> = { IMPRESION: "impresion", SELLADO: "sellado", PRECORTE: "precorte" };
  return typeof v === "string" ? map[v.toUpperCase()] ?? null : null;
}

/**
 * Inventario de las bodegas: qué rollos hay HOY en cada una (Extrusión,
 * Impresión, Sellado, Precorte y la bodega principal), con su saldo, desde
 * cuándo están ahí, y cuáles están en camino.
 *
 * - Rollos que alimentan a otra estación (salidos de Extrusión o Impresión,
 *   ver DERIVATIONS): los que todavía tienen saldo.
 * - Rollos terminados (de Sellado y Precorte, y los de Impresión que no
 *   alimentan nada): mientras no hayan salido hacia un cliente. Nacen en la
 *   bodega de su estación y vuelven en camión a la bodega principal
 *   (`finished: true`); de ahí salen los despachos a clientes.
 */
rollTransfersRouter.get("/inventory", async (_req, res) => {
  const feeding = (STATIONS as readonly OpStation[]).filter((s) => DERIVATIONS[s].length > 0);
  const terminadas = STATIONS.filter((s) => DERIVATIONS[s].length === 0);
  const rolls = await prisma.productionRoll.findMany({
    where: {
      OR: [
        { station: { in: feeding } },
        // Producto terminado que todavía no salió hacia un cliente (un
        // despacho cancelado lo libera, igual que en Despachos).
        { station: { in: [...terminadas] }, dispatchItems: { none: { dispatchItem: { dispatch: { status: { not: "cancelada" } } } } } },
      ],
    },
    select: {
      id: true,
      station: true,
      stationSequence: true,
      label: true,
      weightKg: true,
      details: true,
      createdAt: true,
      productionOrderId: true,
      // Para quién es (la OP guarda el cliente destino): la bodega lo ve en
      // cada rollo y nadie lo toma como material de stock.
      productionOrder: { select: { id: true, orderNumber: true, product: { select: { name: true, sku: true } }, client: { select: { id: true, name: true } } } },
      transfers: {
        orderBy: { id: "desc" },
        take: 1,
        select: { id: true, status: true, fromStation: true, toStation: true, carrierName: true, createdAt: true, receivedAt: true, dispatchedKg: true },
      },
    },
    orderBy: [{ station: "asc" }, { stationSequence: "asc" }],
  });
  const ids = rolls.map((r) => r.id);
  const [consumed, adjusted, counts] = await Promise.all([
    prisma.rollConsumption.groupBy({ by: ["sourceRollId"], where: { sourceRollId: { in: ids } }, _sum: { quantityKg: true } }),
    prisma.rollAdjustment.groupBy({ by: ["rollId"], where: { rollId: { in: ids } }, _sum: { deltaKg: true } }),
    prisma.rollAdjustment.findMany({
      where: { rollId: { in: ids }, reason: "conteo" },
      orderBy: { id: "desc" },
      distinct: ["rollId"],
      select: { rollId: true, createdAt: true, newKg: true, createdBy: { select: { name: true } } },
    }),
  ]);
  const consumedBy = new Map(consumed.map((c) => [c.sourceRollId, Number(c._sum.quantityKg ?? 0)]));
  const adjustedBy = new Map(adjusted.map((a) => [a.rollId, Number(a._sum.deltaKg ?? 0)]));
  const lastCountBy = new Map(counts.map((c) => [c.rollId, c]));
  const expectingBy = await expectingStationsByOrder([...new Set(rolls.map((r) => r.productionOrderId))]);
  const now = Date.now();
  const DAY = 86_400_000;

  const stock: Record<string, any[]> = Object.fromEntries((WAREHOUSES as readonly string[]).map((s) => [s, []]));
  const inTransit: any[] = [];
  for (const r of rolls) {
    const finished = DERIVATIONS[r.station as OpStation].length === 0;
    // Un rollo terminado no se consume: su "saldo" es lo que produjo.
    const remainingKg = finished
      ? Math.round(rollProducedKg(r.station as OpStation, r) * 100) / 100
      : Math.round((Number(r.weightKg) - (consumedBy.get(r.id) ?? 0) + (adjustedBy.get(r.id) ?? 0)) * 100) / 100;
    if (remainingKg <= 0.005) continue;
    const last = r.transfers[0];
    const base = {
      rollId: r.id,
      code: rollCode(r),
      label: r.label,
      weightKg: Number(r.weightKg),
      remainingKg,
      finished,
      productionOrder: r.productionOrder,
      lastCount: lastCountBy.get(r.id) ?? null,
    };
    if (last?.status === "en_transito") {
      const hours = Math.floor((now - last.createdAt.getTime()) / 3_600_000);
      inTransit.push({
        ...base,
        transferId: last.id,
        fromStation: last.fromStation,
        toStation: last.toStation,
        carrierName: last.carrierName,
        since: last.createdAt,
        hours,
        stale: hours >= STALE_TRANSIT_HOURS,
        dispatchedKg: last.dispatchedKg != null ? Number(last.dispatchedKg) : null,
      });
      continue;
    }
    const station: RollWarehouse = last?.status === "recibido" ? last.toStation : (r.station as OpStation);
    const since = last?.status === "recibido" && last.receivedAt ? last.receivedAt : r.createdAt;
    const days = Math.floor((now - since.getTime()) / DAY);
    // A dónde lo están esperando: OP derivada abierta de su OP en otra
    // estación (si ya está en esa bodega, no hace falta despacharlo).
    const pendingTo = finished
      ? []
      : (expectingBy.get(r.productionOrderId) ?? []).filter((s) => s !== station && DERIVATIONS[r.station as OpStation].includes(s));
    stock[station].push({
      ...base,
      since,
      days,
      // En la bodega principal esperar al cliente es normal: no es "parado".
      stale: station !== "principal" && days >= STALE_DAYS,
      pendingTo,
      // Terminado y todavía en la bodega de su estación: falta que un camión
      // lo devuelva a la bodega principal.
      pendingReturn: finished && station !== "principal",
    });
  }

  const warehouses = (WAREHOUSES as readonly RollWarehouse[]).map((station) => {
    const items = stock[station].sort((a, b) => b.days - a.days);
    const transit = inTransit.filter((t) => t.toStation === station);
    return {
      station,
      label: WAREHOUSE_LABELS[station],
      rollCount: items.length,
      totalKg: Math.round(items.reduce((acc, i) => acc + i.remainingKg, 0) * 100) / 100,
      staleCount: items.filter((i) => i.stale).length,
      pendingReturnCount: items.filter((i) => i.pendingReturn).length,
      inTransitCount: transit.length,
      staleTransitCount: transit.filter((t) => t.stale).length,
      inTransitKg: Math.round(transit.reduce((acc, t) => acc + t.remainingKg, 0) * 100) / 100,
      items,
    };
  });
  res.json({ staleDays: STALE_DAYS, staleTransitHours: STALE_TRANSIT_HOURS, warehouses, inTransit: inTransit.sort((a, b) => b.hours - a.hours) });
});

const countSchema = z.object({
  /** Lo que se pesó/contó en la bodega (kg). 0 = el rollo ya no está. */
  countedKg: z.number().min(0).max(100000),
  notes: z.string().trim().min(3, "Escribí el motivo del ajuste (ej. pesaje de inventario)").max(500),
});

/**
 * Ajuste por conteo físico (solo Gestión): el saldo del rollo pasa a ser lo
 * que se pesó en la bodega. Queda registrado con el saldo anterior, la
 * diferencia, quién y por qué (y en Auditoría). No se puede ajustar un rollo
 * en camino: primero hay que recibirlo.
 */
rollTransfersRouter.post("/rolls/:rollId/count", requireProduccionGestion, async (req, res) => {
  const rollId = Number(req.params.rollId);
  if (!Number.isInteger(rollId)) return res.status(400).json({ error: "Id inválido" });
  const parsed = countSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const roll = await prisma.productionRoll.findUnique({ where: { id: rollId }, select: { id: true, station: true, stationSequence: true } });
  if (!roll) return res.status(404).json({ error: "Rollo no encontrado" });
  if (DERIVATIONS[roll.station as OpStation].length === 0) {
    return res.status(400).json({ error: `Los rollos de ${STATION_LABELS[roll.station as OpStation]} son producto terminado — no se ajustan acá` });
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM production_rolls WHERE id = ${rollId} FOR UPDATE`;
    const location = await getRollLocation(tx, roll);
    if (location.status === "en_transito") return { error: `El rollo ${rollCode(roll)} está en camino a ${warehousePhrase(location.toStation)} — primero hay que recibirlo` };
    const adj = await adjustRollBalance(tx, {
      rollId,
      newKg: parsed.data.countedKg,
      reason: "conteo",
      createdById: req.user!.userId,
      notes: parsed.data.notes,
    });
    return { adj, station: location.station };
  });
  if ("error" in result) return res.status(400).json({ error: result.error });
  res.status(201).json({
    rollId,
    code: rollCode(roll),
    station: result.station,
    previousKg: result.adj.previousKg,
    newKg: result.adj.newKg,
    deltaKg: result.adj.deltaKg,
  });
});

/** Nombres de transportistas ya usados (los más recientes primero), para que
 * la pantalla los sugiera al despachar en modo `entrega` en vez de que cada
 * operario los tipee a su manera. */
rollTransfersRouter.get("/carriers", async (_req, res) => {
  const rows = await prisma.rollTransfer.groupBy({
    by: ["carrierName"],
    _max: { createdAt: true },
    orderBy: { _max: { createdAt: "desc" } },
    take: 50,
  });
  res.json(rows.map((r) => r.carrierName));
});

/** El último transportista que registró esta cuenta en modo "entrega" — la
 * pantalla lo precarga (editable) en vez de pedirlo de cero cada vez. */
rollTransfersRouter.get("/carriers/last-mine", async (req, res) => {
  const last = await prisma.rollTransfer.findFirst({
    where: { registeredById: req.user!.userId, mode: "entrega" },
    orderBy: { id: "desc" },
    select: { carrierName: true },
  });
  res.json({ carrierName: last?.carrierName ?? null });
});

/**
 * Lo que la pantalla necesita saber apenas se escanea un rollo: qué es,
 * cuánto le queda, a qué bodegas puede ir y si ya hay un despacho en
 * tránsito (en cuyo caso lo que corresponde es recibirlo, no despacharlo de
 * nuevo). Exige el token ya acá para avisar de un QR trucho antes de llenar
 * el formulario; POST / y /:id/receive lo vuelven a verificar.
 */
rollTransfersRouter.get("/scan/:code", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const result = await resolveScannedRoll(req.params.code, token, req.user!.userId);
  if ("error" in result) return res.status(result.error.status).json({ error: result.error.error });
  const { roll } = result;

  const [detail, remainingKg, openTransfer, lastTransfer] = await Promise.all([
    prisma.productionRoll.findUniqueOrThrow({
      where: { id: roll.id },
      select: {
        id: true,
        station: true,
        stationSequence: true,
        weightKg: true,
        operatorName: true,
        date: true,
        productionOrder: {
          select: { id: true, orderNumber: true, specs: true, product: { select: { name: true, sku: true } }, client: { select: { id: true, name: true } } },
        },
      },
    }),
    remainingSourceKg(prisma, roll.id),
    prisma.rollTransfer.findFirst({ where: { rollId: roll.id, status: "en_transito" }, orderBy: { id: "desc" }, include: transferInclude }),
    prisma.rollTransfer.findFirst({ where: { rollId: roll.id }, orderBy: { id: "desc" }, include: transferInclude }),
  ]);

  // Sin la bodega donde ya está (ver el mismo chequeo en POST /).
  const destinations = transferDestinations(roll.station as OpStation).filter(
    (s) => s !== (lastTransfer?.status === "recibido" ? lastTransfer.toStation : roll.station)
  );
  const expecting = (await expectingStationsByOrder([detail.productionOrder.id])).get(detail.productionOrder.id) ?? [];
  const { specs, ...orderWithoutSpecs } = detail.productionOrder;
  res.json({
    roll: { ...detail, productionOrder: orderWithoutSpecs, code: rollCode(roll), remainingKg },
    destinations,
    // Para autocompletar el destino: a qué estaciones tiene OP abierta
    // esperando material la OP de este rollo, y su "Material para".
    expectingStations: expecting.filter((s) => destinations.includes(s)),
    // Ya está en la bodega principal: no hay a dónde mandarlo (de ahí sale al cliente).
    inMainWarehouse: (lastTransfer?.status === "recibido" ? lastTransfer.toStation : roll.station) === "principal",
    materialPara: materialParaStation(specs),
    openTransfer: openTransfer ? withRollCode(openTransfer) : null,
    lastTransfer: lastTransfer ? withRollCode(lastTransfer) : null,
  });
});

const createSchema = z
  .object({
    code: z.string().trim().min(1),
    token: z.string().trim().min(1),
    toStation: z.enum(WAREHOUSES),
    mode: z.enum(["entrega", "retiro"]),
    /** Solo en `entrega`: a quién se lo entrega el operario (lo tipea). */
    carrierName: z.string().trim().max(100).optional(),
    notes: z.string().trim().max(500).optional(),
    ...clientClockSchema,
  })
  .refine((d) => d.mode !== "entrega" || (d.carrierName?.length ?? 0) >= 2, {
    message: "Escribí el nombre de quien se lleva el rollo",
    path: ["carrierName"],
  });

/** Salida del rollo hacia la bodega de otra estación. */
rollTransfersRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  const result = await resolveScannedRoll(data.code, data.token, req.user!.userId);
  if ("error" in result) return res.status(result.error.status).json({ error: result.error.error });
  const { roll } = result;
  const code = rollCode(roll);

  // Solo hacia estaciones que de verdad procesan lo que sale de esta
  // (mismo mapa que la derivación de OPs): un rollo de Extrusión va a
  // Impresión/Sellado/Precorte, uno de Impresión a Sellado/Precorte.
  const destinations = transferDestinations(roll.station as OpStation);
  if (!destinations.includes(data.toStation)) {
    return res.status(400).json({
      error: destinations.length
        ? `Un rollo de ${STATION_LABELS[roll.station as OpStation]} solo se despacha a ${destinations.map((s) => WAREHOUSE_LABELS[s]).join(", ")}`
        : `Los rollos de ${STATION_LABELS[roll.station as OpStation]} no se despachan a otra bodega`,
    });
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.userId }, select: { name: true } });
  const carrierName = data.mode === "retiro" ? user.name : normalizeCarrierName(data.carrierName!);

  // El chequeo de "ya está en tránsito" va dentro de la transacción: dos
  // escaneos casi simultáneos del mismo QR (operario y camionero a la vez)
  // no deben dejar dos despachos abiertos del mismo rollo. Bloquear la fila
  // del rollo (mismo patrón que rollBalance.ts) serializa esa carrera.
  const created = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM production_rolls WHERE id = ${roll.id} FOR UPDATE`;
    const open = await tx.rollTransfer.findFirst({ where: { rollId: roll.id, status: "en_transito" }, include: transferInclude });
    if (open) return { open, transfer: null, error: null };
    // Dentro del lock, igual que el chequeo de arriba: un consumo que entra
    // justo ahora no debe dejar despachar un rollo que ya se agotó.
    const remainingKg = await remainingSourceKg(tx, roll.id);
    if (remainingKg <= 0) {
      return { open: null, transfer: null, error: `El rollo ${code} ya se consumió entero — no queda nada que despachar` };
    }
    // Sale de donde está AHORA (ver services/rollLocation.ts): la bodega del
    // último despacho recibido, o su estación de origen si nunca se movió --
    // no siempre de roll.station. (El caso "en tránsito" ya salió arriba.)
    const location = await getRollLocation(tx, roll);
    const fromStation = location.status === "en_bodega" ? location.station : roll.station;
    if (fromStation === data.toStation) {
      return { open: null, transfer: null, error: `El rollo ${code} ya está en ${warehousePhrase(data.toStation)}` };
    }
    const transfer = await tx.rollTransfer.create({
      data: {
        rollId: roll.id,
        fromStation,
        toStation: data.toStation,
        mode: data.mode,
        carrierName,
        registeredById: req.user!.userId,
        clientTimezone: data.clientTimezone,
        clientUtcOffsetMinutes: data.clientUtcOffsetMinutes,
        notes: data.notes || null,
        // Lo que sale es el saldo real del rollo en este momento (ya
        // bloqueado arriba), no su peso original: un rollo madre del que
        // Sellado ya sacó 20 kg sale con lo que le queda.
        dispatchedKg: remainingKg,
      },
      include: transferInclude,
    });
    return { open: null, transfer, error: null };
  });

  if (created.error) return res.status(400).json({ error: created.error });
  if (created.open) {
    return res.status(409).json({
      error: `El rollo ${code} ya salió hacia ${WAREHOUSE_LABELS[created.open.toStation]} (lo lleva ${created.open.carrierName}) y todavía no lo recibieron — primero tiene que recibirse allá`,
    });
  }
  res.status(201).json(withRollCode(created.transfer!));
});

const receiveSchema = z.object({
  code: z.string().trim().min(1),
  token: z.string().trim().min(1),
  notes: z.string().trim().max(500).optional(),
  /** Peso que marcó la balanza de la bodega destino (opcional). */
  receivedKg: z.number().positive().max(100000).optional(),
  ...clientClockSchema,
});

/** Recepción en la bodega destino: el operario escanea el QR del rollo que le llegó. */
rollTransfersRouter.post("/:id/receive", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido" });
  const parsed = receiveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  const transfer = await prisma.rollTransfer.findUnique({ where: { id } });
  if (!transfer) return res.status(404).json({ error: "Despacho no encontrado" });

  const result = await resolveScannedRoll(data.code, data.token, req.user!.userId);
  if ("error" in result) return res.status(result.error.status).json({ error: result.error.error });
  if (result.roll.id !== transfer.rollId) {
    return res.status(400).json({ error: "El QR escaneado no es el del rollo de este despacho" });
  }
  if (!canReceiveAt(req.user!.role, transfer.toStation)) {
    return res.status(403).json({ error: `Este rollo va para ${warehousePhrase(transfer.toStation)} — lo tiene que recibir ${transfer.toStation === "principal" ? "Almacén o Gestión" : "un operario de allá"}` });
  }

  const received = await prisma.$transaction(async (tx) => {
    // Mismo lock que el despacho y el consumo: el saldo que se corrige abajo
    // no puede cambiar entre la lectura y el ajuste.
    await tx.$queryRaw`SELECT id FROM production_rolls WHERE id = ${transfer.rollId} FOR UPDATE`;
    // updateMany con el estado en el where: si dos personas lo reciben a la
    // vez, solo una "gana" y la otra se entera, en vez de pisarse.
    const updated = await tx.rollTransfer.updateMany({
      where: { id, status: "en_transito" },
      data: {
        status: "recibido",
        receivedById: req.user!.userId,
        receivedAt: new Date(),
        receivedTimezone: data.clientTimezone,
        receivedUtcOffsetMinutes: data.clientUtcOffsetMinutes,
        receivedKg: data.receivedKg,
        ...(data.notes ? { notes: transfer.notes ? `${transfer.notes}\nRecepción: ${data.notes}` : `Recepción: ${data.notes}` } : {}),
      },
    });
    if (updated.count === 0) return null;
    // Lo que pesó al llegar es lo que hay en la bodega (decisión de Gestión,
    // 2026-10-02): el saldo del rollo pasa a ser ese peso, registrado como un
    // ajuste con su historial. El peso original del rollo no se toca. Salvo
    // una diferencia demasiado grande (ver receiveAutoAdjustLimitKg).
    let balanceAdjusted = false;
    // Un rollo terminado no se consume: su peso es lo que produjo, y es el
    // que va al despacho del cliente. Se registra lo que marcó la balanza (y
    // se avisa la diferencia) pero no se corrige un saldo que no existe.
    const finishedRoll = DERIVATIONS[result.roll.station as OpStation].length === 0;
    if (data.receivedKg != null && !finishedRoll) {
      const current = await remainingSourceKg(tx, transfer.rollId);
      const reference = transfer.dispatchedKg != null ? Number(transfer.dispatchedKg) : current;
      const tooFar = Math.abs(data.receivedKg - reference) > receiveAutoAdjustLimitKg(reference);
      if (!tooFar && Math.abs(current - data.receivedKg) > 0.005) {
        balanceAdjusted = true;
        await adjustRollBalance(tx, {
          rollId: transfer.rollId,
          newKg: data.receivedKg,
          reason: "recepcion",
          transferId: id,
          createdById: req.user!.userId,
          notes: data.notes ?? null,
        });
      }
    }
    return { balanceAdjusted };
  });
  if (!received) return res.status(409).json({ error: "Este despacho ya fue recibido" });

  const full = await prisma.rollTransfer.findUniqueOrThrow({ where: { id }, include: transferInclude });
  const balanceNotAdjusted =
    DERIVATIONS[result.roll.station as OpStation].length > 0 &&
    data.receivedKg != null && full.dispatchedKg != null && Math.abs(data.receivedKg - Number(full.dispatchedKg)) > receiveAutoAdjustLimitKg(Number(full.dispatchedKg));
  const response = { ...withRollCode(full), balanceAdjusted: received.balanceAdjusted, balanceNotAdjusted };

  // Llegó con otro peso del que salió: se registra igual (la recepción es un
  // hecho físico) pero se le avisa a Gestión — es justo el desbalance de
  // kilos entre bodegas que antes no quedaba en ningún lado.
  if (data.receivedKg != null && full.dispatchedKg != null) {
    const diff = Math.round((data.receivedKg - Number(full.dispatchedKg)) * 100) / 100;
    if (Math.abs(diff) > RECEIVE_WEIGHT_TOLERANCE_KG) {
      await notifyRoles(ROLES.PRODUCCION_GESTION, {
        type: "despacho_diferencia_peso",
        message:
          `El rollo ${response.rollCode} salió de ${WAREHOUSE_LABELS[full.fromStation]} con ${Number(full.dispatchedKg)} kg y llegó a ${WAREHOUSE_LABELS[full.toStation]} con ${data.receivedKg} kg (${diff > 0 ? "+" : ""}${diff} kg). Lo llevó ${full.carrierName}.` +
          (balanceNotAdjusted ? " La diferencia es demasiado grande: NO se ajustó el saldo — verificalo con un conteo en Inventario de bodegas." : ""),
        link: "/produccion/despacho-bodegas",
      });
    }
  }
  res.json(response);
});

/** Anula un despacho registrado por error (solo Gestión). Solo mientras está
 * en tránsito: uno ya recibido es la constancia de quién lo recibió y
 * cuándo, y borrarlo borraría esa historia. */
rollTransfersRouter.delete("/:id", requireProduccionGestion, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido" });
  const transfer = await prisma.rollTransfer.findUnique({ where: { id } });
  if (!transfer) return res.status(404).json({ error: "Despacho no encontrado" });
  if (transfer.status !== "en_transito") {
    return res.status(400).json({ error: "No se puede anular un despacho que ya fue recibido" });
  }
  await prisma.rollTransfer.delete({ where: { id } });
  res.status(204).end();
});
