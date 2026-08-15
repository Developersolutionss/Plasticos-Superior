import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth, requireRole, ROLES } from "../middleware/auth";
import { withSequentialNumberRetry } from "../services/sequentialNumber";
import type { TxClient } from "../services/stockService";

export const facturasRouter = Router();
facturasRouter.use(requireAuth);

const requireVentas = requireRole(...ROLES.VENTAS);
facturasRouter.use(requireVentas);

/** Recalcula el estado de una factura según lo que se haya pagado hasta ahora. */
async function recalculateStatus(tx: TxClient, facturaId: number) {
  const factura = await tx.factura.findUniqueOrThrow({
    where: { id: facturaId },
    include: { items: true, payments: true },
  });
  if (factura.status === "anulada") return factura;

  const total = factura.items.reduce((sum, it) => sum + Number(it.quantity) * Number(it.unitPrice), 0);
  const paid = factura.payments.reduce((sum, p) => sum + Number(p.amount), 0);

  const status = paid <= 0 ? "emitida" : paid < total ? "pagada_parcial" : "pagada";
  if (status !== factura.status) {
    await tx.factura.update({ where: { id: facturaId }, data: { status } });
  }
  return { ...factura, status };
}

facturasRouter.get("/", async (req, res) => {
  const clientId = req.query.clientId ? Number(req.query.clientId) : undefined;
  const status = req.query.status as string | undefined;

  const facturas = await prisma.factura.findMany({
    where: { clientId, status: status as any },
    include: { client: true, items: { include: { product: true } }, payments: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(facturas);
});

const itemSchema = z.object({
  productId: z.number().int(),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0).optional(),
  measure: z.string().optional(),
});

const createFacturaSchema = z.object({
  clientId: z.number().int(),
  notes: z.string().optional(),
  dueDate: z.string().optional(),
  items: z.array(itemSchema).min(1),
});

/** Crea una factura suelta (sin pedido de por medio). */
facturasRouter.post("/", requireVentas, async (req, res) => {
  const parsed = createFacturaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const client = await prisma.client.findUnique({ where: { id: parsed.data.clientId } });
  if (!client) return res.status(404).json({ error: "Cliente no encontrado" });

  const products = await prisma.product.findMany({
    where: { id: { in: parsed.data.items.map((i) => i.productId) } },
  });
  const productById = new Map(products.map((p) => [p.id, p]));
  if (products.length !== new Set(parsed.data.items.map((i) => i.productId)).size) {
    return res.status(400).json({ error: "Uno o más productos no existen" });
  }

  const factura = await withSequentialNumberRetry(() =>
    prisma.$transaction(async (tx) => {
      const count = await tx.factura.count();
      const invoiceNumber = `FAC-${String(count + 1).padStart(5, "0")}`;

      return tx.factura.create({
        data: {
          invoiceNumber,
          clientId: parsed.data.clientId,
          notes: parsed.data.notes,
          dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : undefined,
          createdById: req.user!.userId,
          items: {
            create: parsed.data.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice ?? Number(productById.get(item.productId)!.unitPrice),
              measure: item.measure,
            })),
          },
        },
        include: { items: { include: { product: true } }, client: true },
      });
    })
  );

  res.status(201).json(factura);
});

const facturaDesdePedidoSchema = z.object({ dueDate: z.string().optional() }).optional();

/** Genera una factura a partir de la ÚLTIMA versión de un Pedido, copiando sus ítems. */
facturasRouter.post("/desde-pedido/:pedidoId", requireVentas, async (req, res) => {
  const parsedBody = facturaDesdePedidoSchema.safeParse(req.body);
  if (!parsedBody.success) return res.status(400).json({ error: parsedBody.error.flatten() });

  const pedidoId = Number(req.params.pedidoId);
  const pedido = await prisma.pedido.findUnique({
    where: { id: pedidoId },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1, include: { items: true } } },
  });
  if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });

  const latestVersion = pedido.versions[0];
  if (!latestVersion || latestVersion.items.length === 0) {
    return res.status(400).json({ error: "El pedido no tiene ítems para facturar" });
  }

  const factura = await withSequentialNumberRetry(() =>
    prisma.$transaction(async (tx) => {
      const count = await tx.factura.count();
      const invoiceNumber = `FAC-${String(count + 1).padStart(5, "0")}`;

      return tx.factura.create({
        data: {
          invoiceNumber,
          clientId: pedido.clientId,
          pedidoId: pedido.id,
          dueDate: parsedBody.data?.dueDate ? new Date(parsedBody.data.dueDate) : undefined,
          createdById: req.user!.userId,
          items: {
            create: latestVersion.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              measure: item.measure,
            })),
          },
        },
        include: { items: { include: { product: true } }, client: true },
      });
    })
  );

  res.status(201).json(factura);
});

facturasRouter.patch("/:id/anular", requireVentas, async (req, res) => {
  const id = Number(req.params.id);
  const factura = await prisma.factura.findUnique({ where: { id } });
  if (!factura) return res.status(404).json({ error: "Factura no encontrada" });

  const updated = await prisma.factura.update({ where: { id }, data: { status: "anulada" } });
  res.json(updated);
});

/* ── Pagos ─────────────────────────────────────────────────────────── */

facturasRouter.get("/:id/payments", async (req, res) => {
  const facturaId = Number(req.params.id);
  const payments = await prisma.payment.findMany({ where: { facturaId }, orderBy: { paidAt: "desc" } });
  res.json(payments);
});

const createPaymentSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(["efectivo", "transferencia", "cheque", "tarjeta", "otro"]),
  paidAt: z.string().optional(),
  notes: z.string().optional(),
});

/** Registra un abono. La factura recalcula sola su estado (emitida/parcial/pagada). */
facturasRouter.post("/:id/payments", requireVentas, async (req, res) => {
  const facturaId = Number(req.params.id);
  const parsed = createPaymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const factura = await prisma.factura.findUnique({ where: { id: facturaId } });
  if (!factura) return res.status(404).json({ error: "Factura no encontrada" });
  if (factura.status === "anulada") return res.status(400).json({ error: "La factura está anulada" });

  const payment = await prisma.$transaction(async (tx) => {
    const created = await tx.payment.create({
      data: {
        facturaId,
        amount: parsed.data.amount,
        method: parsed.data.method,
        paidAt: parsed.data.paidAt ? new Date(parsed.data.paidAt) : undefined,
        notes: parsed.data.notes,
        createdById: req.user!.userId,
      },
    });
    await recalculateStatus(tx, facturaId);
    return created;
  });

  res.status(201).json(payment);
});
