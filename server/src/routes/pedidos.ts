import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth, requireRole, ROLES } from "../middleware/auth";
import { withSequentialNumberRetry } from "../services/sequentialNumber";
import { getClientSaldoPendiente } from "../services/clientCredit";

class PedidoHasProductionOrderError extends Error {}

/**
 * Transiciones de estado válidas para un Pedido. Sin esto, PATCH /:id
 * aceptaba CUALQUIER status en el body sin importar el estado actual (ej.
 * "cancelado" → "aprobado", o "despachado" → "borrador") — spots imposibles
 * en el flujo real que además desincronizan lo que Almacén/Producción ya
 * hicieron con el pedido. `despachado` y `cancelado` son terminales: de ahí
 * no se puede volver a editar (para corregir un pedido despachado hay que
 * hacer uno nuevo). "borrador"/"pendiente" pueden ir directo a "aprobado"
 * (el botón "Aprobar y enviar a Planeación" del frontend salta el paso
 * intermedio a propósito, ver Pedidos.tsx).
 */
const VALID_PEDIDO_TRANSITIONS: Record<string, string[]> = {
  borrador: ["borrador", "pendiente", "aprobado", "cancelado"],
  pendiente: ["pendiente", "aprobado", "borrador", "cancelado"],
  aprobado: ["aprobado", "en_produccion", "cancelado"],
  en_produccion: ["en_produccion", "despachado", "cancelado"],
  despachado: [],
  cancelado: [],
};

export const pedidosRouter = Router();
pedidosRouter.use(requireAuth);

const requireVentas = requireRole(...ROLES.VENTAS);
pedidosRouter.use(requireVentas);

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

const PEDIDO_STATUSES = ["borrador", "pendiente", "aprobado", "en_produccion", "despachado", "cancelado"] as const;

