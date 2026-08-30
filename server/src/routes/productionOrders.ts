import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import QRCode from "qrcode";
import { z } from "zod";
import type { Prisma, ProductionOrderStatus } from "../generated/prisma/client";
import { prisma } from "../prisma";
import { requireAuth, requireRole, ROLES, OPERARIO_STATIONS } from "../middleware/auth";
import { applyMovement, TxClient } from "../services/stockService";
import { applyRawMaterialMovement } from "../services/rawMaterialStockService";
import { withSequentialNumberRetry } from "../services/sequentialNumber";
import { notifyRoles } from "../services/notify";
import { buildOpPdf } from "../services/opPdf";
import { DERIVATIONS, FINAL_STATIONS, OpStation, STATION_LABELS } from "../services/opTemplates";

const UPLOADS_DIR = path.join(__dirname, "..", "..", "uploads", "produccion");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

export const productionOrdersRouter = Router();
productionOrdersRouter.use(requireAuth);

/**
 * El número consecutivo se calculaba como `count()+1`, lo cual asume que
 * TODAS las filas son "OP-00001..OP-000N" sin huecos. Eso se rompe apenas
 * hay filas con orderNumber no numérico (los OP-SEED-*) o se borra alguna OP
 * (limpieza de datos de prueba) — count() baja pero el máximo número ya
 * emitido no, así que el próximo intento vuelve a chocar con un número que
 * ya existe, para siempre (withSequentialNumberRetry no ayuda porque no hay
 * otra request concurrente que cambie el count() entre reintentos). Se
 * calcula en base al máximo sufijo numérico realmente usado en vez del total
 * de filas.
 */
