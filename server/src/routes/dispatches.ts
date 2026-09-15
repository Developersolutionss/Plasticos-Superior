import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth, requireRole, ROLES } from "../middleware/auth";
import { applyMovement, InsufficientStockError } from "../services/stockService";
import { sendWhatsAppMessage } from "../services/whatsapp";

class ItemAlreadyDispatchedError extends Error {}
class AlreadyCancelledError extends Error {}

export const dispatchesRouter = Router();
dispatchesRouter.use(requireAuth);

const requireAlmacen = requireRole(...ROLES.ALMACEN);
// GET es de lectura ampliada (Almacén + Ventas, ver ROLES.DESPACHOS_LECTURA);
// todo lo demás (crear, marcar ítems, cancelar) sigue exigiendo Almacén, con
// `requireAlmacen` puesto explícito en cada ruta de mutación de acá abajo.
dispatchesRouter.use(requireRole(...ROLES.DESPACHOS_LECTURA));

const DISPATCH_STATUSES = ["pendiente", "en_proceso", "despachado", "cancelada"] as const;

dispatchesRouter.get("/", async (req, res) => {
  const { clientId } = req.query as { clientId?: string };
  const statusParam = req.query.status as string | undefined;
  if (statusParam !== undefined && !DISPATCH_STATUSES.includes(statusParam as any)) {
    return res.status(400).json({ error: "Status inválido" });
  }

  const dispatches = await prisma.dispatch.findMany({
    where: {
      clientId: clientId ? Number(clientId) : undefined,
      status: statusParam as (typeof DISPATCH_STATUSES)[number] | undefined,
    },
    include: { client: true, items: { include: { product: true } }, createdBy: { select: { name: true } } },
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
    // Un despacho cancelado (ver POST /:id/cancel) NO borra quantityDispatched
    // de sus ítems (queda como registro histórico de qué se llegó a
    // despachar antes de cancelar) -- pero acá contaría como si el cliente
    // todavía tuviera ese producto, cuando el stock ya se revirtió.
    where: { quantityDispatched: { not: null }, dispatch: { status: { not: "cancelada" } } },
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

  // Antes esto iba directo al create: un clientId o productId inexistente
  // rompía la FK y tiraba un 500 crudo (sin manejador de errores global en
  // index.ts que lo traduzca) en vez de un mensaje claro -- y un producto
  // desactivado se aceptaba sin ningún aviso.
  const client = await prisma.client.findUnique({ where: { id: parsed.data.clientId } });
  if (!client) return res.status(404).json({ error: "Cliente no encontrado" });

  const productIds = [...new Set(parsed.data.items.map((it) => it.productId))];
  const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, active: true, name: true } });
  const productById = new Map(products.map((p) => [p.id, p]));
  for (const productId of productIds) {
    const product = productById.get(productId);
    if (!product) return res.status(404).json({ error: `Producto ${productId} no encontrado` });
    if (!product.active) return res.status(400).json({ error: `${product.name} está desactivado, no se puede despachar` });
  }

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

const dispatchItemSchema = z.object({
  quantityDispatched: z.number().positive(),
  /** Ubicación física de la que sale el producto (opcional — un producto
   * sin stock ubicado sigue pudiendo despacharse, solo contra el total
   * agregado, igual que antes). Si se manda y esa ubicación no tiene
   * suficiente cantidad, se rechaza (ver decrementLocationStock). */
  locationId: z.number().int().optional(),
});

/** Marca un item del despacho como despachado: descuenta stock automáticamente. */
dispatchesRouter.patch("/:dispatchId/items/:itemId", requireAlmacen, async (req, res) => {
  const dispatchId = Number(req.params.dispatchId);
  const itemId = Number(req.params.itemId);
  if (!Number.isInteger(dispatchId) || !Number.isInteger(itemId)) {
    return res.status(400).json({ error: "IDs inválidos" });
  }
  const parsed = dispatchItemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const item = await prisma.dispatchItem.findFirst({ where: { id: itemId, dispatchId } });
  if (!item) return res.status(404).json({ error: "Item de despacho no encontrado" });
  // Nunca se despacha más de lo pedido -- se bloquea siempre, nunca se deja
  // pasar con un aviso (mismo criterio que el resto de esta auditoría).
  if (parsed.data.quantityDispatched > Number(item.quantityRequested)) {
    return res.status(400).json({ error: `No se puede despachar más de lo pedido (${Number(item.quantityRequested)})` });
  }

  // Se lee ANTES de la transacción para poder distinguir "recién se completó
  // ahora" de "ya estaba despachado y esto es un doble click/reintento" —
  // si no, dos requests casi simultáneas (o un reintento de red del último
  // ítem) mandarían el WhatsApp de "despachado" dos o tres veces seguidas.
  const dispatchBefore = await prisma.dispatch.findUnique({ where: { id: dispatchId }, select: { status: true } });
  if (dispatchBefore?.status === "cancelada") {
    return res.status(400).json({ error: "Este despacho está cancelado" });
  }

  let dispatchCompleted = false;

  try {
    await prisma.$transaction(async (tx) => {
      // Claim atómico y condicional (mismo patrón que /close y /reopen en
      // Órdenes de Producción): si dos requests casi simultáneas (doble
      // clic, reintento de red, el mismo QR escaneado dos veces) llegan acá,
      // solo una encuentra `quantityDispatched: null` y logra el update —
      // la otra ve count=0 y aborta ANTES de tocar el stock, así nunca se
      // descuenta dos veces el mismo ítem.
      // También exige que el despacho no esté cancelado, como parte del
      // MISMO update atómico — si se chequeara aparte (como el
      // `dispatchBefore` de arriba, que es solo para el aviso de WhatsApp),
      // una cancelación podría colarse en la ventana entre ese chequeo y
      // este claim, dejando un ítem descontado que la cancelación ya no
      // llega a revertir.
      const claimed = await tx.dispatchItem.updateMany({
        where: { id: itemId, dispatchId, quantityDispatched: null, dispatch: { status: { not: "cancelada" } } },
        data: { quantityDispatched: parsed.data.quantityDispatched, locationId: parsed.data.locationId },
      });
      if (claimed.count === 0) throw new ItemAlreadyDispatchedError();

      await applyMovement(tx, {
        productId: item.productId,
        quantity: -parsed.data.quantityDispatched,
        movementType: "salida_despacho",
        referenceType: "dispatch_item",
        referenceId: item.id,
        createdById: req.user!.userId,
        locationId: parsed.data.locationId,
      });

      // Bloquea la fila del despacho antes de contar cuánto falta: sin esto,
      // si los dos ÚLTIMOS ítems pendientes se completan casi al mismo
      // tiempo (dos requests concurrentes, cada una en su propia
      // transacción), cada una cuenta el estado ANTES de que la otra
      // commitee -- las dos ven "todavía falta 1" y ninguna marca el
      // despacho como completo, quedando trabado en "en_proceso" para
      // siempre. El lock fuerza a la segunda transacción a esperar a que la
      // primera termine, así ve el conteo real y actualizado.
      await tx.$queryRaw`SELECT id FROM dispatches WHERE id = ${dispatchId} FOR UPDATE`;

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
  } catch (err) {
    if (err instanceof ItemAlreadyDispatchedError) {
      return res.status(400).json({ error: "Este ítem ya fue despachado, o el despacho se canceló mientras se procesaba" });
    }
    if (err instanceof InsufficientStockError) {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }

  if (dispatchCompleted && dispatchBefore?.status !== "despachado") {
    const dispatch = await prisma.dispatch.findUnique({
      where: { id: dispatchId },
      include: { client: { include: { contacts: true } } },
    });
    const phone = dispatch?.client.contacts.find((c) => c.isPrimary)?.phone ?? dispatch?.client.contacts[0]?.phone;
    if (dispatch && phone) {
      const result = await sendWhatsAppMessage(
        phone,
        `Hola ${dispatch.client.name}, tu pedido fue despachado. ¡Gracias por tu compra! — Plásticos Superior S.A.S.`
      );
      await prisma.dispatch.update({
        where: { id: dispatchId },
        data: result.ok
          ? { notifiedAt: new Date(), notifyError: null }
          : { notifiedAt: null, notifyError: result.error },
      });
    } else if (dispatch) {
      // Sin ningún teléfono cargado no hay a quién avisar -- se deja
      // constancia explícita en vez de un no-op silencioso, para que
      // Almacén vea en la ficha del despacho que el cliente no se enteró.
      await prisma.dispatch.update({
        where: { id: dispatchId },
        data: { notifiedAt: null, notifyError: "El cliente no tiene teléfono de contacto cargado" },
      });
    }
  }

  res.json({ ok: true });
});

/**
 * Cancela un despacho — antes no existía NINGÚN camino para corregir un
 * despacho, ni siquiera uno que nunca se completó. Si ya tenía ítems
 * marcados como despachados (stock ya descontado), revierte esos
 * movimientos dentro de la misma transacción (y la ubicación de origen, si
 * se había cargado una) — mismo criterio que /reopen en Órdenes de
 * Producción. El histórico de `quantityDispatched` de cada ítem NO se
 * borra (queda como registro de qué se llegó a despachar antes de
 * cancelar); lo único que cambia es el estado del despacho.
 */
dispatchesRouter.post("/:dispatchId/cancel", requireAlmacen, async (req, res) => {
  const dispatchId = Number(req.params.dispatchId);
  if (!Number.isInteger(dispatchId)) return res.status(400).json({ error: "Id inválido" });

  const dispatchExists = await prisma.dispatch.findUnique({ where: { id: dispatchId }, select: { id: true } });
  if (!dispatchExists) return res.status(404).json({ error: "Despacho no encontrado" });

  let reversedTotal = 0;
  try {
    await prisma.$transaction(async (tx) => {
      // Claim atómico: dos cancelaciones casi simultáneas del mismo
      // despacho no pueden las dos revertir el mismo stock.
      const claimed = await tx.dispatch.updateMany({
        where: { id: dispatchId, status: { not: "cancelada" } },
        data: { status: "cancelada", cancelledAt: new Date(), cancelledById: req.user!.userId },
      });
      if (claimed.count === 0) throw new AlreadyCancelledError();

      // Los ítems se leen DENTRO de la transacción, después de ganar el
      // claim — si se leyeran antes (fuera de la tx), un ítem marcado
      // despachado justo en la ventana entre esa lectura y el claim de
      // arriba quedaría afuera de esta lista: su stock se descontaría y
      // jamás se revertiría, sin que la cancelación falle ni avise nada.
      const items = await tx.dispatchItem.findMany({ where: { dispatchId } });
      for (const item of items) {
        if (item.quantityDispatched == null) continue;
        const qty = Number(item.quantityDispatched);
        reversedTotal += qty;
        await applyMovement(tx, {
          productId: item.productId,
          quantity: qty,
          movementType: "devolucion",
          referenceType: "dispatch_item",
          referenceId: item.id,
          createdById: req.user!.userId,
          locationId: item.locationId ?? undefined,
        });
      }
    });
  } catch (err) {
    if (err instanceof AlreadyCancelledError) {
      return res.status(400).json({ error: "Este despacho ya está cancelado" });
    }
    throw err;
  }

  res.json({ ok: true, reversedTotal });
});
