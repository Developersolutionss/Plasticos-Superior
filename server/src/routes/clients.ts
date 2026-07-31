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
  contactInfo: z.record(z.any()).optional(),
});

clientsRouter.post("/", async (req, res) => {
  const parsed = createClientSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const client = await prisma.client.create({ data: parsed.data });
  res.status(201).json(client);
});
