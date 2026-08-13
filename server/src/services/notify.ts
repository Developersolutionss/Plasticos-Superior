import type { UserRole } from "../generated/prisma/client";
import { prisma } from "../prisma";

/** Crea una notificación in-app para cada usuario activo con alguno de los
 * roles indicados. Se llama explícitamente desde el router que dispara el
 * evento (no hay un bus de eventos central en este repo) — mismo criterio
 * que ya usa el resto del código: la lógica de dominio vive en el router. */
export async function notifyRoles(roles: UserRole[], data: { type: string; message: string; link?: string }) {
  const users = await prisma.user.findMany({ where: { role: { in: roles }, active: true }, select: { id: true } });
  if (users.length === 0) return;

  await prisma.notification.createMany({
    data: users.map((u) => ({ userId: u.id, type: data.type, message: data.message, link: data.link })),
  });
}
