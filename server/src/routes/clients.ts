import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth, requireRole, ROLES } from "../middleware/auth";
import { boostValue, isHot, nextCycle, nextVisitState, HOT_THRESHOLD } from "../services/frequency";

export const clientsRouter = Router();
clientsRouter.use(requireAuth);

/** CRM (clientes, contactos, direcciones, cotizaciones) es dominio de Ventas/Pedidos. */
const requireVentas = requireRole(...ROLES.VENTAS);
clientsRouter.use(requireVentas);

const CLIENTS_UPLOADS_DIR = path.join(__dirname, "..", "..", "uploads", "clients");
fs.mkdirSync(CLIENTS_UPLOADS_DIR, { recursive: true });

/** Avatares de clientes: disco + servir estático (ver index.ts → /api/uploads). */
const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: CLIENTS_UPLOADS_DIR,
    filename: (_req, file, cb) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}${path.extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Solo se permiten imágenes JPG, PNG o WEBP"));
  },
});

clientsRouter.get("/", async (_req, res) => {
  const clients = await prisma.client.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  res.json(clients);
});

const createClientSchema = z.object({
  name: z.string().min(1),
  contactInfo: z.record(z.string(), z.any()).optional(),
  creditLimit: z.number().min(0).optional(),
});

clientsRouter.post("/", requireVentas, async (req, res) => {
  const parsed = createClientSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // Un cliente nuevo nace arriba del ranking "Frecuentes": arranca en el
  // máximo actual + 1 y ya cuenta como "hot" para esta semana.
  const { _max } = await prisma.client.aggregate({ _max: { viewCount: true } });
  const client = await prisma.client.create({
    data: {
      ...parsed.data,
      viewCount: boostValue(_max.viewCount),
      cycleInteractions: HOT_THRESHOLD,
    },
  });
  res.status(201).json(client);
});

const updateClientSchema = z.object({
  name: z.string().min(1).optional(),
  contactInfo: z.record(z.string(), z.any()).optional(),
  creditLimit: z.number().min(0).optional(),
});

/** Edita datos del cliente (nombre, contactInfo, límite de crédito). */
clientsRouter.patch("/:id", requireVentas, async (req, res) => {
  const clientId = Number(req.params.id);
  if (!Number.isInteger(clientId) || clientId <= 0) {
    return res.status(400).json({ error: "ID de cliente inválido" });
  }

  const parsed = updateClientSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (Object.keys(parsed.data).length === 0) {
    return res.status(400).json({ error: "No se indicó ningún campo para actualizar" });
  }

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return res.status(404).json({ error: "Cliente no encontrado" });

  const updated = await prisma.client.update({ where: { id: clientId }, data: parsed.data });
  res.json(updated);
});

/** Sube (o reemplaza) la foto de perfil del cliente. */
clientsRouter.post(
  "/:id/avatar",
  requireVentas,
  (req, res, next) => {
    avatarUpload.single("avatar")(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  },
  async (req, res) => {
    const clientId = Number(req.params.id);
    if (!Number.isInteger(clientId) || clientId <= 0) {
      if (req.file) fs.rmSync(req.file.path, { force: true });
      return res.status(400).json({ error: "ID de cliente inválido" });
    }
    if (!req.file) return res.status(400).json({ error: "No se recibió la imagen" });

    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) {
      fs.rmSync(req.file.path, { force: true });
      return res.status(404).json({ error: "Cliente no encontrado" });
    }

    const avatarUrl = `/api/uploads/clients/${req.file.filename}`;
    const updated = await prisma.client.update({ where: { id: clientId }, data: { avatarUrl } });

    // Recién después de persistir el cambio se borra el archivo anterior de
    // reemplazar la foto, para no dejar la DB apuntando a un archivo eliminado.
    if (client.avatarUrl) {
      const prevPath = path.join(CLIENTS_UPLOADS_DIR, path.basename(client.avatarUrl));
      fs.rmSync(prevPath, { force: true });
    }

    res.json(updated);
  }
);

