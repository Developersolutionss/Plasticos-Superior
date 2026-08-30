import { Router } from "express";
import { z } from "zod";
import QRCode from "qrcode";
import { prisma } from "../prisma";
import { requireAuth, requireRole, ROLES } from "../middleware/auth";
import { TxClient } from "../services/stockService";

export const bultoLabelsRouter = Router();
bultoLabelsRouter.use(requireAuth);
// Mismos roles que pueden operar OPs (Gestión + operarios): un operario de
// Sellado/Precorte necesita poder escanear (by-code) aunque no genere lotes.
bultoLabelsRouter.use(requireRole(...ROLES.OPERARIOS));

const requireProduccionGestion = requireRole(...ROLES.PRODUCCION_GESTION);

/**
 * Número consecutivo tipo "BULTO-00001", igual criterio que
 * productionOrders.ts nextOrderNumber(): se calcula del máximo sufijo
 * numérico realmente usado, no de count(), para no chocar si algún código
 * de prueba no numérico entra a la tabla.
 */
async function nextBultoLabelCode(tx: TxClient): Promise<number> {
  const labels = await tx.bultoLabel.findMany({ where: { code: { startsWith: "BULTO-" } }, select: { code: true } });
  let max = 0;
  for (const { code } of labels) {
    const match = /^BULTO-(\d{5})$/.exec(code);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max;
}

/** Lista de etiquetas — filtro opcional por estado, para armar la hoja de impresión de las "disponible". */
bultoLabelsRouter.get("/", async (req, res) => {
  const status = req.query.status as string | undefined;
  const labels = await prisma.bultoLabel.findMany({
    where: { status: status as any },
    orderBy: { id: "desc" },
    select: {
      id: true,
      code: true,
      status: true,
      createdAt: true,
      usedAt: true,
      usedBy: { select: { name: true } },
      usedByRoll: { select: { id: true, productionOrder: { select: { orderNumber: true } } } },
    },
  });
  res.json(labels);
});

const generateSchema = z.object({ count: z.number().int().min(1).max(500) });

/**
 * Genera un lote de etiquetas nuevas en blanco (sin OP ni rollo todavía) —
 * Gestión las imprime y Laura las reparte físicamente a cada operario antes
 * de que empiecen a armar bultos.
 */
bultoLabelsRouter.post("/generate", requireProduccionGestion, async (req, res) => {
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const labels = await prisma.$transaction(async (tx) => {
    let max = await nextBultoLabelCode(tx);
    const created = [];
    for (let i = 0; i < parsed.data.count; i++) {
      max += 1;
      created.push(
        await tx.bultoLabel.create({
          data: { code: `BULTO-${String(max).padStart(5, "0")}`, createdById: req.user!.userId },
        })
      );
    }
    return created;
  });

  res.status(201).json(labels);
});

/** QR imprimible de una etiqueta — mismo patrón que el QR de rollo/ubicación (data URL, sin credencial extra: el código en sí ya es lo que se escanea). */
bultoLabelsRouter.get("/:id/qr", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido" });
  const label = await prisma.bultoLabel.findUnique({ where: { id } });
  if (!label) return res.status(404).json({ error: "Etiqueta no encontrada" });

  const qrDataUrl = await QRCode.toDataURL(label.code);
  res.json({ code: label.code, status: label.status, qrDataUrl });
});

/**
 * Resuelve el código escaneado a la etiqueta — lo usa el operario para
 * confirmar cuál está tomando ANTES de cargar el rollo (POST
 * /production-orders/:id/rolls, campo bultoLabelCode consume la etiqueta
 * de verdad, atómico con la creación del rollo).
 */
bultoLabelsRouter.get("/by-code/:code", async (req, res) => {
  const label = await prisma.bultoLabel.findUnique({
    where: { code: req.params.code },
    select: { id: true, code: true, status: true },
  });
  if (!label) return res.status(404).json({ error: "Etiqueta no encontrada" });
  res.json(label);
});
