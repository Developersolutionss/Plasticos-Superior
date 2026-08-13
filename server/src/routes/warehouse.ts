import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth, requireRole, ROLES } from "../middleware/auth";
import { getStockByCategory } from "../services/stockService";

export const warehouseRouter = Router();
warehouseRouter.use(requireAuth);
warehouseRouter.use(requireRole(...ROLES.ALMACEN));

warehouseRouter.get("/locations", async (_req, res) => {
  const locations = await prisma.warehouseLocation.findMany({ orderBy: { code: "asc" } });
  res.json(locations);
});

const createLocationSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
});

warehouseRouter.post("/locations", async (req, res) => {
  const parsed = createLocationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = await prisma.warehouseLocation.findUnique({ where: { code: parsed.data.code } });
  if (existing) return res.status(400).json({ error: "Ya existe una ubicación con ese código" });

  const location = await prisma.warehouseLocation.create({ data: parsed.data });
  res.status(201).json(location);
});

/**
 * Stock total (de InventoryStock) por producto, cruzado con sus
 * StockLocation. `unassigned` es lo que todavía no tiene ubicación
 * asignada — puede dar negativo si a alguien se le fue la mano ubicando
 * más de lo que hay, no se bloquea, es una herramienta operativa.
 */
warehouseRouter.get("/stock", async (_req, res) => {
  const [totals, locations] = await Promise.all([
    getStockByCategory(),
    prisma.stockLocation.findMany({ include: { location: true }, orderBy: { productId: "asc" } }),
  ]);

  const byProduct = new Map<number, typeof locations>();
  for (const row of locations) {
    if (!byProduct.has(row.productId)) byProduct.set(row.productId, []);
    byProduct.get(row.productId)!.push(row);
  }

  const result = totals.map((product) => {
    const productLocations = byProduct.get(product.id) ?? [];
    const located = productLocations.reduce((sum, row) => sum + Number(row.quantity), 0);
    return {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      unit: product.unit,
      totalStock: product.currentStock,
      unassigned: product.currentStock - located,
      locations: productLocations.map((row) => ({
        locationId: row.locationId,
        code: row.location.code,
        label: row.location.label,
        quantity: Number(row.quantity),
      })),
    };
  });

  res.json(result);
});

const assignSchema = z.object({
  productId: z.number().int(),
  toLocationId: z.number().int(),
  quantity: z.number().positive(),
  fromLocationId: z.number().int().optional(),
});

/**
 * Ubica stock sin asignar en una ubicación (sin `fromLocationId`), o mueve
 * cantidad de una ubicación a otra (con `fromLocationId`, validando que
 * la ubicación origen tenga suficiente).
 */
warehouseRouter.post("/assign", async (req, res) => {
  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { productId, toLocationId, quantity, fromLocationId } = parsed.data;

  const [product, toLocation] = await Promise.all([
    prisma.product.findUnique({ where: { id: productId } }),
    prisma.warehouseLocation.findUnique({ where: { id: toLocationId } }),
  ]);
  if (!product) return res.status(404).json({ error: "Producto no encontrado" });
  if (!toLocation) return res.status(404).json({ error: "Ubicación destino no encontrada" });

  await prisma.$transaction(async (tx) => {
    if (fromLocationId) {
      const fromStock = await tx.stockLocation.findUnique({
        where: { productId_locationId: { productId, locationId: fromLocationId } },
      });
      if (!fromStock || Number(fromStock.quantity) < quantity) {
        throw Object.assign(new Error("La ubicación de origen no tiene suficiente cantidad"), { status: 400 });
      }
      await tx.stockLocation.update({
        where: { productId_locationId: { productId, locationId: fromLocationId } },
        data: { quantity: { decrement: quantity }, updatedById: req.user!.userId },
      });
    }

    await tx.stockLocation.upsert({
      where: { productId_locationId: { productId, locationId: toLocationId } },
      create: { productId, locationId: toLocationId, quantity, updatedById: req.user!.userId },
      update: { quantity: { increment: quantity }, updatedById: req.user!.userId },
    });
  });

  res.status(201).json({ ok: true });
});

warehouseRouter.use((err: any, _req: any, res: any, _next: any) => {
  res.status(err.status ?? 500).json({ error: err.message ?? "Error inesperado" });
});
