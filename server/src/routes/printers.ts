import { Router, type Request, type Response, type NextFunction } from "express";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth, requireRole, ROLES } from "../middleware/auth";
import { ROLL_CODE_PREFIX, type OpStation } from "../services/opTemplates";
import { verifyPossessionToken } from "../services/rollPossessionToken";
import { checkRateLimit } from "../services/rateLimiter";
import { labelDataFromRoll, renderLabelZpl, sampleLabelData, type LabelStation } from "../services/labelZpl";

/**
 * Impresión de etiquetas desde los celulares (pedido del cliente
 * 2026-11-24). El celular no puede hablarle a la impresora térmica de la
 * planta, así que:
 *
 * 1. El celular pide la impresión (POST /api/print-jobs/...): el servidor
 *    arma la etiqueta en ZPL (services/labelZpl.ts) y la deja en cola.
 * 2. El puente de impresión, un script en el PC donde está conectada la
 *    impresora, pregunta cada pocos segundos (POST /api/print-agent/poll,
 *    con el token de esa impresora), la recoge y se la manda a la impresora.
 * 3. El puente avisa cómo le fue (POST /api/print-agent/jobs/:id/result) y
 *    el celular lo ve (GET /api/print-jobs?ids=...).
 *
 * Es el puente el que se conecta al servidor (no al revés): no hay que abrir
 * puertos en el router de la planta ni exponer la impresora a internet.
 */

const STATIONS = ["extrusion", "impresion", "sellado", "precorte", "embobinado"] as const;
/** Sin noticias del puente en este tiempo = impresora "fuera de línea". */
export const ONLINE_WINDOW_MS = 30_000;
/** Un trabajo que el puente no recogió en este tiempo vence (nadie lo va a imprimir). */
const PENDING_TTL_MS = 15 * 60_000;
/** Recogido pero sin confirmar en este tiempo: se da por fallado (no se reimprime solo, para no duplicar). */
const SENT_TTL_MS = 3 * 60_000;

function hashAgentToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function newAgentToken(): string {
  return `psa_${crypto.randomBytes(24).toString("base64url")}`;
}

/** Trabajos vencidos pasan a error y se les borra el ZPL (lleva el token del rollo). */
async function expireStaleJobs() {
  const now = Date.now();
  await prisma.printJob.updateMany({
    where: { status: "pendiente", createdAt: { lt: new Date(now - PENDING_TTL_MS) } },
    data: { status: "error", error: "Venció sin imprimirse: el puente de impresión no la recogió (¿PC apagado?)", zpl: "", finishedAt: new Date() },
  });
  await prisma.printJob.updateMany({
    where: { status: "enviado", sentAt: { lt: new Date(now - SENT_TTL_MS) } },
    data: { status: "error", error: "El puente la recogió pero no confirmó si se imprimió: revisá la impresora", zpl: "", finishedAt: new Date() },
  });
}

function printerView(p: {
  id: number;
  name: string;
  labelWidthMm: number;
  labelHeightMm: number;
  dpi: number;
  stations: string[];
  active: boolean;
  lastSeenAt: Date | null;
  agentInfo: string | null;
}) {
  return {
    id: p.id,
    name: p.name,
    labelWidthMm: p.labelWidthMm,
    labelHeightMm: p.labelHeightMm,
    dpi: p.dpi,
    stations: p.stations,
    active: p.active,
    lastSeenAt: p.lastSeenAt,
    agentInfo: p.agentInfo,
    online: !!p.lastSeenAt && Date.now() - p.lastSeenAt.getTime() < ONLINE_WINDOW_MS,
  };
}

// ---------------------------------------------------------------------------
// Impresoras (configuración)
// ---------------------------------------------------------------------------

export const printersRouter = Router();
printersRouter.use(requireAuth);
const requireGestion = requireRole(...ROLES.PRODUCCION_GESTION);

/** Lista para elegir dónde imprimir (cualquier rol de producción). */
printersRouter.get("/", requireRole(...ROLES.OPERARIOS, ...ROLES.CALIDAD), async (_req, res) => {
  const printers = await prisma.labelPrinter.findMany({ where: { active: true }, orderBy: { id: "asc" } });
  res.json(printers.map(printerView));
});

/** Todas, incluidas las desactivadas, con sus últimos trabajos (Gestión). */
printersRouter.get("/admin", requireGestion, async (_req, res) => {
  await expireStaleJobs();
  const printers = await prisma.labelPrinter.findMany({
    orderBy: { id: "asc" },
    include: {
      jobs: {
        orderBy: { id: "desc" },
        take: 15,
        select: { id: true, description: true, status: true, error: true, createdByName: true, createdAt: true, finishedAt: true },
      },
    },
  });
  res.json(printers.map((p) => ({ ...printerView(p), jobs: p.jobs })));
});

const printerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  // El cabezal de la SAT TT460 imprime hasta 108 mm.
  labelWidthMm: z.number().int().min(20).max(108),
  labelHeightMm: z.number().int().min(20).max(300),
  dpi: z.union([z.literal(203), z.literal(300)]).optional(),
  stations: z.array(z.enum(STATIONS)).max(STATIONS.length).optional(),
  active: z.boolean().optional(),
});

