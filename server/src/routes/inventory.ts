import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
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