pedidosRouter.get("/", async (req, res) => {
  const clientId = req.query.clientId ? Number(req.query.clientId) : undefined;
  const statusParam = req.query.status as string | undefined;
  // Antes `status as any` mandaba directo a Prisma cualquier string del query
  // string sin validar -- un valor que no fuera un status real (typo,
  // parámetro viejo) tiraba un 500 crudo de Prisma en vez de simplemente
  // ignorarlo o devolver un 400 claro.
  if (statusParam !== undefined && !PEDIDO_STATUSES.includes(statusParam as any)) {
    return res.status(400).json({ error: "Status inválido" });
  }
  const status = statusParam as (typeof PEDIDO_STATUSES)[number] | undefined;

  const pedidos = await prisma.pedido.findMany({
    where: { clientId, status },
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

/** El mismo producto repetido dos veces en `items` no lo detecta el chequeo
 * de "productos inexistentes" (dedupea antes de comparar) -- sin esto se
 * podían crear dos ítems del mismo producto en un pedido, cada uno con su
 * propia cantidad, en vez de una sola línea. */
function findDuplicateProductId(items: { productId: number }[]): number | null {
  const seen = new Set<number>();
  for (const item of items) {
    if (seen.has(item.productId)) return item.productId;
    seen.add(item.productId);
  }
  return null;
}

/** ¿Los ítems que se están mandando son EXACTAMENTE los de la versión
 * vigente (mismo producto, cantidad y medida)? Se usa para distinguir un
 * PATCH que solo avanza el status (no toca nada de lo que una OP ya
 * generada referencia) de uno que realmente cambia qué se pidió. */
function itemsMatch(
  current: { productId: number; quantity: unknown; measure: string | null }[],
  next: { productId: number; quantity: number; measure?: string }[]
): boolean {
  if (current.length !== next.length) return false;
  const sortedCurrent = [...current].sort((a, b) => a.productId - b.productId);
  const sortedNext = [...next].sort((a, b) => a.productId - b.productId);
  return sortedCurrent.every((c, i) => {
    const n = sortedNext[i];
    return c.productId === n.productId && Number(c.quantity) === n.quantity && (c.measure ?? "") === (n.measure ?? "");
  });
}

/** Crea un Pedido nuevo con su versión 1 (numeración PED-00001, ...). */
pedidosRouter.post("/", requireVentas, async (req, res) => {
  const parsed = createPedidoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const client = await prisma.client.findUnique({ where: { id: parsed.data.clientId } });
  if (!client) return res.status(404).json({ error: "Cliente no encontrado" });

  const duplicateProductId = findDuplicateProductId(parsed.data.items);
  if (duplicateProductId !== null) {
    return res.status(400).json({ error: `El producto ${duplicateProductId} aparece repetido en los ítems` });
  }

  const products = await prisma.product.findMany({
    where: { id: { in: parsed.data.items.map((i) => i.productId) } },
  });
  const productById = new Map(products.map((p) => [p.id, p]));
  if (products.length !== new Set(parsed.data.items.map((i) => i.productId)).size) {
    return res.status(400).json({ error: "Uno o más productos no existen" });
  }

  const pedido = await withSequentialNumberRetry(() =>
    prisma.$transaction(async (tx) => {
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
    })
  );

  res.status(201).json(pedido);
});

pedidosRouter.get("/:id/versions", async (req, res) => {
  const pedidoId = Number(req.params.id);
  if (!Number.isInteger(pedidoId)) return res.status(400).json({ error: "Id inválido" });
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
  if (!Number.isInteger(pedidoId)) return res.status(400).json({ error: "Id inválido" });
  const parsed = updatePedidoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const pedido = await prisma.pedido.findUnique({ where: { id: pedidoId }, include: { client: true } });
  if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });

  const allowedNext = VALID_PEDIDO_TRANSITIONS[pedido.status] ?? [];
  if (!allowedNext.includes(parsed.data.status)) {
    return res.status(400).json({ error: `No se puede pasar un pedido de "${pedido.status}" a "${parsed.data.status}"` });
  }

  const duplicateProductId = findDuplicateProductId(parsed.data.items);
  if (duplicateProductId !== null) {
    return res.status(400).json({ error: `El producto ${duplicateProductId} aparece repetido en los ítems` });
  }

  const products = await prisma.product.findMany({
    where: { id: { in: parsed.data.items.map((i) => i.productId) } },
  });
  const productById = new Map(products.map((p) => [p.id, p]));
  if (products.length !== new Set(parsed.data.items.map((i) => i.productId)).size) {
    return res.status(400).json({ error: "Uno o más productos no existen" });
  }

  // Si algún ítem de CUALQUIER versión de este pedido ya tiene una OP real
  // generada (POST /production-orders/from-pedido-item), cambiar los ÍTEMS
  // crearía una versión nueva que no tiene ninguna relación con esa OP --
  // quedaría huérfana, apuntando a un ítem de una versión vieja que ya no es
  // la vigente. Pero un PATCH que solo avanza el STATUS (ítems idénticos a
  // los de la versión vigente, ej. "Aprobar y enviar a Planeación" antes de
  // que Planeación genere la OP, o marcar despachado/cancelado después) no
  // toca nada de lo que la OP referencia -- bloquearlo también dejaría el
  // pedido clavado para siempre sin poder avanzar ni cancelarse.
  const existingOrder = await prisma.productionOrder.findFirst({
    where: { pedidoVersionItem: { pedidoVersion: { pedidoId } } },
    select: { id: true },
  });
  if (existingOrder) {
    const currentItems = await prisma.pedidoVersionItem.findMany({
      where: { pedidoVersion: { pedidoId, versionNumber: pedido.currentVersion } },
      select: { productId: true, quantity: true, measure: true },
    });
    if (!itemsMatch(currentItems, parsed.data.items)) {
      return res.status(400).json({ error: "Este pedido ya tiene una orden de producción generada — no se pueden cambiar los ítems" });
    }
  }

  // Al aprobar, el pedido no puede exceder el crédito disponible del cliente
  // (límite manual menos saldo pendiente en facturas). Se bloquea siempre,
  // nunca se deja pasar con solo un aviso. Un límite en 0 (el default de la
  // columna, nunca cargado a mano) significa "todavía no se configuró", no
  // "este cliente no tiene crédito" -- exigir 0 de deuda a TODO cliente sin
  // límite cargado bloquearía la aprobación normal de la enorme mayoría de
  // pedidos, así que sin límite configurado no se bloquea.
  const creditLimit = Number(pedido.client.creditLimit ?? 0);
  if (parsed.data.status === "aprobado" && creditLimit > 0) {
    const total = parsed.data.items.reduce(
      (sum, item) => sum + item.quantity * (item.unitPrice ?? Number(productById.get(item.productId)!.unitPrice)),
      0
    );
    const saldoPendiente = await getClientSaldoPendiente(prisma, pedido.clientId);
    const disponible = creditLimit - saldoPendiente;
    if (total > disponible + 0.005) {
      return res.status(400).json({
        error: `Aprobar este pedido (${total.toFixed(2)}) excede el crédito disponible del cliente (${disponible.toFixed(2)} de ${creditLimit.toFixed(2)})`,
      });
    }
  }

  let version;
  try {
    version = await withSequentialNumberRetry(() =>
      prisma.$transaction(async (tx) => {
        // Se relee currentVersion en cada intento (no afuera de la
        // transacción): si un reintento ocurre porque otra edición
        // concurrente ya tomó este número de versión, acá adentro ya vemos
        // el currentVersion actualizado. También se re-chequea la OP
        // existente por la misma razón que en from-pedido-item: una OP
        // pudo generarse justo en la ventana entre el chequeo de arriba y
        // esta transacción.
        const current = await tx.pedido.findUniqueOrThrow({ where: { id: pedidoId } });
        const newVersionNumber = current.currentVersion + 1;

        const raceOrder = await tx.productionOrder.findFirst({
          where: { pedidoVersionItem: { pedidoVersion: { pedidoId } } },
          select: { id: true },
        });
        if (raceOrder) {
          const raceCurrentItems = await tx.pedidoVersionItem.findMany({
            where: { pedidoVersion: { pedidoId, versionNumber: current.currentVersion } },
            select: { productId: true, quantity: true, measure: true },
          });
          if (!itemsMatch(raceCurrentItems, parsed.data.items)) throw new PedidoHasProductionOrderError();
        }

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
      })
    );
  } catch (err) {
    if (err instanceof PedidoHasProductionOrderError) {
      return res.status(400).json({ error: "Este pedido ya tiene una orden de producción generada — no se puede editar" });
    }
    throw err;
  }

  res.status(201).json(version);
});

/** Duplica un pedido: crea uno NUEVO (con su propio número) copiando los ítems de la última versión. */
pedidosRouter.post("/:id/duplicar", requireVentas, async (req, res) => {
  const pedidoId = Number(req.params.id);
  if (!Number.isInteger(pedidoId)) return res.status(400).json({ error: "Id inválido" });
  const pedido = await prisma.pedido.findUnique({
    where: { id: pedidoId },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1, include: { items: true } } },
  });
  if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });

  const latestVersion = pedido.versions[0];
  if (!latestVersion || latestVersion.items.length === 0) {
    return res.status(400).json({ error: "El pedido no tiene ítems para duplicar" });
  }

  const duplicated = await withSequentialNumberRetry(() =>
    prisma.$transaction(async (tx) => {
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
    })
  );

  res.status(201).json(duplicated);
});

/* ── Adjuntos (PDF, Excel, fichas técnicas, planos, fotos) ───────────── */

pedidosRouter.get("/:id/attachments", async (req, res) => {
  const pedidoId = Number(req.params.id);
  if (!Number.isInteger(pedidoId)) return res.status(400).json({ error: "Id inválido" });
  const attachments = await prisma.pedidoAttachment.findMany({
    where: { pedidoId },
    orderBy: { createdAt: "desc" },
  });
  res.json(attachments);
});

pedidosRouter.post("/:id/attachments", requireVentas, upload.single("file"), async (req, res) => {
  const pedidoId = Number(req.params.id);
  if (!Number.isInteger(pedidoId)) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: "Id inválido" });
  }
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
  if (!Number.isInteger(pedidoId) || !Number.isInteger(attachmentId)) {
    return res.status(400).json({ error: "IDs inválidos" });
  }

  const attachment = await prisma.pedidoAttachment.findFirst({ where: { id: attachmentId, pedidoId } });
  if (!attachment) return res.status(404).json({ error: "Adjunto no encontrado" });

  res.download(path.join(UPLOADS_DIR, attachment.storedName), attachment.originalName);
});
