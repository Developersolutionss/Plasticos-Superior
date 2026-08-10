import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth, requireRole, ROLES } from "../middleware/auth";

export const auditLogRouter = Router();
auditLogRouter.use(requireAuth);
auditLogRouter.use(requireRole(...ROLES.AUDITORIA));

auditLogRouter.get("/", async (req, res) => {
  const tableName = req.query.tableName as string | undefined;
  const recordId = req.query.recordId ? Number(req.query.recordId) : undefined;
  const page = req.query.page ? Math.max(1, Number(req.query.page)) : 1;
  const pageSize = req.query.pageSize ? Math.min(200, Number(req.query.pageSize)) : 50;

  const where = { tableName, recordId };

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  res.json({ items, total, page, pageSize });
});
