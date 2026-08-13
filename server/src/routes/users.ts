import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Prisma } from "../generated/prisma/client";
import { prisma } from "../prisma";
import { requireAuth, requireRole, ROLES } from "../middleware/auth";

export const usersRouter = Router();
usersRouter.use(requireAuth);
usersRouter.use(requireRole(...ROLES.ADMIN));

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  twoFactorEnabled: true,
  createdAt: true,
} as const;

const ROLE_VALUES = [
  "super_admin",
  "admin",
  "gerente_produccion",
  "planeacion",
  "ventas_pedidos",
  "operario_extrusion",
  "operario_impresion",
  "operario_sellado_precorte",
  "calidad",
  "almacen_despachos",
  "auditor",
] as const;

usersRouter.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({ select: USER_SELECT, orderBy: { name: "asc" } });
  res.json(users);
});

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.email(),
  password: z.string().min(8),
  role: z.enum(ROLE_VALUES),
});

usersRouter.post("/", async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const passwordHash = await bcrypt.hash(parsed.data.password, 10);
    const user = await prisma.user.create({
      data: { name: parsed.data.name, email: parsed.data.email, role: parsed.data.role, passwordHash },
      select: USER_SELECT,
    });
    res.status(201).json(user);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({ error: "Ya existe un usuario con ese email" });
    }
    throw err;
  }
});

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.email().optional(),
  role: z.enum(ROLE_VALUES).optional(),
  password: z.string().min(8).optional(),
});

usersRouter.patch("/:id", async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: "ID de usuario inválido" });
  }

  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (Object.keys(parsed.data).length === 0) {
    return res.status(400).json({ error: "No se indicó ningún campo para actualizar" });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

  const { password, ...rest } = parsed.data;

  try {
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { ...rest, ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}) },
      select: USER_SELECT,
    });
    res.json(updated);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({ error: "Ya existe un usuario con ese email" });
    }
    throw err;
  }
});

/** Elimina (desactiva) un usuario. Soft delete: tiene facturas, OPs,
 * movimientos, etc. relacionados; un usuario inactivo ya no puede
 * loguearse (ver auth.ts) pero conserva su historial. */
usersRouter.delete("/:id", async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: "ID de usuario inválido" });
  }
  if (userId === req.user!.userId) {
    return res.status(400).json({ error: "No podés desactivar tu propio usuario" });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

  const updated = await prisma.user.update({ where: { id: userId }, data: { active: false }, select: USER_SELECT });
  res.json(updated);
});
