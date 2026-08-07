import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth, requireRole, ROLES } from "../middleware/auth";

export const pedidosRouter = Router();
pedidosRouter.use(requireAuth);

const requireVentas = requireRole(...ROLES.VENTAS);

const UPLOADS_DIR = path.join(__dirname, "..", "..", "uploads", "pedidos");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}${path.extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

pedidosRouter.get("/", async (req, res) => {
  const clientId = req.query.clientId ? Number(req.query.clientId) : undefined;
  const status = req.query.status as string | undefined;

  const pedidos = await prisma.pedido.findMany({
    where: { clientId, status: status as any },
    include: {
      client: true,
      versions: {
        include: { items: { include: { product: true } } },
        orderBy: { versionNumber: "desc" },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(pedidos);
});

const itemSchema = z.object({
  productId: z.number().int(),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0).optional(),
  measure: z.string().optional(),
});

const createPedidoSchema = z.object({
  clientId: z.number().int(),
  notes: z.string().optional(),
  items: z.array(itemSchema).min(1),
});

/** Crea un Pedido nuevo con su versión 1 (numeración PED-00001, ...). */
pedidosRouter.post("/", requireVentas, async (req, res) => {
  const parsed = createPedidoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const client = await prisma.client.findUnique({ where: { id: parsed.data.clientId } });
  if (!client) return res.status(404).json({ error: "Cliente no encontrado" });

  const products = await prisma.product.findMany({
    where: { id: { in: parsed.data.items.map((i) => i.productId) } },
  });
  const productById = new Map(products.map((p) => [p.id, p]));
  if (products.length !== new Set(parsed.data.items.map((i) => i.productId)).size) {
    return res.status(400).json({ error: "Uno o más productos no existen" });
  }

  const pedido = await prisma.$transaction(async (tx) => {
    const count = await tx.pedido.count();
    const orderNumber = `PED-${String(count + 1).padStart(5, "0")}`;

    return tx.pedido.create({
      data: {
        orderNumber,
        clientId: parsed.data.clientId,
        status: "borrador",
        currentVersion: 1,
        createdById: req.user!.userId,
        versions: {
          create: {
            versionNumber: 1,
            status: "borrador",
            notes: parsed.data.notes,
            createdById: req.user!.userId,
            items: {
              create: parsed.data.items.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitPrice ?? Number(productById.get(item.productId)!.unitPrice),
                measure: item.measure,
              })),
            },
          },
        },
      },
      include: { versions: { include: { items: { include: { product: true } } } } },
    });
  });

  res.status(201).json(pedido);
});

pedidosRouter.get("/:id/versions", async (req, res) => {
  const pedidoId = Number(req.params.id);
  const versions = await prisma.pedidoVersion.findMany({
    where: { pedidoId },
    include: { items: { include: { product: true } } },
    orderBy: { versionNumber: "asc" },
  });
  res.json(versions);
});

const updatePedidoSchema = z.object({
  status: z.enum(["borrador", "pendiente", "aprobado", "en_produccion", "despachado", "cancelado"]),
  notes: z.string().optional(),
  items: z.array(itemSchema).min(1),
});

/**
 * Edita un Pedido creando una VERSIÓN NUEVA completa (v1, v2, v3...) en vez
 * de sobrescribir la anterior — así queda el historial completo navegable.
 */
pedidosRouter.patch("/:id", requireVentas, async (req, res) => {
  const pedidoId = Number(req.params.id);
  const parsed = updatePedidoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const pedido = await prisma.pedido.findUnique({ where: { id: pedidoId } });
  if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });

  const products = await prisma.product.findMany({
    where: { id: { in: parsed.data.items.map((i) => i.productId) } },
  });
  const productById = new Map(products.map((p) => [p.id, p]));
  if (products.length !== new Set(parsed.data.items.map((i) => i.productId)).size) {
    return res.status(400).json({ error: "Uno o más productos no existen" });
  }

  const newVersionNumber = pedido.currentVersion + 1;

  const version = await prisma.$transaction(async (tx) => {
    const created = await tx.pedidoVersion.create({
      data: {
        pedidoId,
        versionNumber: newVersionNumber,
        status: parsed.data.status,
        notes: parsed.data.notes,
        createdById: req.user!.userId,
        items: {
          create: parsed.data.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice ?? Number(productById.get(item.productId)!.unitPrice),
            measure: item.measure,
          })),
        },
      },
      include: { items: { include: { product: true } } },
    });

    await tx.pedido.update({
      where: { id: pedidoId },
      data: { currentVersion: newVersionNumber, status: parsed.data.status },
    });

    return created;
  });

  res.status(201).json(version);
});

/** Duplica un pedido: crea uno NUEVO (con su propio número) copiando los ítems de la última versión. */
pedidosRouter.post("/:id/duplicar", requireVentas, async (req, res) => {
  const pedidoId = Number(req.params.id);
  const pedido = await prisma.pedido.findUnique({
    where: { id: pedidoId },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1, include: { items: true } } },
  });
  if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });

  const latestVersion = pedido.versions[0];
  if (!latestVersion || latestVersion.items.length === 0) {
    return res.status(400).json({ error: "El pedido no tiene ítems para duplicar" });
  }

  const duplicated = await prisma.$transaction(async (tx) => {
    const count = await tx.pedido.count();
    const orderNumber = `PED-${String(count + 1).padStart(5, "0")}`;

    return tx.pedido.create({
      data: {
        orderNumber,
        clientId: pedido.clientId,
        status: "borrador",
        currentVersion: 1,
        createdById: req.user!.userId,
        versions: {
          create: {
            versionNumber: 1,
            status: "borrador",
            createdById: req.user!.userId,
            items: {
              create: latestVersion.items.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                measure: item.measure,
              })),
            },
          },
        },
      },
      include: { versions: { include: { items: { include: { product: true } } } } },
    });
  });

  res.status(201).json(duplicated);
});

/* ── Adjuntos (PDF, Excel, fichas técnicas, planos, fotos) ───────────── */

pedidosRouter.get("/:id/attachments", async (req, res) => {
  const pedidoId = Number(req.params.id);
  const attachments = await prisma.pedidoAttachment.findMany({
    where: { pedidoId },
    orderBy: { createdAt: "desc" },
  });
  res.json(attachments);
});

pedidosRouter.post("/:id/attachments", requireVentas, upload.single("file"), async (req, res) => {
  const pedidoId = Number(req.params.id);
  if (!req.file) return res.status(400).json({ error: "Archivo no provisto" });

  const pedido = await prisma.pedido.findUnique({ where: { id: pedidoId } });
  if (!pedido) {
    fs.unlink(req.file.path, () => {});
    return res.status(404).json({ error: "Pedido no encontrado" });
  }

  const attachment = await prisma.pedidoAttachment.create({
    data: {
      pedidoId,
      storedName: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      uploadedById: req.user!.userId,
    },
  });

  res.status(201).json(attachment);
});

pedidosRouter.get("/:id/attachments/:attachmentId/download", async (req, res) => {
  const pedidoId = Number(req.params.id);
  const attachmentId = Number(req.params.attachmentId);

  const attachment = await prisma.pedidoAttachment.findFirst({ where: { id: attachmentId, pedidoId } });
  if (!attachment) return res.status(404).json({ error: "Adjunto no encontrado" });

  res.download(path.join(UPLOADS_DIR, attachment.storedName), attachment.originalName);
});
