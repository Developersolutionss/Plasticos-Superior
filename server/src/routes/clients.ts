import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";

export const clientsRouter = Router();
clientsRouter.use(requireAuth);

clientsRouter.get("/", async (_req, res) => {
  const clients = await prisma.client.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  res.json(clients);
});

const createClientSchema = z.object({
  name: z.string().min(1),
  contactInfo: z.record(z.string(), z.any()).optional(),
  creditLimit: z.number().min(0).optional(),
});

clientsRouter.post("/", async (req, res) => {
  const parsed = createClientSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const client = await prisma.client.create({ data: parsed.data });
  res.status(201).json(client);
});

const updateCreditLimitSchema = z.object({
  creditLimit: z.number().min(0),
});

/** Edita el límite de crédito manual del cliente (módulo "Cartera"). */
clientsRouter.patch("/:id/credit-limit", async (req, res) => {
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
    return { id: f.id, invoiceNumber: f.invoiceNumber, status: f.status, total, paid, saldo: total - paid };
  });

  const saldoPendiente = facturasConSaldo.reduce((sum, f) => sum + f.saldo, 0);

  res.json({
    creditLimit: client.creditLimit,
    saldoPendiente,
    facturasPendientes: facturasConSaldo.filter((f) => f.saldo > 0),
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
clientsRouter.post("/:id/contacts", async (req, res) => {
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

    return tx.clientContact.create({
      data: {
        clientId,
        name: parsed.data.name,
        position: parsed.data.position,
        phone: parsed.data.phone,
        email: parsed.data.email,
        isPrimary: parsed.data.isPrimary,
      },
    });
  });

  res.status(201).json(contact);
});

/** Borra un contacto. Si era el principal, asigna el siguiente más reciente. */
clientsRouter.delete("/:id/contacts/:contactId", async (req, res) => {
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

clientsRouter.post("/:id/addresses", async (req, res) => {
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

clientsRouter.delete("/:id/addresses/:addressId", async (req, res) => {
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

clientsRouter.post("/:id/interactions", async (req, res) => {
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