/** Registra una "visita" al abrir la ficha del cliente (filtro "Frecuentes"). */
clientsRouter.post("/:id/visit", requireVentas, async (req, res) => {
  const clientId = Number(req.params.id);
  if (!Number.isInteger(clientId) || clientId <= 0) {
    return res.status(400).json({ error: "ID de cliente inválido" });
  }

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return res.status(404).json({ error: "Cliente no encontrado" });

  // Contador vivo: +1 por visita; al cruzar el umbral de interacciones el
  // cliente sube arriba del ranking al instante (máximo actual + 1) pero
  // consume el boost: las interacciones vuelven a 0 y necesita 5 nuevas.
  const hot = isHot(nextCycle(client.cycleInteractions), HOT_THRESHOLD);
  let maxScore = client.viewCount ?? 0;
  if (hot) {
    maxScore = (await prisma.client.aggregate({ _max: { viewCount: true } }))._max.viewCount ?? maxScore;
  }
  const state = nextVisitState(client, maxScore);

  const updated = await prisma.client.update({
    where: { id: clientId },
    data: {
      viewCount: state.viewCount,
      lastViewedAt: new Date(),
      cycleInteractions: state.cycleInteractions,
    },
  });
  res.json({
    viewCount: updated.viewCount,
    lastViewedAt: updated.lastViewedAt,
    cycleInteractions: updated.cycleInteractions,
  });
});

/** Elimina (desactiva) un cliente. Soft delete: el registro se conserva porque
 * tiene facturas, cotizaciones y pedidos relacionados; los listados solo
 * devuelven clientes `active: true`. */
clientsRouter.delete("/:id", requireVentas, async (req, res) => {
  const clientId = Number(req.params.id);
  if (!Number.isInteger(clientId) || clientId <= 0) {
    return res.status(400).json({ error: "ID de cliente inválido" });
  }

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return res.status(404).json({ error: "Cliente no encontrado" });

  const updated = await prisma.client.update({ where: { id: clientId }, data: { active: false } });
  res.json(updated);
});

const updateCreditLimitSchema = z.object({
  creditLimit: z.number().min(0),
});

/** Edita el límite de crédito manual del cliente (módulo "Cartera"). */
clientsRouter.patch("/:id/credit-limit", requireVentas, async (req, res) => {
  const clientId = Number(req.params.id);
  const parsed = updateCreditLimitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return res.status(404).json({ error: "Cliente no encontrado" });

  const updated = await prisma.client.update({
    where: { id: clientId },
    data: { creditLimit: parsed.data.creditLimit },
  });
  res.json(updated);
});

/**
 * Cartera real del cliente: límite de crédito manual + saldo pendiente
 * calculado (facturas no anuladas: total de ítems − pagos recibidos).
 */
clientsRouter.get("/:id/cartera", async (req, res) => {
  const clientId = Number(req.params.id);
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return res.status(404).json({ error: "Cliente no encontrado" });

  const facturas = await prisma.factura.findMany({
    where: { clientId, status: { not: "anulada" } },
    include: { items: true, payments: true },
    orderBy: { createdAt: "desc" },
  });

  const facturasConSaldo = facturas.map((f) => {
    const total = f.items.reduce((sum, it) => sum + Number(it.quantity) * Number(it.unitPrice), 0);
    const paid = f.payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const saldo = total - paid;
    const vencida = f.dueDate != null && f.dueDate < new Date() && saldo > 0;
    return { id: f.id, invoiceNumber: f.invoiceNumber, status: f.status, total, paid, saldo, dueDate: f.dueDate, vencida };
  });

  const saldoPendiente = facturasConSaldo.reduce((sum, f) => sum + f.saldo, 0);

  res.json({
    creditLimit: client.creditLimit,
    saldoPendiente,
    facturasPendientes: facturasConSaldo.filter((f) => f.saldo > 0),
  });
});

/** Lista global de contactos de todos los clientes (pantalla CRM "Contactos"),
 * con datos de la empresa relacionada para mostrar su avatar y nombre. */
clientsRouter.get("/contacts", async (_req, res) => {
  const contacts = await prisma.clientContact.findMany({
    where: { client: { active: true } },
    include: {
      client: { select: { id: true, name: true, avatarUrl: true, viewCount: true, lastViewedAt: true } },
    },
    orderBy: [{ client: { name: "asc" } }, { isPrimary: "desc" }, { name: "asc" }],
  });
  res.json(contacts);
});

