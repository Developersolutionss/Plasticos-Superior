import { Router } from "express";
import { z } from "zod";
import { Prisma } from "../generated/prisma/client";
import { prisma } from "../prisma";
import { requireAuth, requireRole, ROLES } from "../middleware/auth";
import { applyRawMaterialMovement } from "../services/rawMaterialStockService";
import { getRawMaterialStock, getRawMaterialLowStockAlerts } from "../services/rawMaterialStockService";

export const rawMaterialsRouter = Router();
rawMaterialsRouter.use(requireAuth);

/** Mismo criterio que el maestro de Productos: lo gestiona Producción/Gestión;
 * el resto de INVENTARIO solo consulta stock/alertas. */
const requireProduccionGestion = requireRole(...ROLES.PRODUCCION_GESTION);
const requireInventario = requireRole(...ROLES.INVENTARIO);

/** Catálogo completo (incluye inactivos) para la pantalla de gestión. */
rawMaterialsRouter.get("/", requireInventario, async (_req, res) => {
  const materials = await prisma.rawMaterial.findMany({ orderBy: { code: "asc" } });
  res.json(materials);
});

rawMaterialsRouter.get("/stock", requireInventario, async (_req, res) => {
  res.json(await getRawMaterialStock());
});

rawMaterialsRouter.get("/alerts", requireInventario, async (_req, res) => {
  res.json(await getRawMaterialLowStockAlerts());
});

rawMaterialsRouter.get("/movements", requireInventario, async (req, res) => {
  let rawMaterialId: number | undefined;
  if (req.query.rawMaterialId !== undefined) {
    rawMaterialId = Number(req.query.rawMaterialId);
    if (!Number.isInteger(rawMaterialId) || rawMaterialId <= 0) {
      return res.status(400).json({ error: "rawMaterialId inválido" });
    }
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

  const where = { rawMaterialId };
  const [items, total] = await Promise.all([
    prisma.rawMaterialMovement.findMany({
      where,
      include: { rawMaterial: { select: { code: true, name: true } }, createdBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.rawMaterialMovement.count({ where }),
  ]);
  res.json({ items, total, page, pageSize });
});

const rawMaterialSchema = z.object({
  code: z.string().min(1),
  name: z.string().optional(),
  minStock: z.number().min(0).optional().default(0),
});

rawMaterialsRouter.post("/", requireProduccionGestion, async (req, res) => {
  const parsed = rawMaterialSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const material = await prisma.rawMaterial.create({ data: parsed.data });
    res.status(201).json(material);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({ error: "Ya existe una materia prima con ese código" });
    }
    throw err;
  }
});

const updateRawMaterialSchema = rawMaterialSchema.partial();

rawMaterialsRouter.patch("/:id", requireProduccionGestion, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Id inválido" });

  const parsed = updateRawMaterialSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (Object.keys(parsed.data).length === 0) return res.status(400).json({ error: "No se indicó ningún campo para actualizar" });

  const material = await prisma.rawMaterial.findUnique({ where: { id } });
  if (!material) return res.status(404).json({ error: "Materia prima no encontrada" });

  try {
    const updated = await prisma.rawMaterial.update({ where: { id }, data: parsed.data });
    res.json(updated);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({ error: "Ya existe una materia prima con ese código" });
    }
    throw err;
  }
});

/** Desactiva (soft delete, igual que Productos: tiene movimientos relacionados). */
rawMaterialsRouter.delete("/:id", requireProduccionGestion, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Id inválido" });

  const material = await prisma.rawMaterial.findUnique({ where: { id } });
  if (!material) return res.status(404).json({ error: "Materia prima no encontrada" });

  const updated = await prisma.rawMaterial.update({ where: { id }, data: { active: false } });
  res.json(updated);
});

rawMaterialsRouter.post("/:id/reactivate", requireProduccionGestion, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Id inválido" });

  const material = await prisma.rawMaterial.findUnique({ where: { id } });
  if (!material) return res.status(404).json({ error: "Materia prima no encontrada" });

  const updated = await prisma.rawMaterial.update({ where: { id }, data: { active: true } });
  res.json(updated);
});

const adjustSchema = z.object({
  quantity: z.number().refine((v) => v !== 0, "La cantidad no puede ser 0"),
  notes: z.string().optional(),
});

/** Entrada manual (compra) o ajuste de stock de materia prima. */
rawMaterialsRouter.post("/:id/adjust", requireProduccionGestion, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Id inválido" });

  const parsed = adjustSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const material = await prisma.rawMaterial.findUnique({ where: { id } });
  if (!material) return res.status(404).json({ error: "Materia prima no encontrada" });

  await prisma.$transaction((tx) =>
    applyRawMaterialMovement(tx, {
      rawMaterialId: id,
      quantity: parsed.data.quantity,
      movementType: parsed.data.quantity > 0 ? "compra" : "ajuste",
      referenceType: "manual_adjustment",
      createdById: req.user!.userId,
    })
  );

  res.status(201).json({ ok: true });
});