async function nextOrderNumber(tx: TxClient): Promise<string> {
  const orders = await tx.productionOrder.findMany({
    where: { orderNumber: { startsWith: "OP-" } },
    select: { orderNumber: true },
  });
  let max = 0;
  for (const { orderNumber } of orders) {
    const match = /^OP-(\d{5})$/.exec(orderNumber);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `OP-${String(max + 1).padStart(5, "0")}`;
}

const requireProduccionGestion = requireRole(...ROLES.PRODUCCION_GESTION);
const requireOperarios = requireRole(...ROLES.OPERARIOS);
const requireCalidad = requireRole(...ROLES.CALIDAD);
/** Roles de operario puro (sin gestión) — a estos se les oculta toda OP en
 * "borrador": Gestión todavía la está armando (materia prima, medidas,
 * cliente, referencia) y no debe aparecer en la cola de planta hasta que la
 * libere explícitamente con POST /:id/release. */
const OPERARIO_ONLY_ROLES = ["operario_extrusion", "operario_impresion", "operario_sellado_precorte"];
// Calidad necesita GET / (para ver la cola ?status=pendiente_calidad) y
// GET /:id (para revisar los rollos al decidir); Auditoría necesita GET /:id
// (Trazabilidad) — por eso ambos se admiten acá a nivel de router, además de
// en sus endpoints propios de mutación.
productionOrdersRouter.use(requireRole(...ROLES.OPERARIOS, ...ROLES.CALIDAD, ...ROLES.AUDITORIA));

const STATIONS = ["extrusion", "impresion", "sellado", "precorte"] as const;

/** Estados desde los que la OP sigue "abierta" (acepta rollos y cierre). */
const OPEN_STATUSES = ["pendiente", "en_proceso"];

productionOrdersRouter.get("/", async (req, res) => {
  const status = req.query.status as string | undefined;
  const station = req.query.station as string | undefined;
  // Un operario puro nunca ve una OP en "borrador" (Gestión todavía la está
  // armando) — si además pidió explícitamente ?status=borrador, directamente
  // no hay nada que mostrarle.
  const hideDraft = OPERARIO_ONLY_ROLES.includes(req.user!.role);
  if (hideDraft && status === "borrador") return res.json([]);
  const statusFilter = hideDraft && !status ? { not: "borrador" } : status;
  const orders = await prisma.productionOrder.findMany({
    where: { status: statusFilter as any, station: station as any },
    include: {
      product: true,
      client: { select: { id: true, name: true } },
      rolls: { select: { weightKg: true, wasteKg: true } },
      parent: { select: { id: true, orderNumber: true, station: true } },
      derivedOrders: { select: { id: true, orderNumber: true, station: true, status: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(orders);
});

/**
 * Cola de Planeación: items de pedidos aprobados/en producción que todavía
 * no tienen una OP generada. No es una tabla propia — se deriva comparando
 * los items de la versión vigente de cada Pedido contra `ProductionOrder.
 * pedidoVersionItemId` (ver PedidoVersionItem.productionOrder).
 */
productionOrdersRouter.get("/pending-planning", requireProduccionGestion, async (_req, res) => {
  const pedidos = await prisma.pedido.findMany({
    where: { status: { in: ["aprobado", "en_produccion"] } },
    include: {
      client: true,
      versions: {
        include: { items: { include: { product: true, productionOrder: true } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const pending = pedidos.flatMap((pedido) => {
    const currentVersion = pedido.versions.find((v) => v.versionNumber === pedido.currentVersion);
    if (!currentVersion) return [];
    return currentVersion.items
      .filter((item) => !item.productionOrder)
      .map((item) => ({
        pedidoVersionItemId: item.id,
        pedidoId: pedido.id,
        pedidoOrderNumber: pedido.orderNumber,
        clientName: pedido.client.name,
        productId: item.productId,
        productName: item.product.name,
        productSku: item.product.sku,
        quantity: item.quantity,
        measure: item.measure ?? item.product.measure,
      }));
  });

  res.json(pending);
});

/**
 * Arma el límite de un día (inicio o fin) a partir de un "YYYY-MM-DD" en la
 * hora LOCAL del servidor — mismo criterio que dashboard.ts (evita el
 * corrimiento de horas que da `new Date("YYYY-MM-DD")` + setHours en husos
 * horarios != 0).
 */
function localDayBoundary(dateStr: string, end: boolean): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return end ? new Date(year, month - 1, day, 23, 59, 59, 999) : new Date(year, month - 1, day, 0, 0, 0, 0);
}

/**
 * Reporte pedido por Gestión (ver audio de la reunión con el cliente): hoy
 * cuadran a mano cuánto usó cada operario en el día (kg de rollos que sacó
 * vs. kg producidos + desperdicio). Ese cuadre ya es posible sin que nadie
 * tipee nada nuevo — cada rollo cargado (por escaneo o a mano) ya queda con
 * `operatorName` (el usuario logueado), `date`, `weightKg` y `wasteKg`; acá
 * solo se agrupan. Filtros opcionales `from`/`to` (YYYY-MM-DD, por defecto
 * últimos 7 días) y `station`.
 */
productionOrdersRouter.get("/reports/por-operario", requireProduccionGestion, async (req, res) => {
  const fromParam = req.query.from as string | undefined;
  const toParam = req.query.to as string | undefined;
  const stationParam = req.query.station as string | undefined;

  const defaultFrom = new Date();
  defaultFrom.setDate(defaultFrom.getDate() - 7);
  defaultFrom.setHours(0, 0, 0, 0);

  const from = fromParam ? localDayBoundary(fromParam, false) : defaultFrom;
  const to = toParam ? localDayBoundary(toParam, true) : new Date();

  const rolls = await prisma.productionRoll.findMany({
    where: {
      date: { gte: from, lte: to },
      productionOrder: stationParam ? { station: stationParam as any } : undefined,
    },
    select: {
      date: true,
      operatorName: true,
      weightKg: true,
      wasteKg: true,
      productionOrder: { select: { station: true, orderNumber: true } },
    },
  });

  type Row = { operatorName: string; day: string; station: string | null; rollCount: number; weightKg: number; wasteKg: number };
  const groups = new Map<string, Row>();
  for (const roll of rolls) {
    // YYYY-MM-DD en huso local del server, para agrupar por día calendario
    // real (no por el corte UTC).
    const day = roll.date.toLocaleDateString("en-CA");
    const station = roll.productionOrder.station;
    const key = `${roll.operatorName}|${day}|${station}`;
    const g = groups.get(key) ?? { operatorName: roll.operatorName, day, station, rollCount: 0, weightKg: 0, wasteKg: 0 };
    g.rollCount += 1;
    g.weightKg += Number(roll.weightKg);
    g.wasteKg += Number(roll.wasteKg);
    groups.set(key, g);
  }

  const result = [...groups.values()].sort((a, b) => (a.day !== b.day ? (a.day < b.day ? 1 : -1) : a.operatorName.localeCompare(b.operatorName)));
  res.json(result);
});

const ROLL_CODE_RE = /^RL-(\d+)$/;

/**
 * Resuelve un rollo por el código de su etiqueta QR (`RL-<id>`, ver
 * GET /:id/rolls/:rollId/label). La usa el escáner al cargar un rollo en la
 * OP derivada: quien escanea confirma qué rollo físico tomó como insumo.
 */
productionOrdersRouter.get("/rolls/by-code/:code", async (req, res) => {
  const match = ROLL_CODE_RE.exec(req.params.code);
  if (!match) return res.status(400).json({ error: "Código de rollo inválido" });

  const roll = await prisma.productionRoll.findUnique({
    where: { id: Number(match[1]) },
    include: {
      createdBy: { select: { name: true } },
      productionOrder: { select: { id: true, orderNumber: true, station: true, product: { select: { name: true, sku: true } } } },
    },
  });
  if (!roll) return res.status(404).json({ error: "Rollo no encontrado" });

  res.json(roll);
});

/**
 * Detalle completo de una OP: sus rollos, adjuntos, cadena de derivación
 * (padre e hijas), el resultado de Calidad (si ya se registró) y el
 * pedido/cliente de origen (si vino de Planeación).
 */
productionOrdersRouter.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido" });

  const order = await prisma.productionOrder.findUnique({
    where: { id },
    include: {
      product: true,
      client: { select: { id: true, name: true } },
      rolls: {
        orderBy: [{ date: "asc" }, { id: "asc" }],
        include: {
          createdBy: { select: { name: true } },
          sourceRoll: { select: { id: true, label: true, weightKg: true, createdBy: { select: { name: true } } } },
        },
      },
      attachments: { orderBy: { createdAt: "asc" } },
      // rolls acá es solo para que Sellado/Precorte puedan mostrar los
      // totales reales de "Orden de Extrusión/Impresión" (kilos y rollos
      // que produjo la OP padre) sin que nadie los tipee a mano.
      parent: {
        select: { id: true, orderNumber: true, station: true, status: true, rolls: { select: { weightKg: true } } },
      },
      derivedOrders: { select: { id: true, orderNumber: true, station: true, status: true } },
      qualityCheck: { include: { createdBy: { select: { name: true } } } },
      pedidoVersionItem: {
        include: { pedidoVersion: { include: { pedido: { include: { client: true } } } } },
      },
      createdBy: { select: { name: true } },
    },
  });
  if (!order) return res.status(404).json({ error: "OP no encontrada" });
  if (order.status === "borrador" && OPERARIO_ONLY_ROLES.includes(req.user!.role)) {
    return res.status(404).json({ error: "OP no encontrada" });
  }

  // Cadena completa de derivación: todas las etapas comparten el mismo
  // orderNumber (ver POST /:id/derive) — para Trazabilidad es más útil ver
  // la cadena entera de una sola vez que ir clickeando padre por padre.
  const chain = await prisma.productionOrder.findMany({
    where: { orderNumber: order.orderNumber },
    select: {
      id: true,
      station: true,
      status: true,
      parentOrderId: true,
      quantityPlanned: true,
      rolls: { select: { weightKg: true } },
    },
    orderBy: { id: "asc" },
  });

  // El stock deja de estar atado a esta OP en particular apenas Calidad lo
  // suma al inventario (es fungible por producto, no por lote) — así que
  // esto es la foto ACTUAL del producto en el almacén y sus despachos
  // recientes, no específicamente "dónde quedaron estos kilos" de esta OP.
  // Igual es la info más cercana que existe sin agregar trazabilidad por
  // lote, que sería un cambio de modelo mucho más grande.
  const [warehouseLocations, recentDispatchItems] = await Promise.all([
    prisma.stockLocation.findMany({
      where: { productId: order.productId, quantity: { gt: 0 } },
      select: { quantity: true, location: { select: { code: true, label: true } } },
      orderBy: { location: { code: "asc" } },
    }),
    prisma.dispatchItem.findMany({
      where: { productId: order.productId },
      select: {
        id: true,
        quantityRequested: true,
        quantityDispatched: true,
        dispatch: { select: { id: true, status: true, dispatchedDate: true, client: { select: { name: true } } } },
      },
      orderBy: { id: "desc" },
      take: 5,
    }),
  ]);

  res.json({ ...order, chain, warehouseLocations, recentDispatchItems });
});

const createOrderSchema = z.object({
  // Sin default: la OP nace sin proceso asignado (ver comentario en el
  // schema) y se deriva a Extrusión como primer paso, no se elige acá.
  station: z.enum(STATIONS).optional(),
  productId: z.number().int(),
  clientId: z.number().int().optional(),
  quantityPlanned: z.number().positive(),
  measure: z.string().optional(),
  specs: z.record(z.string(), z.any()).optional(),
  notes: z.string().optional(),
});

/** Crea una OP con numeración consecutiva (OP-00001, OP-00002, ...). */
productionOrdersRouter.post("/", requireProduccionGestion, async (req, res) => {
  const parsed = createOrderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const product = await prisma.product.findUnique({ where: { id: parsed.data.productId } });
  if (!product) return res.status(404).json({ error: "Producto no encontrado" });

  if (parsed.data.clientId) {
    const client = await prisma.client.findUnique({ where: { id: parsed.data.clientId } });
    if (!client) return res.status(404).json({ error: "Cliente no encontrado" });
  }

  const order = await withSequentialNumberRetry(() =>
    prisma.$transaction(async (tx) => {
      const orderNumber = await nextOrderNumber(tx);

      return tx.productionOrder.create({
        data: {
          orderNumber,
          // Sin proceso todavía (a menos que se lo pasen explícito, ej.
          // pruebas de API) — Gestión la deriva a Extrusión como primer
          // paso (ver POST /:id/derive).
          station: parsed.data.station ?? null,
          // Nace en "borrador": Gestión todavía tiene que terminar de cargar
          // materia prima/medidas/cliente/referencia antes de que la vea
          // planta — recién queda visible/operable para los operarios al
          // liberarla con POST /:id/release.
          status: "borrador",
          productId: parsed.data.productId,
          clientId: parsed.data.clientId,
          quantityPlanned: parsed.data.quantityPlanned,
          measure: parsed.data.measure ?? product.measure,
          specs: parsed.data.specs as Prisma.InputJsonValue | undefined,
          notes: parsed.data.notes,
          createdById: req.user!.userId,
        },
      });
    })
  );

  res.status(201).json(order);
});

/**
 * Genera la OP correspondiente a un item de pedido pendiente de planeación.
 * Nace sin proceso asignado, con el cliente del pedido, en "borrador" —
 * Planeación/Gestión todavía tiene que cargarle materia prima y medidas, y
 * derivarla a Extrusión (el proceso base) antes de liberarla a planta
 * (POST /:id/release). Los procesos siguientes se derivan desde ella.
 */
productionOrdersRouter.post("/from-pedido-item/:pedidoVersionItemId", requireProduccionGestion, async (req, res) => {
  const pedidoVersionItemId = Number(req.params.pedidoVersionItemId);
  if (!Number.isInteger(pedidoVersionItemId)) return res.status(400).json({ error: "Id inválido" });

  const item = await prisma.pedidoVersionItem.findUnique({
    where: { id: pedidoVersionItemId },
    include: { product: true, productionOrder: true, pedidoVersion: { include: { pedido: true } } },
  });
  if (!item) return res.status(404).json({ error: "Item de pedido no encontrado" });
  if (item.productionOrder) return res.status(400).json({ error: "Este item ya tiene una OP generada" });

  const order = await withSequentialNumberRetry(() =>
    prisma.$transaction(async (tx) => {
      const orderNumber = await nextOrderNumber(tx);

      return tx.productionOrder.create({
        data: {
          orderNumber,
          // Igual que POST /: sin proceso hasta que Gestión la derive a
          // Extrusión explícitamente.
          station: null,
          status: "borrador",
          productId: item.productId,
          clientId: item.pedidoVersion.pedido.clientId,
          quantityPlanned: item.quantity,
          measure: item.measure ?? item.product.measure,
          pedidoVersionItemId: item.id,
          createdById: req.user!.userId,
        },
      });
    })
  );

  res.status(201).json(order);
});

/**
 * Libera una OP en "borrador" a planta: Gestión ya terminó de cargar materia
 * prima/medidas/cliente/referencia, y de acá en más queda visible y operable
 * para los operarios de esa estación (cola de EstacionProduccion.tsx, carga
 * de rollos). No hay vuelta atrás por acá — para corregir algo después de
 * liberada se usa /:id/reopen una vez que ya se cerró.
 */
productionOrdersRouter.post("/:id/release", requireProduccionGestion, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido" });

  const order = await prisma.productionOrder.findUnique({ where: { id } });
  if (!order) return res.status(404).json({ error: "OP no encontrada" });
  if (order.status !== "borrador") return res.status(400).json({ error: "Esta OP ya fue liberada a planta" });
  if (order.station === null) {
    return res.status(400).json({ error: "Primero derivá la OP a Extrusión antes de liberarla a planta" });
  }

  const updated = await prisma.productionOrder.update({ where: { id }, data: { status: "pendiente" } });
  res.json(updated);
});

const deriveSchema = z.object({
  station: z.enum(STATIONS),
  quantityPlanned: z.number().positive().optional(),
  measure: z.string().optional(),
  specs: z.record(z.string(), z.any()).optional(),
  notes: z.string().optional(),
});

/**
 * Deriva una OP hacia el siguiente proceso (Extrusión → Impresión/Sellado/
 * Precorte; Impresión → Sellado/Precorte). Hereda producto, cliente, medida
 * y cantidad del padre salvo que el body los pise. La OP hija nace directo
 * en "pendiente" (no "borrador"): el operario que la deriva ya tomó la
 * decisión de mandarla al siguiente paso, no hace falta otra liberación de
 * Gestión en el medio.
 *
 * Caso especial: si la OP todavía no tiene proceso asignado (recién creada,
 * `station` null), este mismo endpoint es el que se lo asigna — pero NO crea
 * una fila hija nueva, actualiza la fila existente en el lugar, porque
 * todavía no hubo ningún trabajo real hecho en "estado sin proceso". El
 * cliente pidió explícitamente que la OP se cree en blanco y recién se
 * "derive a Extrusión" como primer paso, en vez de nacer ya asignada.
 */
productionOrdersRouter.post("/:id/derive", requireOperarios, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido" });
  const parsed = deriveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const parent = await prisma.productionOrder.findUnique({ where: { id } });
  if (!parent) return res.status(404).json({ error: "OP no encontrada" });
  if (parent.status === "cancelada") return res.status(400).json({ error: "No se puede derivar de una OP cancelada" });

  if (parent.station === null) {
    if (!ROLES.PRODUCCION_GESTION.includes(req.user!.role)) {
      return res.status(403).json({ error: "Solo Gestión/Planeación puede asignar el primer proceso de una OP" });
    }
    if (parsed.data.station !== "extrusion") {
      return res.status(400).json({ error: "El primer proceso de una OP siempre es Extrusión" });
    }
    const updated = await prisma.productionOrder.update({
      where: { id },
      data: {
        station: "extrusion",
        quantityPlanned: parsed.data.quantityPlanned ?? parent.quantityPlanned,
        measure: parsed.data.measure ?? parent.measure,
        specs: (parsed.data.specs as Prisma.InputJsonValue | undefined) ?? (parent.specs as Prisma.InputJsonValue | undefined),
        notes: parsed.data.notes ?? parent.notes,
      },
    });
    return res.json(updated);
  }

  // Mismo criterio que /rolls y /close: un operario solo dirige OPs de SU
  // estación (Gestión/Planeación pueden cualquiera).
  const allowedStations = OPERARIO_STATIONS[req.user!.role];
  if (allowedStations && !allowedStations.includes(parent.station)) {
    return res.status(403).json({ error: `Tu rol solo puede derivar OPs de: ${allowedStations.join(", ")}` });
  }

  const allowed = DERIVATIONS[parent.station as OpStation];
  if (!allowed.includes(parsed.data.station)) {
    return res.status(400).json({
      error: allowed.length
        ? `Desde ${parent.station} solo se puede derivar a: ${allowed.join(", ")}`
        : `Una OP de ${parent.station} es un proceso final, no deriva a otro`,
    });
  }

  // Una OP solo puede derivar UNA vez a cada estación destino — si no, cada
  // clic en "Derivar a Sellado" crea una fila hija más, todas con el mismo
  // número (ver comentario arriba), y en el listado se ve como si la OP se
  // hubiera "duplicado" infinitas veces hacia el mismo proceso.
  const existingDerivation = await prisma.productionOrder.findFirst({
    where: { parentOrderId: parent.id, station: parsed.data.station },
  });
  if (existingDerivation) {
    return res.status(400).json({
      error: `Esta OP ya fue derivada a ${STATION_LABELS[parsed.data.station]} (OP #${existingDerivation.id})`,
    });
  }

  // El número de OP identifica la cadena completa, no cada etapa: la hija
  // hereda el mismo orderNumber del padre (que a su vez ya viene heredado
  // desde la raíz). Solo sube el consecutivo al crear una OP nueva, no acá.
  const order = await prisma.productionOrder.create({
    data: {
      orderNumber: parent.orderNumber,
      station: parsed.data.station,
      productId: parent.productId,
      clientId: parent.clientId,
      quantityPlanned: parsed.data.quantityPlanned ?? parent.quantityPlanned,
      measure: parsed.data.measure ?? parent.measure,
      specs: parsed.data.specs as Prisma.InputJsonValue | undefined,
      notes: parsed.data.notes,
      parentOrderId: parent.id,
      createdById: req.user!.userId,
    },
  });

  res.status(201).json(order);
});

const updateOrderSchema = z.object({
  specs: z.record(z.string(), z.any()).optional(),
  measure: z.string().nullable().optional(),
  quantityPlanned: z.number().positive().optional(),
  clientId: z.number().int().nullable().optional(),
  notes: z.string().nullable().optional(),
});

/** Edita el encabezado/specs de una OP mientras siga abierta. */
productionOrdersRouter.patch("/:id", requireProduccionGestion, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido" });
  const parsed = updateOrderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const order = await prisma.productionOrder.findUnique({ where: { id } });
  if (!order) return res.status(404).json({ error: "OP no encontrada" });
  // "borrador" también es editable — es justo el estado en el que Gestión
  // carga materia prima/medidas/cliente/referencia antes de liberarla.
  if (order.status !== "borrador" && !OPEN_STATUSES.includes(order.status)) {
    return res.status(400).json({ error: "Solo se puede editar una OP en borrador o abierta (pendiente o en proceso)" });
  }

  const updated = await prisma.productionOrder.update({
    where: { id },
    data: {
      specs: parsed.data.specs as Prisma.InputJsonValue | undefined,
      measure: parsed.data.measure,
      quantityPlanned: parsed.data.quantityPlanned,
      clientId: parsed.data.clientId,
      notes: parsed.data.notes,
    },
  });
  res.json(updated);
});

const materialParaSchema = z.object({ materialPara: z.string().nullable() });

/**
 * "Material para" (specs.materialPara) es el ÚNICO campo del encabezado que
 * también puede tocar el operario, no solo Gestión: es literalmente a qué
 * estación va a derivar esta OP (IMPRESION/SELLADO/PRECORTE), y el operario
 * de Extrusión es quien decide eso al terminar su parte — el resto del PATCH
 * general (materia prima, medidas, cliente...) sigue siendo exclusivo de
 * Gestión. Endpoint aparte (en vez de abrir todo el PATCH /:id) para no
 * poder tocar ningún otro campo desde acá.
 */
productionOrdersRouter.patch("/:id/material-para", requireOperarios, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido" });
  const parsed = materialParaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const order = await prisma.productionOrder.findUnique({ where: { id } });
  if (!order) return res.status(404).json({ error: "OP no encontrada" });
  if (order.status !== "borrador" && !OPEN_STATUSES.includes(order.status)) {
    return res.status(400).json({ error: "Solo se puede editar una OP en borrador o abierta (pendiente o en proceso)" });
  }

  const allowedStations = OPERARIO_STATIONS[req.user!.role];
  if (allowedStations && !allowedStations.includes(order.station as OpStation)) {
    return res.status(403).json({ error: `Tu rol solo puede editar OPs de: ${allowedStations.join(", ")}` });
  }

  const currentSpecs = order.specs && typeof order.specs === "object" ? (order.specs as object) : {};
  const updated = await prisma.productionOrder.update({
    where: { id },
    data: { specs: { ...currentSpecs, materialPara: parsed.data.materialPara } as Prisma.InputJsonValue },
  });
  res.json(updated);
});

const updateStatusSchema = z.object({
  status: z.enum(["borrador", "pendiente", "en_proceso", "pendiente_calidad", "detenida", "finalizada", "cancelada"]),
});

productionOrdersRouter.patch("/:id/status", requireProduccionGestion, async (req, res) => {
  const id = Number(req.params.id);
  const parsed = updateStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const order = await prisma.productionOrder.findUnique({ where: { id } });
  if (!order) return res.status(404).json({ error: "OP no encontrada" });

  const updated = await prisma.productionOrder.update({ where: { id }, data: { status: parsed.data.status } });
  res.json(updated);
});

/**
 * Cierra una OP. Extrusión/Impresión quedan "finalizada" directo (su material
 * pasa a la OP derivada, no mueven stock); Sellado/Precorte (procesos
 * finales) pasan a "pendiente_calidad" — recién cuando Calidad aprueba se
 * genera la entrada de inventario con la suma de kg de los rollos.
 */
productionOrdersRouter.post("/:id/close", requireOperarios, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido" });

  const order = await prisma.productionOrder.findUnique({
    where: { id },
    include: { rolls: { select: { id: true } } },
  });
  if (!order) return res.status(404).json({ error: "OP no encontrada" });
  if (!OPEN_STATUSES.includes(order.status)) {
    return res.status(400).json({ error: "Esta OP ya no está abierta" });
  }

  const allowedStations = OPERARIO_STATIONS[req.user!.role];
  if (allowedStations && !allowedStations.includes(order.station as OpStation)) {
    return res.status(403).json({ error: `Tu rol solo puede operar OPs de: ${allowedStations.join(", ")}` });
  }

  if (order.rolls.length === 0) {
    return res.status(400).json({ error: "No se puede cerrar una OP sin rollos registrados" });
  }

  const isFinal = FINAL_STATIONS.includes(order.station as OpStation);
  const newStatus = isFinal ? "pendiente_calidad" : "finalizada";

  // Al cerrar una OP de Extrusión se descuenta del stock de materia prima
  // el kg cargado en cada insumo de la tabla (specs.materiaPrima) — no se
  // recalcula nada, es el mismo kg que ya está tipeado ahí. Si un `ref` no
  // matchea ningún código del catálogo (materia prima borrada, error de
  // tipeo), se avisa en la respuesta pero NO bloquea el cierre — la OP ya
  // tiene rollos reales cargados, no tiene sentido trabarla por esto.
  const skippedRefs: string[] = [];
  const updated = await prisma.$transaction(async (tx) => {
    if (order.station === "extrusion") {
      const rows = ((order.specs as any)?.materiaPrima as { ref?: string; kg?: unknown }[] | undefined) ?? [];
      for (const row of rows) {
        const kg = Number(row.kg);
        if (!row.ref || !Number.isFinite(kg) || kg <= 0) continue;
        const material = await tx.rawMaterial.findUnique({ where: { code: row.ref } });
        if (!material) {
          skippedRefs.push(row.ref);
          continue;
        }
        await applyRawMaterialMovement(tx, {
          rawMaterialId: material.id,
          quantity: -kg,
          movementType: "consumo_produccion",
          referenceType: "production_order",
          referenceId: order.id,
          createdById: req.user!.userId,
        });
      }
    }
    return tx.productionOrder.update({ where: { id }, data: { status: newStatus } });
  });

  if (isFinal) {
    await notifyRoles(ROLES.CALIDAD, {
      type: "op_pendiente_calidad",
      message: `OP #${order.orderNumber} lista para revisión de calidad`,
      link: "/calidad",
    });
  }

  res.json({ ...updated, skippedRawMaterialRefs: skippedRefs });
});

/** Estados desde los que se puede reabrir una OP para corregir un error. */
const REOPENABLE_STATUSES: ProductionOrderStatus[] = ["finalizada", "pendiente_calidad", "detenida"];

/**
 * Reabre una OP cerrada por error, dejándola "en_proceso" otra vez (se
 * puede volver a editar specs/cantidad y cargar o borrar rollos). Revierte
 * TODO efecto de inventario que se haya aplicado al cerrarla o aprobarla,
 * en vez de solo cambiar el status, para que los kilos nunca queden
 * "fantasma" en el stock:
 *  - si tenía un control de calidad "aprobado", revierte la entrada de
 *    producto terminado (misma cantidad de kg que se sumó) y borra el
 *    control (al volver a cerrar se vuelve a pasar por Calidad);
 *  - si tenía un control "rechazado", solo borra el control (nunca movió
 *    stock);
 *  - si es una OP de Extrusión, revierte la materia prima descontada al
 *    cerrarla, leyendo los movimientos reales que quedaron logueados con
 *    `referenceType: "production_order"` (no se recalcula desde specs, que
 *    pudo haber cambiado desde entonces).
 */
class NotReopenableError extends Error {}

productionOrdersRouter.post("/:id/reopen", requireProduccionGestion, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido" });

  const order = await prisma.productionOrder.findUnique({
    where: { id },
    include: { qualityCheck: true, rolls: { select: { weightKg: true } } },
  });
  if (!order) return res.status(404).json({ error: "OP no encontrada" });
  if (!REOPENABLE_STATUSES.includes(order.status)) {
    return res.status(400).json({ error: "Esta OP no se puede reabrir desde su estado actual" });
  }

  let reversedProductKg = 0;
  let reversedRawMaterials: { code: string; kg: number }[] = [];

  try {
    await prisma.$transaction(async (tx) => {
      // Reintenta el gate de estado DENTRO de la transacción con un update
      // condicional: si dos reaperturas casi simultáneas pasan el chequeo
      // de arriba (hecho con el `order` leído antes de abrir la tx), acá
      // solo una de las dos logra el update — la otra ve count=0 y aborta
      // sin haber revertido nada (si no, ambas reversarían la misma OP).
      const claimed = await tx.productionOrder.updateMany({
        where: { id, status: { in: REOPENABLE_STATUSES } },
        data: {
          status: "en_proceso",
          notes: order.notes
            ? `${order.notes}\n[Reabierta el ${new Date().toLocaleString("es-CO")} por ${req.user!.name}]`
            : `[Reabierta el ${new Date().toLocaleString("es-CO")} por ${req.user!.name}]`,
        },
      });
      if (claimed.count === 0) throw new NotReopenableError();

      if (order.qualityCheck) {
        if (order.qualityCheck.result === "aprobado") {
          reversedProductKg = order.rolls.reduce((acc, r) => acc + Number(r.weightKg), 0);
          if (reversedProductKg > 0) {
            await applyMovement(tx, {
              productId: order.productId,
              quantity: -reversedProductKg,
              movementType: "ajuste",
              referenceType: "manual_adjustment",
              referenceId: order.qualityCheck.id,
              createdById: req.user!.userId,
            });
          }
        }
        await tx.qualityCheck.delete({ where: { id: order.qualityCheck.id } });
      }

      if (order.station === "extrusion") {
        // Se sobre-el NETO por insumo (suma de todo lo que quedó logueado
        // contra esta OP), no "cada movimiento negativo" — si esta ya es la
        // segunda vez que se cierra y reabre esta OP, el historial trae la
        // consumición original Y la reversión de la primera vuelta con el
        // mismo referenceId; sumar todo y revertir solo lo que sigue
        // pendiente (neto < 0) evita devolver dos veces el mismo kg.
        const movimientos = await tx.rawMaterialMovement.findMany({
          where: { referenceType: "production_order", referenceId: order.id },
          include: { rawMaterial: { select: { code: true } } },
        });
        const porMaterial = new Map<number, { code: string; net: number }>();
        for (const mov of movimientos) {
          const acc = porMaterial.get(mov.rawMaterialId) ?? { code: mov.rawMaterial.code, net: 0 };
          acc.net += Number(mov.quantity);
          porMaterial.set(mov.rawMaterialId, acc);
        }
        for (const [rawMaterialId, { code, net }] of porMaterial) {
          if (net >= 0) continue; // ya saldado por una reversión anterior
          const kg = -net;
          await applyRawMaterialMovement(tx, {
            rawMaterialId,
            quantity: kg,
            movementType: "ajuste",
            referenceType: "production_order",
            referenceId: order.id,
            notes: `Reversión por reapertura de ${order.orderNumber}`,
            createdById: req.user!.userId,
          });
          reversedRawMaterials.push({ code, kg });
        }
      }
    });
  } catch (err) {
    if (err instanceof NotReopenableError) {
      return res.status(400).json({ error: "Esta OP no se puede reabrir desde su estado actual" });
    }
    throw err;
  }

  const updated = await prisma.productionOrder.findUnique({ where: { id } });
  res.json({ ...updated, reversedProductKg, reversedRawMaterials });
});

const createRollSchema = z.object({
  date: z.string().optional(),
  shift: z.string().optional(),
  machine: z.string().optional(),
  label: z.string().optional(),
  weightKg: z.number().positive(),
  wasteKg: z.number().min(0).optional().default(0),
  details: z.record(z.string(), z.any()).optional(),
  notes: z.string().optional(),
  /** Rollo físico tomado como insumo, resuelto al escanear su QR
   * (GET /rolls/by-code/:code). Queda registrado quién lo tomó porque
   * `createdById` es siempre el usuario logueado que hizo el POST. */
  sourceRollId: z.number().int().optional(),
});

/**
 * Agrega una fila al registro acumulativo de rollos de la OP (la tabla
 * inferior del formato en papel). Un operario solo puede cargar rollos en
 * OPs de SU estación (gerente_produccion y planeacion cargan cualquiera).
 */
productionOrdersRouter.post("/:id/rolls", requireOperarios, async (req, res) => {
  const productionOrderId = Number(req.params.id);
  if (!Number.isInteger(productionOrderId)) return res.status(400).json({ error: "Id inválido" });
  const parsed = createRollSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const order = await prisma.productionOrder.findUnique({ where: { id: productionOrderId } });
  if (!order) return res.status(404).json({ error: "OP no encontrada" });
  if (!OPEN_STATUSES.includes(order.status)) {
    return res.status(400).json({ error: "Esta OP ya no está abierta" });
  }

  const allowedStations = OPERARIO_STATIONS[req.user!.role];
  if (allowedStations && !allowedStations.includes(order.station as OpStation)) {
    return res.status(403).json({ error: `Tu rol solo puede registrar rollos en OPs de: ${allowedStations.join(", ")}` });
  }

  if (parsed.data.sourceRollId) {
    const source = await prisma.productionRoll.findUnique({ where: { id: parsed.data.sourceRollId } });
    if (!source) return res.status(404).json({ error: "El rollo de origen escaneado no existe" });
    // El insumo escaneado tiene que salir de la OP padre real (la cadena de
    // derivación), no de cualquier rollo del sistema — si no, el QR deja de
    // ser trazabilidad y pasa a ser un dato suelto sin sentido.
    if (source.productionOrderId !== order.parentOrderId) {
      return res.status(400).json({ error: "El rollo escaneado no pertenece a la OP de la que deriva esta orden" });
    }
  }

  const roll = await prisma.$transaction(async (tx) => {
    const created = await tx.productionRoll.create({
      data: {
        productionOrderId,
        date: parsed.data.date ? new Date(parsed.data.date) : undefined,
        shift: parsed.data.shift,
        // El operario SIEMPRE sale del JWT, nunca del body — si no, cualquiera
        // con un token válido podría firmar rollos a nombre de otra persona
        // llamando la API directo (el frontend ya manda esto, pero no hay
        // que confiar en eso del lado del cliente).
        operatorName: req.user!.name,
        machine: parsed.data.machine,
        label: parsed.data.label,
        weightKg: parsed.data.weightKg,
        wasteKg: parsed.data.wasteKg,
        details: parsed.data.details as Prisma.InputJsonValue | undefined,
        notes: parsed.data.notes,
        sourceRollId: parsed.data.sourceRollId,
        createdById: req.user!.userId,
      },
    });

    if (order.status === "pendiente") {
      await tx.productionOrder.update({ where: { id: productionOrderId }, data: { status: "en_proceso" } });
    }

    return created;
  });

  res.status(201).json(roll);
});

/** Borra una fila de rollo cargada por error (solo gestión, solo OP abierta). */
productionOrdersRouter.delete("/:id/rolls/:rollId", requireProduccionGestion, async (req, res) => {
  const productionOrderId = Number(req.params.id);
  const rollId = Number(req.params.rollId);
  if (!Number.isInteger(productionOrderId) || !Number.isInteger(rollId)) {
    return res.status(400).json({ error: "Id inválido" });
  }

  const roll = await prisma.productionRoll.findFirst({
    where: { id: rollId, productionOrderId },
    include: { productionOrder: true },
  });
  if (!roll) return res.status(404).json({ error: "Rollo no encontrado" });
  if (!OPEN_STATUSES.includes(roll.productionOrder.status)) {
    return res.status(400).json({ error: "La OP ya no está abierta" });
  }

  await prisma.productionRoll.delete({ where: { id: rollId } });
  res.status(204).end();
});

const qualityCheckSchema = z.object({
  result: z.enum(["aprobado", "rechazado"]),
  observations: z.string().optional(),
});

/**
 * Aprueba o rechaza el lote de una OP final cerrada. Si se aprueba, recién
 * ahí se genera la entrada de inventario (con la suma de kg de los rollos
 * registrados) y la OP queda finalizada; si se rechaza, queda "detenida"
 * sin mover stock.
 */
productionOrdersRouter.post("/:id/quality-check", requireCalidad, async (req, res) => {
  const productionOrderId = Number(req.params.id);
  const parsed = qualityCheckSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const order = await prisma.productionOrder.findUnique({
    where: { id: productionOrderId },
    include: { qualityCheck: true, rolls: { select: { weightKg: true } } },
  });
  if (!order) return res.status(404).json({ error: "OP no encontrada" });
  if (order.status !== "pendiente_calidad") {
    return res.status(400).json({ error: "Esta OP no está pendiente de control de calidad" });
  }
  if (order.qualityCheck) {
    return res.status(400).json({ error: "Esta OP ya tiene un control de calidad registrado" });
  }

  const totalKg = order.rolls.reduce((acc, r) => acc + Number(r.weightKg), 0);

  const check = await prisma.$transaction(async (tx) => {
    const created = await tx.qualityCheck.create({
      data: {
        productionOrderId,
        result: parsed.data.result,
        observations: parsed.data.observations,
        createdById: req.user!.userId,
      },
    });

    if (parsed.data.result === "aprobado") {
      if (totalKg > 0) {
        await applyMovement(tx, {
          productId: order.productId,
          quantity: totalKg,
          movementType: "entrada_produccion",
          referenceType: "manual_adjustment",
          referenceId: created.id,
          createdById: req.user!.userId,
        });
      }
      await tx.productionOrder.update({ where: { id: productionOrderId }, data: { status: "finalizada" } });
    } else {
      await tx.productionOrder.update({ where: { id: productionOrderId }, data: { status: "detenida" } });
    }

    return created;
  });

  if (parsed.data.result === "rechazado") {
    await notifyRoles(ROLES.PRODUCCION_GESTION, {
      type: "op_rechazada",
      message: `OP #${order.orderNumber} fue rechazada en calidad`,
      link: "/produccion/ordenes",
    });
  }

  res.status(201).json(check);
});

/**
 * Reporte consolidado de la OP en PDF con el layout del formato en papel del
 * cliente: encabezado, materia prima, specs, registro de rollos, totales,
 * operarios por turno y adjuntos.
 */
productionOrdersRouter.get("/:id/report.pdf", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido" });

  const order = await prisma.productionOrder.findUnique({
    where: { id },
    include: {
      product: true,
      client: { select: { name: true } },
      rolls: { orderBy: [{ date: "asc" }, { id: "asc" }] },
      attachments: { select: { originalName: true } },
      parent: {
        select: { orderNumber: true, station: true, rolls: { select: { weightKg: true } } },
      },
      derivedOrders: { select: { orderNumber: true } },
    },
  });
  if (!order) return res.status(404).json({ error: "OP no encontrada" });
  if (order.station === null) {
    return res.status(400).json({ error: "Esta OP todavía no tiene proceso asignado — derivala a Extrusión antes de generar el reporte" });
  }

  const doc = buildOpPdf({
    orderNumber: order.orderNumber,
    station: order.station as OpStation,
    status: order.status,
    createdAt: order.createdAt,
    quantityPlanned: Number(order.quantityPlanned),
    measure: order.measure,
    notes: order.notes,
    specs: (order.specs ?? null) as Record<string, unknown> | null,
    clientName: order.client?.name ?? null,
    productName: order.product.name,
    productSku: order.product.sku,
    parentOrderNumber: order.parent?.orderNumber ?? null,
    parentStation: (order.parent?.station as OpStation) ?? null,
    parentKilosTotales: order.parent ? order.parent.rolls.reduce((acc, r) => acc + Number(r.weightKg), 0) : null,
    parentRollosCount: order.parent ? order.parent.rolls.length : null,
    derivedOrderNumbers: order.derivedOrders.map((d) => d.orderNumber),
    rolls: order.rolls,
    attachmentNames: order.attachments.map((a) => a.originalName),
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${order.orderNumber}.pdf"`);
  doc.pipe(res);
  doc.end();
});

// ---- Adjuntos (mismo patrón que los adjuntos de Pedidos) ----

productionOrdersRouter.get("/:id/attachments", async (req, res) => {
  const productionOrderId = Number(req.params.id);
  if (!Number.isInteger(productionOrderId)) return res.status(400).json({ error: "Id inválido" });
  const attachments = await prisma.productionOrderAttachment.findMany({
    where: { productionOrderId },
    orderBy: { createdAt: "asc" },
  });
  res.json(attachments);
});

productionOrdersRouter.post("/:id/attachments", requireOperarios, upload.single("file"), async (req, res) => {
  const productionOrderId = Number(req.params.id);
  if (!Number.isInteger(productionOrderId)) return res.status(400).json({ error: "Id inválido" });
  if (!req.file) return res.status(400).json({ error: "Falta el archivo (campo \"file\")" });

  const order = await prisma.productionOrder.findUnique({ where: { id: productionOrderId } });
  if (!order) return res.status(404).json({ error: "OP no encontrada" });

  const attachment = await prisma.productionOrderAttachment.create({
    data: {
      productionOrderId,
      storedName: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      uploadedById: req.user!.userId,
    },
  });

  res.status(201).json(attachment);
});

productionOrdersRouter.get("/:id/attachments/:attachmentId/download", async (req, res) => {
  const productionOrderId = Number(req.params.id);
  const attachmentId = Number(req.params.attachmentId);
  if (!Number.isInteger(productionOrderId) || !Number.isInteger(attachmentId)) {
    return res.status(400).json({ error: "Id inválido" });
  }
  const attachment = await prisma.productionOrderAttachment.findFirst({
    where: { id: attachmentId, productionOrderId },
  });
  if (!attachment) return res.status(404).json({ error: "Adjunto no encontrado" });

  res.download(path.join(UPLOADS_DIR, attachment.storedName), attachment.originalName);
});

/**
 * Etiqueta térmica imprimible de un rollo: QR con el código `RL-<id>` (mismo
 * formato que la etiqueta de productos), para pegar en el rollo físico. Al
 * escanearla en la OP derivada se resuelve con GET /rolls/by-code/:code.
 */
productionOrdersRouter.get("/:id/rolls/:rollId/label", async (req, res) => {
  const productionOrderId = Number(req.params.id);
  const rollId = Number(req.params.rollId);
  if (!Number.isInteger(productionOrderId) || !Number.isInteger(rollId)) {
    return res.status(400).json({ error: "Id inválido" });
  }

  const roll = await prisma.productionRoll.findFirst({
    where: { id: rollId, productionOrderId },
    include: { productionOrder: { select: { orderNumber: true, product: { select: { name: true } } } } },
  });
  if (!roll) return res.status(404).json({ error: "Rollo no encontrado" });

  const code = `RL-${roll.id}`;
  const qrDataUrl = await QRCode.toDataURL(code);
  res.json({
    code,
    label: roll.label,
    weightKg: roll.weightKg,
    orderNumber: roll.productionOrder.orderNumber,
    productName: roll.productionOrder.product.name,
    qrDataUrl,
  });
});
