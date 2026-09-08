import { Router } from "express";
import QRCode from "qrcode";
import { z } from "zod";
import { Prisma } from "../generated/prisma/client";
import { prisma } from "../prisma";
import { requireAuth, requireRole, ROLES } from "../middleware/auth";
import { withSequentialNumberRetry } from "../services/sequentialNumber";

export const productsRouter = Router();
productsRouter.use(requireAuth);

/** El maestro de productos lo gestiona Producción/Gestión (mismo rol que ya
 * crea Órdenes de Producción) — Ventas/Almacén solo consumen el catálogo. */
const requireProduccionGestion = requireRole(...ROLES.PRODUCCION_GESTION);

const CATEGORIES = [
  "bultos",
  "rollos_prec_lam",
  "rollos_fuelle",
  "mangueta",
  "tiras",
  "control_impresion",
  "tubular",
  "semitubular",
  "laminado",
] as const;

/** El cliente dijo que "SKU" no se entiende — en vez de pedirle que invente
 * un código, el sistema lo genera solo con el mismo patrón que ya usaban a
 * mano (prefijo de categoría + consecutivo de 3 dígitos, ej. "BUL-001"). El
 * usuario nunca lo escribe: solo lo ve como referencia en el catálogo/QR. */
const SKU_PREFIX: Record<(typeof CATEGORIES)[number], string> = {
  bultos: "BUL",
  rollos_prec_lam: "ROL-PL",
  rollos_fuelle: "ROL-F",
  mangueta: "MAN",
  tiras: "TIR",
  control_impresion: "CTL",
  tubular: "TUB",
  semitubular: "SEMI",
  laminado: "LAM",
};

/** Asume que nunca se hace hard delete de un producto (el sistema solo
 * desactiva con `active: false`) -- si algún día se borra uno del medio de
 * la secuencia a mano en la base, el próximo `count()+1` de esa categoría
 * puede volver a proponer un SKU que ya existe, y quedaría reintentando sin
 * poder resolverlo solo (a diferencia de COT-/PED-/FAC-, acá el reintento no
 * ayuda porque el conteo no cambia entre intentos). */
async function nextSku(category: (typeof CATEGORIES)[number]) {
  const prefix = SKU_PREFIX[category];
  const count = await prisma.product.count({ where: { sku: { startsWith: `${prefix}-` } } });
  return `${prefix}-${String(count + 1).padStart(3, "0")}`;
}

/** Lista todos los productos (incluye inactivos) para la pantalla de gestión.
 * El selector filtrado para otros módulos sigue siendo GET /inventory/products. */
productsRouter.get("/", async (_req, res) => {
  const products = await prisma.product.findMany({ orderBy: { name: "asc" } });
  res.json(products);
});

/** Etiqueta térmica imprimible: QR con el SKU (mismo formato que el QR de
 * ubicaciones de Almacén, así el mismo lector de cámara sirve para ambos). */
productsRouter.get("/:id/label", async (req, res) => {
  const productId = Number(req.params.id);
  if (!Number.isInteger(productId) || productId <= 0) {
    return res.status(400).json({ error: "ID de producto inválido" });
  }

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return res.status(404).json({ error: "Producto no encontrado" });

  const qrDataUrl = await QRCode.toDataURL(product.sku);
  res.json({
    sku: product.sku,
    name: product.name,
    category: product.category,
    measure: product.measure,
    unit: product.unit,
    qrDataUrl,
  });
});

const DENSIDADES = ["ALTA", "BAJA"] as const;
const COLORES = ["Negro", "Transparente", "Blanco", "Rojo", "Verde", "Verde claro"] as const;
const MEDIDA_UNIDADES = ["Pulgadas", "Cms."] as const;

const productSchema = z.object({
  name: z.string().min(1),
  category: z.enum(CATEGORIES),
  measure: z.string().optional(),
  measureUnit: z.enum(MEDIDA_UNIDADES).optional(),
  talla: z.string().optional(),
  color: z.enum(COLORES).optional(),
  densidad: z.enum(DENSIDADES).optional(),
  medidaRef: z.string().optional(),
  calibre: z.string().optional(),
  unit: z.enum(["kg", "unidad"]),
  minStock: z.number().min(0),
  unitPrice: z.number().min(0),
});

productsRouter.post("/", requireProduccionGestion, async (req, res) => {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    // El SKU se calcula DENTRO del reintento (no antes) -- si dos creaciones
    // casi simultáneas de la misma categoría chocan contra el `count()+1`
    // (mismo problema no-atómico que COT-/PED-/FAC-/OP-, ver
    // sequentialNumber.ts), el reintento recalcula el consecutivo ya viendo
    // la fila que la otra request acaba de commitear.
    const product = await withSequentialNumberRetry(async () => {
      const sku = await nextSku(parsed.data.category);
      return prisma.product.create({ data: { ...parsed.data, sku } });
    });
    res.status(201).json(product);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({ error: "No se pudo generar el código del producto, intentá de nuevo" });
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

  const updated = await prisma.product.update({ where: { id: productId }, data: parsed.data });
  res.json(updated);
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

/** Reactiva un producto desactivado por error. */
productsRouter.post("/:id/reactivate", requireProduccionGestion, async (req, res) => {
  const productId = Number(req.params.id);
  if (!Number.isInteger(productId) || productId <= 0) {
    return res.status(400).json({ error: "ID de producto inválido" });
  }

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return res.status(404).json({ error: "Producto no encontrado" });

  const updated = await prisma.product.update({ where: { id: productId }, data: { active: true } });
  res.json(updated);
});
