import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth, requireRole, ROLES } from "../middleware/auth";
import { applyMovement } from "../services/stockService";
import { sendWhatsAppMessage } from "../services/whatsapp";

export const dispatchesRouter = Router();
dispatchesRouter.use(requireAuth);

const requireAlmacen = requireRole(...ROLES.ALMACEN);
dispatchesRouter.use(requireAlmacen);

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

/**
 * Histórico de cuánto se le ha despachado a cada cliente — el cliente pidió
 * poder ver esto de un vistazo en vez de sumarlo a mano revisando despacho
 * por despacho. Se agrupa por cliente + producto (sumar entre productos con
 * unidades distintas no tendría sentido); solo cuenta lo que ya salió de
 * verdad (`quantityDispatched` cargado), no lo pendiente.
 */
dispatchesRouter.get("/summary-by-client", async (_req, res) => {
  const items = await prisma.dispatchItem.findMany({
    where: { quantityDispatched: { not: null } },
    select: {
      quantityDispatched: true,
      dispatch: { select: { clientId: true, client: { select: { name: true } }, dispatchedDate: true } },
      product: { select: { id: true, name: true, unit: true } },
    },
  });

  const byClientProduct = new Map<
    string,
    { clientId: number; clientName: string; productId: number; productName: string; unit: string; totalQuantity: number; dispatchCount: number; lastDispatchedDate: Date | null }
  >();
  for (const item of items) {
    const key = `${item.dispatch.clientId}|${item.product.id}`;
    const acc = byClientProduct.get(key) ?? {
      clientId: item.dispatch.clientId,
      clientName: item.dispatch.client.name,
      productId: item.product.id,
      productName: item.product.name,
      unit: item.product.unit,
      totalQuantity: 0,
      dispatchCount: 0,
      lastDispatchedDate: null,
    };
    acc.totalQuantity += Number(item.quantityDispatched);
    acc.dispatchCount += 1;
    if (item.dispatch.dispatchedDate && (!acc.lastDispatchedDate || item.dispatch.dispatchedDate > acc.lastDispatchedDate)) {
      acc.lastDispatchedDate = item.dispatch.dispatchedDate;
    }
    byClientProduct.set(key, acc);
  }

  const result = [...byClientProduct.values()].sort((a, b) => a.clientName.localeCompare(b.clientName) || a.productName.localeCompare(b.productName));
  res.json(result);
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

dispatchesRouter.post("/", requireAlmacen, async (req, res) => {
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
dispatchesRouter.patch("/:dispatchId/items/:itemId", requireAlmacen, async (req, res) => {
  const dispatchId = Number(req.params.dispatchId);
  const itemId = Number(req.params.itemId);
  const quantitySchema = z.object({ quantityDispatched: z.number().positive() });
  const parsed = quantitySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const item = await prisma.dispatchItem.findFirst({ where: { id: itemId, dispatchId } });
  if (!item) return res.status(404).json({ error: "Item de despacho no encontrado" });

  // Se lee ANTES de la transacción para poder distinguir "recién se completó
  // ahora" de "ya estaba despachado y esto es un doble click/reintento" —
  // si no, dos requests casi simultáneas (o un reintento de red del último
  // ítem) mandarían el WhatsApp de "despachado" dos o tres veces seguidas.
  const dispatchBefore = await prisma.dispatch.findUnique({ where: { id: dispatchId }, select: { status: true } });

  let dispatchCompleted = false;

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
    dispatchCompleted = remainingPending === 0;

    await tx.dispatch.update({
      where: { id: dispatchId },
      data: {
        status: dispatchCompleted ? "despachado" : "en_proceso",
        dispatchedDate: dispatchCompleted ? new Date() : undefined,
      },
    });
  });

  if (dispatchCompleted && dispatchBefore?.status !== "despachado") {
    const dispatch = await prisma.dispatch.findUnique({
      where: { id: dispatchId },
      include: { client: { include: { contacts: true } } },
    });
    const phone = dispatch?.client.contacts.find((c) => c.isPrimary)?.phone ?? dispatch?.client.contacts[0]?.phone;
    if (dispatch && phone) {
      await sendWhatsAppMessage(
        phone,
        `Hola ${dispatch.client.name}, tu pedido fue despachado. ¡Gracias por tu compra! — Plásticos Superior S.A.S.`
      );
    }
  }

  res.json({ ok: true });
});
