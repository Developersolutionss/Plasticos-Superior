import type { UserRole } from "../generated/prisma/client";
import { prisma } from "../prisma";
import type { TxClient } from "./stockService";

/** Crea una notificación in-app para cada usuario activo con alguno de los
 * roles indicados. Se llama explícitamente desde el router que dispara el
 * evento (no hay un bus de eventos central en este repo) — mismo criterio
 * que ya usa el resto del código: la lógica de dominio vive en el router. */
async function createForRoles(db: TxClient | typeof prisma, roles: UserRole[], data: { type: string; message: string; link?: string }) {
  const users = await db.user.findMany({ where: { role: { in: roles }, active: true }, select: { id: true } });
  if (users.length === 0) return;
  await db.notification.createMany({
    data: users.map((u) => ({ userId: u.id, type: data.type, message: data.message, link: data.link })),
  });
}

/**
 * Versión para DESPUÉS de que la operación ya se guardó (fuera de la
 * transacción): un aviso que falla no puede convertir en error una acción que
 * ya quedó hecha — el usuario vería "no se pudo" y la reintentaría,
 * duplicándola. El fallo queda en el log del servidor.
 */
export async function notifyRoles(roles: UserRole[], data: { type: string; message: string; link?: string }) {
  try {
    await createForRoles(prisma, roles, data);
  } catch (err) {
    console.error(`[notify] no se pudo crear el aviso "${data.type}":`, err);
  }
}

/** Versión DENTRO de una transacción: el aviso se guarda (o se descarta)
 * junto con el movimiento que lo dispara — ej. stock bajo el mínimo en
 * applyMovement/applyRawMaterialMovement. */
export async function notifyRolesTx(tx: TxClient, roles: UserRole[], data: { type: string; message: string; link?: string }) {
  await createForRoles(tx, roles, data);
}
