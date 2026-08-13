import { Router } from "express";
import { prisma } from "../prisma";

/**
 * Una de las pocas rutas del backend pensada a propósito para ser pública
 * — sin requireAuth (la otra es whatsappWebhook.ts, que verifica el
 * hub.verify_token de Meta en su lugar). Es lo que consume la página a la
 * que apunta el QR impreso de una ubicación (ver warehouse.ts GET
 * /locations/:id/qr): cualquiera con el link exacto ve el stock de ESA
 * ubicación en tiempo real, sin login y sin poder navegar a ninguna otra
 * parte de la app. El `token` (no el `code`, corto y adivinable) es la
 * única credencial.
 */
export const publicLocationRouter = Router();

publicLocationRouter.get("/:token", async (req, res) => {
  const location = await prisma.warehouseLocation.findUnique({ where: { publicToken: req.params.token } });
  if (!location) return res.status(404).json({ error: "Ubicación no encontrada" });

  const stock = await prisma.stockLocation.findMany({
    where: { locationId: location.id },
    include: { product: true },
    orderBy: { product: { name: "asc" } },
  });

  res.json({
    location: { code: location.code, label: location.label },
    items: stock.map((row) => ({
      productId: row.productId,
      sku: row.product.sku,
      name: row.product.name,
      unit: row.product.unit,
      quantity: Number(row.quantity),
    })),
  });
});
