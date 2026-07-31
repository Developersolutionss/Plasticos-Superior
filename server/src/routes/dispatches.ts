import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { applyMovement } from "../services/stockService";

export const dispatchesRouter = Router();
dispatchesRouter.use(requireAuth);

dispatchesRouter.get("/", async (req, res) => {
  const { clientId, status } = req.query as { clientId?: string; status?: string };

  const dispatches = await prisma.dispatch.findMany({
    where: {
      clientId: clientId ? Number(clientId) : undefined,
      status: status as any,
    },
    include: { client: true, items: { include: { product: true } } },
    orderBy: { requestedDate: "desc" },
  });
  res.json(dispatches);
});

const createDispatchSchema = z.object({
  clientId: z.number().int(),
  items: z
    .array(
      z.object({
        productId: z.number().int(),
        quantityRequested: z.number().positive(),
        labelCode: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .min(1),
});

dispatchesRouter.post("/", async (req, res) => {
  const parsed = createDispatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const dispatch = await prisma.dispatch.create({
    data: {
      clientId: parsed.data.clientId,
      createdById: req.user!.userId,
      items: { create: parsed.data.items },
    },
    include: { items: true },
  });

  res.status(201).json(dispatch);
});

/** Marca un item del despacho como despachado: descuenta stock automáticamente. */
dispatchesRouter.patch("/:dispatchId/items/:itemId", async (req, res) => {
  const dispatchId = Number(req.params.dispatchId);
  const itemId = Number(req.params.itemId);
  const quantitySchema = z.object({ quantityDispatched: z.number().positive() });
  const parsed = quantitySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const item = await prisma.dispatchItem.findFirst({ where: { id: itemId, dispatchId } });
  if (!item) return res.status(404).json({ error: "Item de despacho no encontrado" });

  await prisma.$transaction(async (tx) => {
    await tx.dispatchItem.update({
      where: { id: itemId },
      data: { quantityDispatched: parsed.data.quantityDispatched },
    });

    await applyMovement(tx, {
      productId: item.productId,
      quantity: -parsed.data.quantityDispatched,
      movementType: "salida_despacho",
      referenceType: "dispatch_item",
      referenceId: item.id,
      createdById: req.user!.userId,
    });

    const remainingPending = await tx.dispatchItem.count({
      where: { dispatchId, quantityDispatched: null },
    });

    await tx.dispatch.update({
      where: { id: dispatchId },
      data: {
        status: remainingPending === 0 ? "despachado" : "en_proceso",
        dispatchedDate: remainingPending === 0 ? new Date() : undefined,
      },
    });
  });

  res.json({ ok: true });
});
