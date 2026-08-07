import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth, requireRole, ROLES } from "../middleware/auth";
import { applyMovement } from "../services/stockService";
import { parseProductionFile } from "../services/importExcel";

export const productionRouter = Router();
productionRouter.use(requireAuth);

/** Carga de producción: cruce entre Producción (la genera) y Almacén (la recibe). */
const requireProduccionOAlmacen = requireRole(...ROLES.ALMACEN, ...ROLES.PRODUCCION_GESTION);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const manualEntrySchema = z.object({
  sku: z.string().min(1),
  labelCode: z.string().optional(),
  operatorName: z.string().min(1),
  clientName: z.string().optional(),
  measure: z.string().optional(),
  kilos: z.number().positive(),
  driverName: z.string().optional(),
  observations: z.string().optional(),
});

/** Alta manual/individual de una entrada de producción. */
productionRouter.post("/entries", requireProduccionOAlmacen, async (req, res) => {
  const parsed = manualEntrySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const entry = await createProductionEntry(parsed.data, "manual", req.user!.userId);
    res.status(201).json(entry);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/** Paso 1: sube el archivo y devuelve un preview de filas parseadas (sin persistir). */
productionRouter.post("/import/preview", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Archivo no provisto" });

  const rows = await parseProductionFile(req.file.buffer, req.file.originalname);
  res.json({
    filename: req.file.originalname,
    totalRows: rows.length,
    validRows: rows.filter((r) => !r.error).length,
    invalidRows: rows.filter((r) => r.error).length,
    rows,
  });
});

const confirmImportSchema = z.object({
  filename: z.string(),
  rows: z.array(
    z.object({
      sku: z.string(),
      labelCode: z.string().optional(),
      operatorName: z.string(),
      clientName: z.string().optional(),
      measure: z.string().optional(),
      kilos: z.number(),
      driverName: z.string().optional(),
      observations: z.string().optional(),
      error: z.string().optional(),
    })
  ),
});

/** Paso 2: confirma la importación, persiste solo las filas válidas. */
productionRouter.post("/import/confirm", requireProduccionOAlmacen, async (req, res) => {
  const parsed = confirmImportSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { filename, rows } = parsed.data;
  const validRows = rows.filter((r) => !r.error);

  let processed = 0;
  let failed = 0;
  const errors: { row: number; message: string }[] = [];

  for (const row of validRows) {
    try {
      await createProductionEntry(row, "excel_import", req.user!.userId);
      processed++;
    } catch (err: any) {
      failed++;
      errors.push({ row: processed + failed, message: err.message });
    }
  }
  failed += rows.length - validRows.length;

  await prisma.importLog.create({
    data: {
      filename,
      source: "manual_upload",
      rowsProcessed: processed,
      rowsFailed: failed,
      uploadedById: req.user!.userId,
    },
  });

  res.json({ processed, failed, errors });
});

async function createProductionEntry(
  data: z.infer<typeof manualEntrySchema>,
  source: "manual" | "excel_import" | "whatsapp_bot",
  userId?: number
) {
  const product = await prisma.product.findUnique({ where: { sku: data.sku } });
  if (!product) throw new Error(`Producto con SKU "${data.sku}" no existe en el catálogo`);

  let clientId: number | undefined;
  if (data.clientName) {
    const client =
      (await prisma.client.findFirst({ where: { name: data.clientName } })) ??
      (await prisma.client.create({ data: { name: data.clientName } }));
    clientId = client.id;
  }

  return prisma.$transaction(async (tx) => {
    const entry = await tx.productionEntry.create({
      data: {
        productId: product.id,
        labelCode: data.labelCode,
        operatorName: data.operatorName,
        clientId,
        measure: data.measure ?? product.measure,
        kilos: data.kilos,
        driverName: data.driverName,
        status: "recibido",
        source,
        observations: data.observations,
        createdById: userId,
      },
    });

    await applyMovement(tx, {
      productId: product.id,
      quantity: data.kilos,
      movementType: "entrada_produccion",
      referenceType: "production_entry",
      referenceId: entry.id,
      productionEntryId: entry.id,
      createdById: userId,
    });

    return entry;
  });
}