/** Alta de impresora: devuelve el token del puente UNA sola vez (solo se guarda su hash). */
printersRouter.post("/", requireGestion, async (req, res) => {
  const parsed = printerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const agentToken = newAgentToken();
  const printer = await prisma.labelPrinter.create({
    data: { ...parsed.data, stations: parsed.data.stations ?? [], agentTokenHash: hashAgentToken(agentToken) },
  });
  res.status(201).json({ ...printerView(printer), agentToken });
});

printersRouter.patch("/:id", requireGestion, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido" });
  const parsed = printerSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const exists = await prisma.labelPrinter.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return res.status(404).json({ error: "Impresora no encontrada" });
  const printer = await prisma.labelPrinter.update({ where: { id }, data: parsed.data });
  res.json(printerView(printer));
});

/** Token nuevo para el puente (si se perdió o se filtró): el anterior deja de servir. */
printersRouter.post("/:id/token", requireGestion, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido" });
  const exists = await prisma.labelPrinter.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return res.status(404).json({ error: "Impresora no encontrada" });
  const agentToken = newAgentToken();
  await prisma.labelPrinter.update({ where: { id }, data: { agentTokenHash: hashAgentToken(agentToken), lastSeenAt: null } });
  res.json({ agentToken });
});

// ---------------------------------------------------------------------------
// Trabajos de impresión (desde el celular)
// ---------------------------------------------------------------------------

export const printJobsRouter = Router();
printJobsRouter.use(requireAuth);
printJobsRouter.use(requireRole(...ROLES.OPERARIOS, ...ROLES.CALIDAD));

async function activePrinter(printerId: number) {
  return prisma.labelPrinter.findFirst({ where: { id: printerId, active: true } });
}

const rollsJobSchema = z.object({
  printerId: z.number().int(),
  /** Rollos a imprimir con el token de posesión que vino al crearlos (o al reemitir la etiqueta). */
  rolls: z
    .array(z.object({ rollId: z.number().int(), token: z.string().trim().min(1).max(64) }))
    .min(1)
    .max(50),
});

/**
 * Etiquetas de rollos ya creados. El QR lleva el token de posesión, que el
 * servidor no guarda: el celular lo manda tal como lo recibió al crear el
 * rollo (o al reemitir su etiqueta) y acá se verifica contra el hash.
 */
printJobsRouter.post("/rolls", async (req, res) => {
  const parsed = rollsJobSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!checkRateLimit(`print-jobs:${req.user!.userId}`, 60, 60_000)) {
    return res.status(429).json({ error: "Demasiadas impresiones seguidas — esperá un momento" });
  }
  const printer = await activePrinter(parsed.data.printerId);
  if (!printer) return res.status(404).json({ error: "Impresora no encontrada" });

  const ids = parsed.data.rolls.map((r) => r.rollId);
  const rolls = await prisma.productionRoll.findMany({
    where: { id: { in: ids } },
    include: {
      productionOrder: {
        select: {
          orderNumber: true,
          station: true,
          specs: true,
          product: { select: { name: true, measure: true, measureUnit: true, calibre: true, color: true, densidad: true } },
          client: { select: { name: true } },
        },
      },
    },
  });
  const byId = new Map(rolls.map((r) => [r.id, r]));
  const jobs: { description: string; zpl: string }[] = [];
  for (const { rollId, token } of parsed.data.rolls) {
    const roll = byId.get(rollId);
    if (!roll) return res.status(404).json({ error: `Rollo ${rollId} no encontrado` });
    const code = `${ROLL_CODE_PREFIX[roll.station as OpStation]}-${roll.stationSequence}`;
    if (!verifyPossessionToken(code, token.toUpperCase(), roll.possessionTokenHash)) {
      return res.status(403).json({ error: `La etiqueta de ${code} ya no es válida (se reemitió): reemitila para imprimirla` });
    }
    // Nº del rollo dentro de su OP (1, 2, 3...), como el "Rollo" del tiquete de papel.
    const rollNumber = await prisma.productionRoll.count({ where: { productionOrderId: roll.productionOrderId, id: { lte: roll.id } } });
    const label = labelDataFromRoll(roll.productionOrder, roll, code, token.toUpperCase(), rollNumber);
    jobs.push({
      description: `${code} · ${roll.productionOrder.orderNumber}`,
      zpl: renderLabelZpl(label, { widthMm: printer.labelWidthMm, heightMm: printer.labelHeightMm, dpi: printer.dpi }),
    });
  }
  const created = await prisma.$transaction(
    jobs.map((j) =>
      prisma.printJob.create({
        data: { printerId: printer.id, ...j, createdById: req.user!.userId, createdByName: req.user!.name },
        select: { id: true, description: true, status: true },
      })
    )
  );
  res.status(201).json({ printer: printerView(printer), jobs: created });
});

const testJobSchema = z.object({
  printerId: z.number().int(),
  station: z.enum(STATIONS),
});

