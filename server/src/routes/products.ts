import { Router } from "express";
import { z } from "zod";
import { Prisma } from "../generated/prisma/client";
import { prisma } from "../prisma";
import { requireAuth, requireRole, ROLES } from "../middleware/auth";

export const productsRouter = Router();
productsRouter.use(requireAuth);

/** El maestro de productos lo gestiona Producción/Gestión (mismo rol que ya
 * crea Órdenes de Producción) — Ventas/Almacén solo consumen el catálogo. */
const requireProduccionGestion = requireRole(...ROLES.PRODUCCION_GESTION);

/** Lista todos los productos (incluye inactivos) para la pantalla de gestión.
 * El selector filtrado para otros módulos sigue siendo GET /inventory/products. */
productsRouter.get("/", async (_req, res) => {
  const products = await prisma.product.findMany({ orderBy: { name: "asc" } });
  res.json(products);
});

const productSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(["bultos", "rollos_prec_lam", "rollos_fuelle", "mangueta", "tiras", "control_impresion"]),
  measure: z.string().optional(),
  unit: z.enum(["kg", "unidad"]),
  minStock: z.number().min(0),
  unitPrice: z.number().min(0),
});

productsRouter.post("/", requireProduccionGestion, async (req, res) => {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const product = await prisma.product.create({ data: parsed.data });
    res.status(201).json(product);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({ error: "Ya existe un producto con ese SKU" });
    }
    throw err;
  }
});

const updateProductSchema = productSchema.partial();

productsRouter.patch("/:id", requireProduccionGestion, async (req, res) => {
  const productId = Number(req.params.id);
  if (!Number.isInteger(productId) || productId <= 0) {
    return res.status(400).json({ error: "ID de producto inválido" });
  }

  const parsed = updateProductSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (Object.keys(parsed.data).length === 0) {
    return res.status(400).json({ error: "No se indicó ningún campo para actualizar" });
  }

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return res.status(404).json({ error: "Producto no encontrado" });

  try {
    const updated = await prisma.product.update({ where: { id: productId }, data: parsed.data });
    res.json(updated);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({ error: "Ya existe un producto con ese SKU" });
    }
    throw err;
  }
});

/** Elimina (desactiva) un producto. Soft delete: el registro se conserva
 * porque tiene movimientos/facturas/OPs relacionadas; el selector de otros
 * módulos (GET /inventory/products) solo devuelve productos `active: true`. */
productsRouter.delete("/:id", requireProduccionGestion, async (req, res) => {
  const productId = Number(req.params.id);
  if (!Number.isInteger(productId) || productId <= 0) {
    return res.status(400).json({ error: "ID de producto inválido" });
  }

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return res.status(404).json({ error: "Producto no encontrado" });

  const updated = await prisma.product.update({ where: { id: productId }, data: { active: false } });
  res.json(updated);
});
