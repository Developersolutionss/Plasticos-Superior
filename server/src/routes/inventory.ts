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
  const productId = req.query.productId ? Number(req.query.productId) : undefined;
  const movementType = req.query.movementType as string | undefined;
  const page = req.query.page ? Math.max(1, Number(req.query.page)) : 1;
  const pageSize = req.query.pageSize ? Math.min(200, Number(req.query.pageSize)) : 50;

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
