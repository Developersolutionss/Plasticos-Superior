import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth, requireRole, ROLES } from "../middleware/auth";
import { getLowStockAlerts, getStockByCategory } from "../services/stockService";

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth);

inventoryRouter.get("/", async (req, res) => {
  const stock = await getStockByCategory();
  const category = req.query.category as string | undefined;
  res.json(category ? stock.filter((p) => p.category === category) : stock);
});

inventoryRouter.get("/alerts", async (_req, res) => {
  res.json(await getLowStockAlerts());
});

inventoryRouter.get("/products", async (_req, res) => {
  const products = await prisma.product.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  res.json(products);
});

/** Historial de movimientos de stock (log operativo de bodega) — más
 * restringido que "Existencias", que también consultan Ventas/Planeación. */
inventoryRouter.get("/movements", requireRole(...ROLES.ALMACEN), async (req, res) => {
  let productId: number | undefined;
  if (req.query.productId !== undefined) {
    productId = Number(req.query.productId);
    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ error: "productId inválido" });
    }
  }

  const MOVEMENT_TYPES = ["entrada_produccion", "salida_despacho", "ajuste", "devolucion"];
  const movementType = req.query.movementType as string | undefined;
  if (movementType !== undefined && !MOVEMENT_TYPES.includes(movementType)) {
    return res.status(400).json({ error: "movementType inválido" });
  }

  let page = 1;
  if (req.query.page !== undefined) {
    page = Number(req.query.page);
    if (!Number.isInteger(page) || page < 1) return res.status(400).json({ error: "page inválido" });
  }

  let pageSize = 50;
  if (req.query.pageSize !== undefined) {
    pageSize = Number(req.query.pageSize);
    if (!Number.isInteger(pageSize) || pageSize < 1) return res.status(400).json({ error: "pageSize inválido" });
    pageSize = Math.min(200, pageSize);
  }

  const where = { productId, movementType: movementType as any };

  const [items, total] = await Promise.all([
    prisma.inventoryMovement.findMany({
      where,
      include: {
        product: { select: { sku: true, name: true, unit: true } },
        createdBy: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.inventoryMovement.count({ where }),
  ]);

  res.json({ items, total, page, pageSize });
});