/** Etiqueta de muestra de una estación (Configuración → Prueba de etiquetas). */
printJobsRouter.post("/test", async (req, res) => {
  const parsed = testJobSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!checkRateLimit(`print-jobs:${req.user!.userId}`, 60, 60_000)) {
    return res.status(429).json({ error: "Demasiadas impresiones seguidas — esperá un momento" });
  }
  const printer = await activePrinter(parsed.data.printerId);
  if (!printer) return res.status(404).json({ error: "Impresora no encontrada" });
  const job = await prisma.printJob.create({
    data: {
      printerId: printer.id,
      description: `Prueba · ${parsed.data.station}`,
      zpl: renderLabelZpl(sampleLabelData(parsed.data.station as LabelStation), {
        widthMm: printer.labelWidthMm,
        heightMm: printer.labelHeightMm,
        dpi: printer.dpi,
      }),
      createdById: req.user!.userId,
      createdByName: req.user!.name,
    },
    select: { id: true, description: true, status: true },
  });
  res.status(201).json({ printer: printerView(printer), jobs: [job] });
});

/** Estado de unos trabajos (el celular lo consulta mientras espera). */
printJobsRouter.get("/", async (req, res) => {
  const ids = String(req.query.ids ?? "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 100);
  if (ids.length === 0) return res.json([]);
  await expireStaleJobs();
  const jobs = await prisma.printJob.findMany({
    where: { id: { in: ids } },
    select: { id: true, description: true, status: true, error: true, finishedAt: true },
  });
  res.json(jobs);
});

// ---------------------------------------------------------------------------
// Puente de impresión (script en el PC de planta)
// ---------------------------------------------------------------------------

export const printAgentRouter = Router();

/** El puente se identifica con el token de SU impresora (Authorization: Bearer psa_...). */
async function requireAgent(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token.startsWith("psa_")) return res.status(401).json({ error: "Token del puente no provisto" });
  const printer = await prisma.labelPrinter.findUnique({ where: { agentTokenHash: hashAgentToken(token) } });
  if (!printer || !printer.active) {
    // Los intentos con token inválido tienen su propio cupo: si compartieran
    // el del puente real (detrás de nginx todos llegan con la misma IP),
    // cualquiera podría dejarlo sin servicio mandando tokens falsos.
    if (!checkRateLimit("print-agent-invalid", 300, 60_000)) return res.status(429).json({ error: "Demasiadas consultas" });
    return res.status(401).json({ error: "Token del puente inválido o impresora desactivada" });
  }
  if (!checkRateLimit(`print-agent:${printer.id}`, 240, 60_000)) return res.status(429).json({ error: "Demasiadas consultas" });
  res.locals.printer = printer;
  next();
}

const pollSchema = z.object({
  hostname: z.string().trim().max(100).optional(),
  printer: z.string().trim().max(150).optional(),
});

/** El puente se reporta vivo y recoge lo pendiente de su impresora (lo marca "enviado"). */
printAgentRouter.post("/poll", requireAgent, async (req, res) => {
  const printer = res.locals.printer as { id: number; name: string; labelWidthMm: number; labelHeightMm: number };
  const parsed = pollSchema.safeParse(req.body ?? {});
  const info = parsed.success ? [parsed.data.hostname, parsed.data.printer].filter(Boolean).join(" · ") : "";
  await prisma.labelPrinter.update({ where: { id: printer.id }, data: { lastSeenAt: new Date(), agentInfo: info || undefined } });
  await expireStaleJobs();
  // Se reclaman de a pocos y con updateMany condicionado: si por error
  // corren dos puentes con el mismo token, cada trabajo lo toma uno solo.
  const pending = await prisma.printJob.findMany({
    where: { printerId: printer.id, status: "pendiente" },
    orderBy: { id: "asc" },
    take: 10,
    select: { id: true, zpl: true, description: true },
  });
  const claimed: typeof pending = [];
  for (const job of pending) {
    const { count } = await prisma.printJob.updateMany({
      where: { id: job.id, status: "pendiente" },
      data: { status: "enviado", sentAt: new Date(), attempts: { increment: 1 } },
    });
    if (count === 1) claimed.push(job);
  }
  res.json({ printer: { id: printer.id, name: printer.name, labelWidthMm: printer.labelWidthMm, labelHeightMm: printer.labelHeightMm }, jobs: claimed });
});

const resultSchema = z.object({
  ok: z.boolean(),
  error: z.string().trim().max(500).optional(),
});

printAgentRouter.post("/jobs/:id/result", requireAgent, async (req, res) => {
  const printer = res.locals.printer as { id: number };
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Id inválido" });
  const parsed = resultSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { count } = await prisma.printJob.updateMany({
    where: { id, printerId: printer.id, status: "enviado" },
    data: {
      status: parsed.data.ok ? "impreso" : "error",
      error: parsed.data.ok ? null : parsed.data.error || "La impresora no aceptó la etiqueta",
      // El ZPL lleva el token de posesión del rollo: no se guarda más de lo necesario.
      zpl: "",
      finishedAt: new Date(),
    },
  });
  if (count === 0) return res.status(404).json({ error: "Trabajo no encontrado o ya cerrado" });
  res.json({ ok: true });
});