/** Registra una "visita" al abrir la ficha de un contacto (frecuencia PROPIA
 * del contacto, el mismo motor que clientes: umbral → boost + consumir). */
clientsRouter.post("/contacts/:contactId/visit", requireVentas, async (req, res) => {
  const contactId = Number(req.params.contactId);
  if (!Number.isInteger(contactId) || contactId <= 0) {
    return res.status(400).json({ error: "ID de contacto inválido" });
  }

  const contact = await prisma.clientContact.findUnique({ where: { id: contactId } });
  if (!contact) return res.status(404).json({ error: "Contacto no encontrado" });

  const hot = isHot(nextCycle(contact.cycleInteractions), HOT_THRESHOLD);
  let maxScore = contact.viewCount ?? 0;
  if (hot) {
    maxScore = (await prisma.clientContact.aggregate({ _max: { viewCount: true } }))._max.viewCount ?? maxScore;
  }
  const state = nextVisitState(contact, maxScore);

  const updated = await prisma.clientContact.update({
    where: { id: contactId },
    data: {
      viewCount: state.viewCount,
      lastViewedAt: new Date(),
      cycleInteractions: state.cycleInteractions,
    },
  });
  res.json({
    viewCount: updated.viewCount,
    lastViewedAt: updated.lastViewedAt,
    cycleInteractions: updated.cycleInteractions,
  });
});

/** Lista los contactos de un cliente. */
clientsRouter.get("/:id/contacts", async (req, res) => {
  const clientId = Number(req.params.id);
  if (!Number.isInteger(clientId) || clientId <= 0) {
    return res.status(400).json({ error: "ID de cliente inválido" });
  }

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return res.status(404).json({ error: "Cliente no encontrado" });

  const contacts = await prisma.clientContact.findMany({
    where: { clientId },
    orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
  });

  res.json(contacts);
});

const createContactSchema = z.object({
  name: z.string().min(1),
  position: z.string().optional(),
  phone: z.string().optional(),
  email: z.email().optional(),
  isPrimary: z.boolean().optional().default(false),
});

