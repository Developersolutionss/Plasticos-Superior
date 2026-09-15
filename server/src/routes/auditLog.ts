import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth, requireRole, ROLES } from "../middleware/auth";

export const auditLogRouter = Router();
auditLogRouter.use(requireAuth);
auditLogRouter.use(requireRole(...ROLES.AUDITORIA));

auditLogRouter.get("/", async (req, res) => {
  const tableName = req.query.tableName as string | undefined;
  const recordId = req.query.recordId ? Number(req.query.recordId) : undefined;
  const page = req.query.page ? Math.max(1, Number(req.query.page)) : 1;
  const pageSize = req.query.pageSize ? Math.min(200, Number(req.query.pageSize)) : 50;

  const where = { tableName, recordId };

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  res.json({ items, total, page, pageSize });
});

/**
 * Reconciliación: compara el stock desnormalizado (InventoryStock/
 * RawMaterialStock, lo que lee toda la app) contra la suma real de su
 * propia bitácora de movimientos — la fuente de verdad. `applyMovement`/
 * `applyRawMaterialMovement` mantienen las dos en la misma transacción,
 * así que en teoría nunca deberían divergir; esto es la herramienta para
 * detectarlo si alguna vez pasa (una escritura manual en la base, un
 * script que corrió mal, etc.) — antes no existía ninguna forma de
 * enterarse de un descuadre así, quedaba silencioso para siempre.
 */
auditLogRouter.get("/reconciliation", async (_req, res) => {
  const [productRows, rawMaterialRows] = await Promise.all([
    prisma.$queryRaw<{ product_id: number; sku: string; name: string; stock: unknown; moved: unknown }[]>`
      SELECT p.id AS product_id, p.sku, p.name,
             COALESCE(s.current_quantity, 0) AS stock,
             COALESCE(SUM(m.quantity), 0) AS moved
      FROM products p
      LEFT JOIN inventory_stock s ON s.product_id = p.id
      LEFT JOIN inventory_movements m ON m.product_id = p.id
      GROUP BY p.id, p.sku, p.name, s.current_quantity
    `,
    prisma.$queryRaw<{ raw_material_id: number; code: string; stock: unknown; moved: unknown }[]>`
      SELECT rm.id AS raw_material_id, rm.code,
             COALESCE(s.current_quantity, 0) AS stock,
             COALESCE(SUM(m.quantity), 0) AS moved
      FROM raw_materials rm
      LEFT JOIN raw_material_stock s ON s.raw_material_id = rm.id
      LEFT JOIN raw_material_movements m ON m.raw_material_id = rm.id
      GROUP BY rm.id, rm.code, s.current_quantity
    `,
  ]);

  const products = productRows
    .map((r) => ({ productId: r.product_id, sku: r.sku, name: r.name, stock: Number(r.stock), movementsSum: Number(r.moved) }))
    .filter((r) => Math.round((r.stock - r.movementsSum) * 100) !== 0)
    .map((r) => ({ ...r, difference: Math.round((r.stock - r.movementsSum) * 100) / 100 }));

  const rawMaterials = rawMaterialRows
    .map((r) => ({ rawMaterialId: r.raw_material_id, code: r.code, stock: Number(r.stock), movementsSum: Number(r.moved) }))
    .filter((r) => Math.round((r.stock - r.movementsSum) * 100) !== 0)
    .map((r) => ({ ...r, difference: Math.round((r.stock - r.movementsSum) * 100) / 100 }));

  res.json({ products, rawMaterials, ok: products.length === 0 && rawMaterials.length === 0 });
});
