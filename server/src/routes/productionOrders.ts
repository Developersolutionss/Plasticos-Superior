import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client";
import { prisma } from "../prisma";
import { requireAuth, requireRole, ROLES, OPERARIO_STATIONS } from "../middleware/auth";
import { applyMovement } from "../services/stockService";
import { withSequentialNumberRetry } from "../services/sequentialNumber";

export const productionOrdersRouter = Router();
productionOrdersRouter.use(requireAuth);

const requireProduccionGestion = requireRole(...ROLES.PRODUCCION_GESTION);
const requireOperarios = requireRole(...ROLES.OPERARIOS);
const requireCalidad = requireRole(...ROLES.CALIDAD);
// Calidad necesita GET / (para ver la cola ?status=pendiente_calidad) y
// GET /:id/stages (para revisar el detalle del precorte al decidir);
// Auditoría necesita GET /:id (Trazabilidad) — por eso ambos se admiten
// acá a nivel de router, además de en sus endpoints propios de mutación.
productionOrdersRouter.use(requireRole(...ROLES.OPERARIOS, ...ROLES.CALIDAD, ...ROLES.AUDITORIA));

productionOrdersRouter.get("/", async (req, res) => {
  const status = req.query.status as string | undefined;
  const orders = await prisma.productionOrder.findMany({
    where: { status: status as any },
    include: { product: true, stages: { orderBy: { createdAt: "asc" } } },
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
 * Detalle completo de una OP para Trazabilidad: sus pasos por estación, el
 * resultado de Calidad (si ya se registró) y el pedido/cliente de origen
 * (si vino de Planeación en vez de crearse manualmente).
 */
productionOrdersRouter.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido" });

  const order = await prisma.productionOrder.findUnique({
    where: { id },
    include: {
      product: true,
      stages: { orderBy: { createdAt: "asc" } },
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
  productId: z.number().int(),
  quantityPlanned: z.number().positive(),
  measure: z.string().optional(),
  notes: z.string().optional(),
});

/** Crea una OP con numeración consecutiva (OP-00001, OP-00002, ...). */
productionOrdersRouter.post("/", requireProduccionGestion, async (req, res) => {
  const parsed = createOrderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const product = await prisma.product.findUnique({ where: { id: parsed.data.productId } });
  if (!product) return res.status(404).json({ error: "Producto no encontrado" });

  const order = await withSequentialNumberRetry(() =>
    prisma.$transaction(async (tx) => {
      const count = await tx.productionOrder.count();
      const orderNumber = `OP-${String(count + 1).padStart(5, "0")}`;

      return tx.productionOrder.create({
        data: {
          orderNumber,
          productId: parsed.data.productId,
          quantityPlanned: parsed.data.quantityPlanned,
          measure: parsed.data.measure ?? product.measure,
          notes: parsed.data.notes,
          createdById: req.user!.userId,
        },
      });
    })
  );

  res.status(201).json(order);
});

/** Genera la OP correspondiente a un item de pedido pendiente de planeación. */
productionOrdersRouter.post("/from-pedido-item/:pedidoVersionItemId", requireProduccionGestion, async (req, res) => {
  const pedidoVersionItemId = Number(req.params.pedidoVersionItemId);
  if (!Number.isInteger(pedidoVersionItemId)) return res.status(400).json({ error: "Id inválido" });

  const item = await prisma.pedidoVersionItem.findUnique({
    where: { id: pedidoVersionItemId },
    include: { product: true, productionOrder: true },
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
          productId: item.productId,
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

const createStageSchema = z.object({
  station: z.enum(["extrusion", "impresion", "sellado", "precorte"]),
  machine: z.string().min(1),
  operatorName: z.string().min(1),
  startTime: z.string(),
  endTime: z.string().optional(),
  kilosProduced: z.number().positive(),
  mermaKg: z.number().min(0).optional().default(0),
  downtimeMinutes: z.number().int().min(0).optional().default(0),
  downtimeReason: z.string().optional(),
  details: z.record(z.string(), z.any()).optional(),
  notes: z.string().optional(),
});

productionOrdersRouter.get("/:id/stages", async (req, res) => {
  const productionOrderId = Number(req.params.id);
  const stages = await prisma.productionStageLog.findMany({
    where: { productionOrderId },
    orderBy: { createdAt: "asc" },
  });
  res.json(stages);
});

/**
 * Registra el paso de una OP por una estación. Cuando la estación es
 * "precorte" (último paso del proceso), la OP queda "pendiente_calidad" en
 * vez de finalizarse: recién se genera la entrada de inventario y se
 * finaliza cuando Calidad la aprueba (ver POST /:id/quality-check).
 */
productionOrdersRouter.post("/:id/stages", requireOperarios, async (req, res) => {
  const productionOrderId = Number(req.params.id);
  const parsed = createStageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // Un operario solo puede registrar pasos de SU estación (gerente_produccion
  // y planeacion, en cambio, pueden cargar cualquiera, por eso solo se
  // restringe cuando el rol tiene una lista de estaciones asociada).
  const allowedStations = OPERARIO_STATIONS[req.user!.role];
  if (allowedStations && !allowedStations.includes(parsed.data.station)) {
    return res.status(403).json({ error: `Tu rol solo puede registrar pasos de: ${allowedStations.join(", ")}` });
  }

  const order = await prisma.productionOrder.findUnique({ where: { id: productionOrderId } });
  if (!order) return res.status(404).json({ error: "OP no encontrada" });

  const stage = await prisma.$transaction(async (tx) => {
    const created = await tx.productionStageLog.create({
      data: {
        productionOrderId,
        station: parsed.data.station,
        machine: parsed.data.machine,
        operatorName: parsed.data.operatorName,
        startTime: new Date(parsed.data.startTime),
        endTime: parsed.data.endTime ? new Date(parsed.data.endTime) : undefined,
        kilosProduced: parsed.data.kilosProduced,
        mermaKg: parsed.data.mermaKg,
        downtimeMinutes: parsed.data.downtimeMinutes,
        downtimeReason: parsed.data.downtimeReason,
        details: parsed.data.details as Prisma.InputJsonValue | undefined,
        notes: parsed.data.notes,
        createdById: req.user!.userId,
      },
    });

    if (parsed.data.station === "precorte") {
      await tx.productionOrder.update({ where: { id: productionOrderId }, data: { status: "pendiente_calidad" } });
    } else if (order.status === "pendiente") {
      await tx.productionOrder.update({ where: { id: productionOrderId }, data: { status: "en_proceso" } });
    }

    return created;
  });

  res.status(201).json(stage);
});

const qualityCheckSchema = z.object({
  result: z.enum(["aprobado", "rechazado"]),
  observations: z.string().optional(),
});

/**
 * Aprueba o rechaza el lote de una OP que ya pasó por precorte. Si se
 * aprueba, recién ahí se genera la entrada de inventario (con el kilaje
 * registrado en el paso de precorte) y la OP queda finalizada; si se
 * rechaza, la OP queda "detenida" sin mover stock.
 */
productionOrdersRouter.post("/:id/quality-check", requireCalidad, async (req, res) => {
  const productionOrderId = Number(req.params.id);
  const parsed = qualityCheckSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const order = await prisma.productionOrder.findUnique({
    where: { id: productionOrderId },
    include: { qualityCheck: true },
  });
  if (!order) return res.status(404).json({ error: "OP no encontrada" });
  if (order.status !== "pendiente_calidad") {
    return res.status(400).json({ error: "Esta OP no está pendiente de control de calidad" });
  }
  if (order.qualityCheck) {
    return res.status(400).json({ error: "Esta OP ya tiene un control de calidad registrado" });
  }

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
      const precorteStage = await tx.productionStageLog.findFirst({
        where: { productionOrderId, station: "precorte" },
        orderBy: { createdAt: "desc" },
      });
      if (precorteStage) {
        await applyMovement(tx, {
          productId: order.productId,
          quantity: Number(precorteStage.kilosProduced),
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

  res.status(201).json(check);
});