/** Crea un contacto. Si isPrimary:true, desmarca los demás del cliente. */
clientsRouter.post("/:id/contacts", requireVentas, async (req, res) => {
  const clientId = Number(req.params.id);
  if (!Number.isInteger(clientId) || clientId <= 0) {
    return res.status(400).json({ error: "ID de cliente inválido" });
  }

  const parsed = createContactSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return res.status(404).json({ error: "Cliente no encontrado" });

  const contact = await prisma.$transaction(async (tx) => {
    if (parsed.data.isPrimary) {
      await tx.clientContact.updateMany({
        where: { clientId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    // Un contacto nuevo nace arriba de su ranking "Frecuentes" (frecuencia
    // propia, independiente del cliente): arranca en el máximo actual + 1 y ya
    // cuenta como "hot" para esta semana.
    const { _max } = await tx.clientContact.aggregate({ _max: { viewCount: true } });

    return tx.clientContact.create({
      data: {
        clientId,
        name: parsed.data.name,
        position: parsed.data.position,
        phone: parsed.data.phone,
        email: parsed.data.email,
        isPrimary: parsed.data.isPrimary,
        viewCount: boostValue(_max.viewCount),
        cycleInteractions: HOT_THRESHOLD,
      },
    });
  });

  res.status(201).json(contact);
});

/** Edita un contacto. Si isPrimary:true, desmarca los demás del cliente. */
clientsRouter.patch("/:id/contacts/:contactId", requireVentas, async (req, res) => {
  const clientId = Number(req.params.id);
  const contactId = Number(req.params.contactId);
  if (!Number.isInteger(clientId) || clientId <= 0 || !Number.isInteger(contactId) || contactId <= 0) {
    return res.status(400).json({ error: "IDs inválidos" });
  }

  const parsed = createContactSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const contact = await prisma.clientContact.findFirst({ where: { id: contactId, clientId } });
  if (!contact) return res.status(404).json({ error: "Contacto no encontrado" });

  const updated = await prisma.$transaction(async (tx) => {
    if (parsed.data.isPrimary) {
      await tx.clientContact.updateMany({
        where: { clientId, id: { not: contactId }, isPrimary: true },
        data: { isPrimary: false },
      });
    }
    return tx.clientContact.update({
      where: { id: contactId },
      data: {
        name: parsed.data.name,
        position: parsed.data.position,
        phone: parsed.data.phone,
        email: parsed.data.email,
        isPrimary: parsed.data.isPrimary,
      },
    });
  });

  res.json(updated);
});

/** Borra un contacto. Si era el principal, asigna el siguiente más reciente. */
clientsRouter.delete("/:id/contacts/:contactId", requireVentas, async (req, res) => {
  const clientId = Number(req.params.id);
  const contactId = Number(req.params.contactId);
  if (!Number.isInteger(clientId) || clientId <= 0 || !Number.isInteger(contactId) || contactId <= 0) {
    return res.status(400).json({ error: "IDs inválidos" });
  }

  const contact = await prisma.clientContact.findFirst({ where: { id: contactId, clientId } });
  if (!contact) return res.status(404).json({ error: "Contacto no encontrado" });

  await prisma.$transaction(async (tx) => {
    if (contact.isPrimary) {
      const nextPrimary = await tx.clientContact.findFirst({
        where: { clientId, id: { not: contactId } },
        orderBy: { createdAt: "desc" },
      });
      if (nextPrimary) {
        await tx.clientContact.update({
          where: { id: nextPrimary.id },
          data: { isPrimary: true },
        });
      }
    }

    await tx.clientContact.delete({ where: { id: contactId } });
  });

  res.json({ ok: true });
});

/* ── Direcciones de entrega ────────────────────────────────────────── */

clientsRouter.get("/:id/addresses", async (req, res) => {
  const clientId = Number(req.params.id);
  const addresses = await prisma.clientAddress.findMany({
    where: { clientId },
    orderBy: [{ isPrimary: "desc" }, { label: "asc" }],
  });
  res.json(addresses);
});

const createAddressSchema = z.object({
  label: z.string().min(1),
  addressLine: z.string().min(1),
  city: z.string().optional(),
  region: z.string().optional(),
  postalCode: z.string().optional(),
  isPrimary: z.boolean().optional().default(false),
  notes: z.string().optional(),
});

clientsRouter.post("/:id/addresses", requireVentas, async (req, res) => {
  const clientId = Number(req.params.id);
  const parsed = createAddressSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return res.status(404).json({ error: "Cliente no encontrado" });

  const address = await prisma.$transaction(async (tx) => {
    if (parsed.data.isPrimary) {
      await tx.clientAddress.updateMany({ where: { clientId, isPrimary: true }, data: { isPrimary: false } });
    }
    return tx.clientAddress.create({ data: { clientId, ...parsed.data } });
  });

  res.status(201).json(address);
});

clientsRouter.delete("/:id/addresses/:addressId", requireVentas, async (req, res) => {
  const clientId = Number(req.params.id);
  const addressId = Number(req.params.addressId);

  const address = await prisma.clientAddress.findFirst({ where: { id: addressId, clientId } });
  if (!address) return res.status(404).json({ error: "Dirección no encontrada" });

  await prisma.clientAddress.delete({ where: { id: addressId } });
  res.json({ ok: true });
});

/* ── Historial de interacciones ────────────────────────────────────── */

clientsRouter.get("/:id/interactions", async (req, res) => {
  const clientId = Number(req.params.id);
  const interactions = await prisma.clientInteraction.findMany({
    where: { clientId },
    orderBy: { createdAt: "desc" },
  });
  res.json(interactions);
});

const createInteractionSchema = z.object({
  type: z.enum(["llamada", "email", "reunion", "nota"]),
  description: z.string().min(1),
});

clientsRouter.post("/:id/interactions", requireVentas, async (req, res) => {
  const clientId = Number(req.params.id);
  const parsed = createInteractionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return res.status(404).json({ error: "Cliente no encontrado" });

  const interaction = await prisma.clientInteraction.create({
    data: { clientId, type: parsed.data.type, description: parsed.data.description, createdById: req.user!.userId },
  });
  res.status(201).json(interaction);
});