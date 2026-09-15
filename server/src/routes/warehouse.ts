import { Router } from "express";
import { z } from "zod";
import QRCode from "qrcode";
import { randomBytes } from "crypto";
import { prisma } from "../prisma";
import { requireAuth, requireRole, ROLES } from "../middleware/auth";
import { getStockByCategory, decrementLocationStock, incrementLocationStock, InsufficientStockError } from "../services/stockService";

export const warehouseRouter = Router();
warehouseRouter.use(requireAuth);
warehouseRouter.use(requireRole(...ROLES.ALMACEN));

// Mismo fallback que auth.ts para el link de reseteo de contraseña.
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";

warehouseRouter.get("/locations", async (_req, res) => {
  // Sin `publicToken`: no tiene por qué viajar en ningún otro lugar más
  // que en la URL ya armada de /locations/:id/qr.
  const locations = await prisma.warehouseLocation.findMany({
    select: { id: true, code: true, label: true, createdAt: true },
    orderBy: { code: "asc" },
  });
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

  const location = await prisma.warehouseLocation.create({
    data: { ...parsed.data, publicToken: randomBytes(16).toString("hex") },
    select: { id: true, code: true, label: true, createdAt: true },
  });
  res.status(201).json(location);
});

/** QR imprimible: al escanearlo (cámara normal, sin hardware especial) abre
 * sin login la página de stock en tiempo real de esa ubicación — el token
 * (no el `code`, corto y adivinable) es la única "credencial" de ese link.
 * Mismo patrón que el QR de 2FA en services/totp.ts (QRCode.toDataURL). */
warehouseRouter.get("/locations/:id/qr", async (req, res) => {
  const id = Number(req.params.id);
  const location = await prisma.warehouseLocation.findUnique({ where: { id } });
  if (!location) return res.status(404).json({ error: "Ubicación no encontrada" });

  const url = `${FRONTEND_URL}/qr/${location.publicToken}`;
  const dataUrl = await QRCode.toDataURL(url);
  res.json({ dataUrl, url });
});

/** Resuelve el token del QR de ubicación (ya impreso/pegado en el estante)
 * a un `locationId` usable dentro de la sesión autenticada — para el
 * escaneo de "ubicación" en Almacén, sin tener que reimprimir ningún QR:
 * reusa el mismo `publicToken` del endpoint público (publicLocation.ts). */
warehouseRouter.get("/locations/by-token/:token", async (req, res) => {
  const location = await prisma.warehouseLocation.findUnique({
    where: { publicToken: req.params.token },
    select: { id: true, code: true, label: true },
  });
  if (!location) return res.status(404).json({ error: "Ubicación no encontrada" });
  res.json(location);
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

  try {
    await prisma.$transaction(async (tx) => {
      if (fromLocationId) {
        // Claim atómico y condicional (mismo patrón que el resto del
        // sistema de stock) — antes esto era un find-then-check: dos
        // movidas casi simultáneas desde la misma ubicación podían las dos
        // leer el mismo saldo viejo, las dos pasar el chequeo, y dejar la
        // ubicación de origen en negativo.
        await decrementLocationStock(tx, productId, fromLocationId, quantity, req.user!.userId);
      } else {
        // Ubicar desde "sin ubicar" (sin fromLocationId) antes no validaba
        // NADA contra el total real del producto — se podía ubicar más
        // cantidad de la que existe físicamente. `unassigned` acá se
        // recalcula adentro de la transacción para achicar la ventana de
        // carrera, aunque no es 100% atómico contra otro /assign paralelo
        // del mismo producto (caso raro: dos personas ubicando el mismo
        // lote recién llegado al mismo tiempo).
        const [stock, located] = await Promise.all([
          tx.inventoryStock.findUnique({ where: { productId } }),
          tx.stockLocation.aggregate({ where: { productId }, _sum: { quantity: true } }),
        ]);
        const unassigned = Number(stock?.currentQuantity ?? 0) - Number(located._sum.quantity ?? 0);
        if (quantity > unassigned) {
          throw new InsufficientStockError(`Solo hay ${Math.round(unassigned * 100) / 100} sin ubicar de este producto`);
        }
      }

      await incrementLocationStock(tx, productId, toLocationId, quantity, req.user!.userId);
    });
  } catch (err) {
    if (err instanceof InsufficientStockError) {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }

  res.status(201).json({ ok: true });
});

warehouseRouter.use((err: any, _req: any, res: any, _next: any) => {
  res.status(err.status ?? 500).json({ error: err.message ?? "Error inesperado" });
});
