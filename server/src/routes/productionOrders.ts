import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import QRCode from "qrcode";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client";
import { prisma } from "../prisma";
import { requireAuth, requireRole, ROLES, OPERARIO_STATIONS } from "../middleware/auth";
import { applyMovement } from "../services/stockService";
import { withSequentialNumberRetry } from "../services/sequentialNumber";
import { notifyRoles } from "../services/notify";
import { buildOpPdf } from "../services/opPdf";
import { DERIVATIONS, FINAL_STATIONS, OpStation } from "../services/opTemplates";

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

const requireProduccionGestion = requireRole(...ROLES.PRODUCCION_GESTION);
const requireOperarios = requireRole(...ROLES.OPERARIOS);
const requireCalidad = requireRole(...ROLES.CALIDAD);
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
  const orders = await prisma.productionOrder.findMany({
    where: { status: status as any, station: station as any },
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

  res.json(order);
});

const createOrderSchema = z.object({
  station: z.enum(STATIONS).default("extrusion"),
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
      const count = await tx.productionOrder.count();
      const orderNumber = `OP-${String(count + 1).padStart(5, "0")}`;

      return tx.productionOrder.create({
        data: {
          orderNumber,
          station: parsed.data.station,
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
 * Nace como OP de Extrusión (el proceso base) con el cliente del pedido; los
 * procesos siguientes se derivan desde ella.
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
      const count = await tx.productionOrder.count();
      const orderNumber = `OP-${String(count + 1).padStart(5, "0")}`;

      return tx.productionOrder.create({
        data: {
          orderNumber,
          station: "extrusion",
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

const deriveSchema = z.object({
  station: z.enum(STATIONS),
  quantityPlanned: z.number().positive().optional(),
  measure: z.string().optional(),
  specs: z.record(z.string(), z.any()).optional(),
  notes: z.string().optional(),
});

/**
 * Deriva una OP hija hacia el siguiente proceso (Extrusión → Impresión/
 * Sellado/Precorte; Impresión → Sellado/Precorte). Hereda producto, cliente,
 * medida y cantidad del padre salvo que el body los pise.
 */
productionOrdersRouter.post("/:id/derive", requireProduccionGestion, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido" });
  const parsed = deriveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const parent = await prisma.productionOrder.findUnique({ where: { id } });
  if (!parent) return res.status(404).json({ error: "OP no encontrada" });
  if (parent.status === "cancelada") return res.status(400).json({ error: "No se puede derivar de una OP cancelada" });

  const allowed = DERIVATIONS[parent.station as OpStation];
  if (!allowed.includes(parsed.data.station)) {
    return res.status(400).json({
      error: allowed.length
        ? `Desde ${parent.station} solo se puede derivar a: ${allowed.join(", ")}`
        : `Una OP de ${parent.station} es un proceso final, no deriva a otro`,
    });
  }

  const order = await withSequentialNumberRetry(() =>
    prisma.$transaction(async (tx) => {
      const count = await tx.productionOrder.count();
      const orderNumber = `OP-${String(count + 1).padStart(5, "0")}`;

      return tx.productionOrder.create({
        data: {
          orderNumber,
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
    })
  );

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
  if (!OPEN_STATUSES.includes(order.status)) {
    return res.status(400).json({ error: "Solo se puede editar una OP abierta (pendiente o en proceso)" });
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

const updateStatusSchema = z.object({
  status: z.enum(["pendiente", "en_proceso", "pendiente_calidad", "detenida", "finalizada", "cancelada"]),
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
  if (allowedStations && !allowedStations.includes(order.station)) {
    return res.status(403).json({ error: `Tu rol solo puede operar OPs de: ${allowedStations.join(", ")}` });
  }

  if (order.rolls.length === 0) {
    return res.status(400).json({ error: "No se puede cerrar una OP sin rollos registrados" });
  }

  const isFinal = FINAL_STATIONS.includes(order.station as OpStation);
  const newStatus = isFinal ? "pendiente_calidad" : "finalizada";
  const updated = await prisma.productionOrder.update({ where: { id }, data: { status: newStatus } });

  if (isFinal) {
    await notifyRoles(ROLES.CALIDAD, {
      type: "op_pendiente_calidad",
      message: `OP #${order.orderNumber} lista para revisión de calidad`,
      link: "/calidad",
    });
  }

  res.json(updated);
});

const createRollSchema = z.object({
  date: z.string().optional(),
  shift: z.string().optional(),
  operatorName: z.string().min(1),
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
  if (allowedStations && !allowedStations.includes(order.station)) {
    return res.status(403).json({ error: `Tu rol solo puede registrar rollos en OPs de: ${allowedStations.join(", ")}` });
  }

  if (parsed.data.sourceRollId) {
    const source = await prisma.productionRoll.findUnique({ where: { id: parsed.data.sourceRollId } });
    if (!source) return res.status(404).json({ error: "El rollo de origen escaneado no existe" });
  }

  const roll = await prisma.$transaction(async (tx) => {
    const created = await tx.productionRoll.create({
      data: {
        productionOrderId,
        date: parsed.data.date ? new Date(parsed.data.date) : undefined,
        shift: parsed.data.shift,
        operatorName: parsed.data.operatorName,
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
