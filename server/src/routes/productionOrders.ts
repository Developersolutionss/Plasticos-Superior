import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { applyMovement } from "../services/stockService";

export const productionOrdersRouter = Router();
productionOrdersRouter.use(requireAuth);

productionOrdersRouter.get("/", async (req, res) => {
  const status = req.query.status as string | undefined;
  const orders = await prisma.productionOrder.findMany({
    where: { status: status as any },
    include: { product: true, stages: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(orders);
});

const createOrderSchema = z.object({
  productId: z.number().int(),
  quantityPlanned: z.number().positive(),
  measure: z.string().optional(),
  notes: z.string().optional(),
});

/** Crea una OP con numeración consecutiva (OP-00001, OP-00002, ...). */
productionOrdersRouter.post("/", async (req, res) => {
  const parsed = createOrderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const product = await prisma.product.findUnique({ where: { id: parsed.data.productId } });
  if (!product) return res.status(404).json({ error: "Producto no encontrado" });

  const order = await prisma.$transaction(async (tx) => {
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
  });

  res.status(201).json(order);
});

const updateStatusSchema = z.object({
  status: z.enum(["pendiente", "en_proceso", "detenida", "finalizada", "cancelada"]),
});

productionOrdersRouter.patch("/:id/status", async (req, res) => {
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
 * "precorte" (último paso del proceso), además genera automáticamente la
 * entrada de inventario del producto terminado y marca la OP finalizada.
 */
productionOrdersRouter.post("/:id/stages", async (req, res) => {
  const productionOrderId = Number(req.params.id);
  const parsed = createStageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

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
      await applyMovement(tx, {
        productId: order.productId,
        quantity: parsed.data.kilosProduced,
        movementType: "entrada_produccion",
        referenceType: "manual_adjustment",
        referenceId: created.id,
        createdById: req.user!.userId,
      });

      await tx.productionOrder.update({ where: { id: productionOrderId }, data: { status: "finalizada" } });
    } else if (order.status === "pendiente") {
      await tx.productionOrder.update({ where: { id: productionOrderId }, data: { status: "en_proceso" } });
    }

    return created;
  });

  res.status(201).json(stage);
});
