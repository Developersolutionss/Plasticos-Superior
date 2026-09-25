import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client";
import { prisma } from "../prisma";
import { requireAuth, requireRole, ROLES, OPERARIO_STATIONS } from "../middleware/auth";
import { DERIVATIONS, OpStation, ROLL_CODE_PREFIX, STATION_LABELS } from "../services/opTemplates";
import { remainingSourceKg } from "../services/rollBalance";
import { verifyPossessionToken } from "../services/rollPossessionToken";
import { checkRateLimit } from "../services/rateLimiter";
import { rollWhereFromCode } from "../services/rollCode";

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

/**
 * Busca el rollo escaneado y verifica su token de posesión. Devuelve el
 * rollo o la respuesta de error ya armada ({ status, error }).
 */
async function resolveScannedRoll(code: string, token: string, userId: number) {
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

/** Límite de un día "YYYY-MM-DD" en la hora local del servidor — mismo
 * criterio que localDayBoundary en productionOrders.ts. */
function localDayBoundary(dateStr: string, end: boolean): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return end ? new Date(year, month - 1, day, 23, 59, 59, 999) : new Date(year, month - 1, day, 0, 0, 0, 0);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Historial de despachos, lo más nuevo primero. Filtros opcionales:
 * status, toStation, fromStation, from/to (YYYY-MM-DD). */
rollTransfersRouter.get("/", async (req, res) => {
  const { status, toStation, fromStation, from, to } = req.query as Record<string, string | undefined>;
  if (status && status !== "en_transito" && status !== "recibido") return res.status(400).json({ error: "Estado inválido" });
  for (const s of [toStation, fromStation]) {
    if (s && !(STATIONS as readonly string[]).includes(s)) return res.status(400).json({ error: "Estación inválida" });
  }
  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) {
    return res.status(400).json({ error: "Fecha inválida (formato YYYY-MM-DD)" });
  }

  const transfers = await prisma.rollTransfer.findMany({
    where: {
      status: status as "en_transito" | "recibido" | undefined,
      toStation: toStation as OpStation | undefined,
      fromStation: fromStation as OpStation | undefined,
      createdAt: from || to ? { gte: from ? localDayBoundary(from, false) : undefined, lte: to ? localDayBoundary(to, true) : undefined } : undefined,
    },
    orderBy: { id: "desc" },
    take: 300,
    include: transferInclude,
  });
  res.json(transfers.map(withRollCode));
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
        productionOrder: { select: { id: true, orderNumber: true, product: { select: { name: true, sku: true } } } },
      },
    }),
    remainingSourceKg(prisma, roll.id),
    prisma.rollTransfer.findFirst({ where: { rollId: roll.id, status: "en_transito" }, orderBy: { id: "desc" }, include: transferInclude }),
    prisma.rollTransfer.findFirst({ where: { rollId: roll.id }, orderBy: { id: "desc" }, include: transferInclude }),
  ]);

  res.json({
    roll: { ...detail, code: rollCode(roll), remainingKg },
    // Sin la bodega donde ya está (ver el mismo chequeo en POST /).
    destinations: DERIVATIONS[roll.station as OpStation].filter(
      (s) => s !== (lastTransfer?.status === "recibido" ? lastTransfer.toStation : roll.station)
    ),
    openTransfer: openTransfer ? withRollCode(openTransfer) : null,
    lastTransfer: lastTransfer ? withRollCode(lastTransfer) : null,
  });
});

const createSchema = z
  .object({
    code: z.string().trim().min(1),
    token: z.string().trim().min(1),
    toStation: z.enum(STATIONS),
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
  const destinations = DERIVATIONS[roll.station as OpStation];
  if (!destinations.includes(data.toStation)) {
    return res.status(400).json({
      error: destinations.length
        ? `Un rollo de ${STATION_LABELS[roll.station as OpStation]} solo se despacha a ${destinations.map((s) => STATION_LABELS[s]).join(", ")}`
        : `Los rollos de ${STATION_LABELS[roll.station as OpStation]} no se despachan a otra bodega`,
    });
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.userId }, select: { name: true } });
  const carrierName = data.mode === "retiro" ? user.name : data.carrierName!;

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
    if ((await remainingSourceKg(tx, roll.id)) <= 0) {
      return { open: null, transfer: null, error: `El rollo ${code} ya se consumió entero — no queda nada que despachar` };
    }
    // Sale de donde está AHORA: la bodega del último despacho recibido, o su
    // estación de origen si nunca se movió -- no siempre de roll.station.
    const lastReceived = await tx.rollTransfer.findFirst({ where: { rollId: roll.id, status: "recibido" }, orderBy: { id: "desc" } });
    const fromStation = lastReceived?.toStation ?? roll.station;
    if (fromStation === data.toStation) {
      return { open: null, transfer: null, error: `El rollo ${code} ya está en la bodega de ${STATION_LABELS[data.toStation]}` };
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
      },
      include: transferInclude,
    });
    return { open: null, transfer, error: null };
  });

  if (created.error) return res.status(400).json({ error: created.error });
  if (created.open) {
    return res.status(409).json({
      error: `El rollo ${code} ya salió hacia ${STATION_LABELS[created.open.toStation as OpStation]} (lo lleva ${created.open.carrierName}) y todavía no lo recibieron — primero tiene que recibirse allá`,
    });
  }
  res.status(201).json(withRollCode(created.transfer!));
});

const receiveSchema = z.object({
  code: z.string().trim().min(1),
  token: z.string().trim().min(1),
  notes: z.string().trim().max(500).optional(),
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
    return res.status(403).json({ error: `Este rollo va para la bodega de ${STATION_LABELS[transfer.toStation as OpStation]} — lo tiene que recibir un operario de allá` });
  }

  // updateMany con el estado en el where: si dos personas lo reciben a la
  // vez, solo una "gana" y la otra se entera, en vez de pisarse.
  const updated = await prisma.rollTransfer.updateMany({
    where: { id, status: "en_transito" },
    data: {
      status: "recibido",
      receivedById: req.user!.userId,
      receivedAt: new Date(),
      receivedTimezone: data.clientTimezone,
      receivedUtcOffsetMinutes: data.clientUtcOffsetMinutes,
      ...(data.notes ? { notes: transfer.notes ? `${transfer.notes}\nRecepción: ${data.notes}` : `Recepción: ${data.notes}` } : {}),
    },
  });
  if (updated.count === 0) return res.status(409).json({ error: "Este despacho ya fue recibido" });

  const full = await prisma.rollTransfer.findUniqueOrThrow({ where: { id }, include: transferInclude });
  res.json(withRollCode(full));
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
