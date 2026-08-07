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
});

clientsRouter.post("/", async (req, res) => {
  const parsed = createClientSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const client = await prisma.client.create({ data: parsed.data });
  res.status(201).json(client);
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