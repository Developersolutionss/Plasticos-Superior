import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";

export const cotizacionesRouter = Router();
cotizacionesRouter.use(requireAuth);

cotizacionesRouter.get("/", async (req, res) => {
  const clientId = req.query.clientId ? Number(req.query.clientId) : undefined;
  const cotizaciones = await prisma.cotizacion.findMany({
    where: { clientId },
    include: { client: true, items: { include: { product: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(cotizaciones);
});

const itemSchema = z.object({
  productId: z.number().int(),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0).optional(),
  measure: z.string().optional(),
});

const createCotizacionSchema = z.object({
  clientId: z.number().int(),
  validUntil: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(itemSchema).min(1),
});

/**
 * Crea una cotización con numeración consecutiva (COT-00001, ...).
 * Si un ítem no trae `unitPrice`, se toma el precio actual del catálogo.
 */
cotizacionesRouter.post("/", async (req, res) => {
  const parsed = createCotizacionSchema.safeParse(req.body);
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

  const cotizacion = await prisma.$transaction(async (tx) => {
    const count = await tx.cotizacion.count();
    const quoteNumber = `COT-${String(count + 1).padStart(5, "0")}`;

    return tx.cotizacion.create({
      data: {
        quoteNumber,
        clientId: parsed.data.clientId,
        validUntil: parsed.data.validUntil ? new Date(parsed.data.validUntil) : undefined,
        notes: parsed.data.notes,
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
  });

  res.status(201).json(cotizacion);
});

const updateStatusSchema = z.object({
  status: z.enum(["borrador", "enviada", "aceptada", "rechazada", "expirada"]),
});

cotizacionesRouter.patch("/:id/status", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = updateStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const cotizacion = await prisma.cotizacion.findUnique({ where: { id } });
  if (!cotizacion) return res.status(404).json({ error: "Cotización no encontrada" });

  const updated = await prisma.cotizacion.update({ where: { id }, data: { status: parsed.data.status } });
  res.json(updated);
});

/**
 * Convierte la cotización en un Pedido nuevo (v1), copiando sus ítems tal
 * cual. La cotización no se borra ni se modifica, solo queda enlazada.
 */
cotizacionesRouter.post("/:id/convertir-a-pedido", async (req, res) => {
  const id = Number(req.params.id);
  const cotizacion = await prisma.cotizacion.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!cotizacion) return res.status(404).json({ error: "Cotización no encontrada" });
  if (cotizacion.items.length === 0) return res.status(400).json({ error: "La cotización no tiene ítems" });

  const pedido = await prisma.$transaction(async (tx) => {
    const count = await tx.pedido.count();
    const orderNumber = `PED-${String(count + 1).padStart(5, "0")}`;

    return tx.pedido.create({
      data: {
        orderNumber,
        clientId: cotizacion.clientId,
        cotizacionId: cotizacion.id,
        status: "borrador",
        currentVersion: 1,
        createdById: req.user!.userId,
        versions: {
          create: {
            versionNumber: 1,
            status: "borrador",
            createdById: req.user!.userId,
            items: {
              create: cotizacion.items.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                measure: item.measure,
              })),
            },
          },
        },
      },
      include: { versions: { include: { items: true } } },
    });
  });

  res.status(201).json(pedido);
});
