import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

/** Cada quien ve solo las suyas — no hay guard de rol adicional. */
notificationsRouter.get("/", async (req, res) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: req.user!.userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json(notifications);
});

notificationsRouter.get("/unread-count", async (req, res) => {
  const count = await prisma.notification.count({ where: { userId: req.user!.userId, read: false } });
  res.json({ count });
});

notificationsRouter.patch("/:id/read", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID inválido" });

  const notification = await prisma.notification.findUnique({ where: { id } });
  if (!notification || notification.userId !== req.user!.userId) {
    return res.status(404).json({ error: "Notificación no encontrada" });
  }

  const updated = await prisma.notification.update({ where: { id }, data: { read: true } });
  res.json(updated);
});

notificationsRouter.patch("/read-all", async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user!.userId, read: false }, data: { read: true } });
  res.json({ ok: true });
});
