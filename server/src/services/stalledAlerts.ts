import { prisma } from "../prisma";
import { ROLES } from "../middleware/auth";
import { ROLL_CODE_PREFIX, STATION_LABELS, WAREHOUSE_LABELS, type OpStation } from "./opTemplates";

/**
 * Avisos de cosas paradas que nadie está mirando:
 *  - OP abierta (pendiente / en proceso) sin rollos nuevos hace STALLED_OP_DAYS.
 *  - Rollo despachado a otra bodega que nadie recibió en STALE_TRANSIT_HOURS
 *    (mismo umbral que marca "en tránsito hace mucho" en Inventario de bodegas).
 * Le llegan a Gestión de Producción. Cada OP se vuelve a avisar como mucho
 * cada REMIND_DAYS mientras siga parada; cada traslado, una sola vez.
 */
export const STALLED_OP_DAYS = 3;
export const STALE_TRANSIT_HOURS = 24;
const REMIND_DAYS = 3;
const CHECK_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const OP_TYPE = "op_estancada";
const TRANSIT_TYPE = "rollo_en_transito";

/** Usuarios que reciben estos avisos. */
async function recipients(): Promise<number[]> {
  const users = await prisma.user.findMany({ where: { role: { in: ROLES.PRODUCCION_GESTION }, active: true }, select: { id: true } });
  return users.map((u) => u.id);
}

/** ¿Ya hay un aviso de este tipo y link desde `since`? (para no repetirlo) */
async function alreadyNotified(type: string, link: string, since?: Date): Promise<boolean> {
  const found = await prisma.notification.findFirst({ where: { type, link, ...(since ? { createdAt: { gte: since } } : {}) }, select: { id: true } });
  return Boolean(found);
}

export async function runStalledAlerts(now = new Date()): Promise<{ ops: number; transits: number }> {
  const userIds = await recipients();
  if (userIds.length === 0) return { ops: 0, transits: 0 };
  let ops = 0;
  let transits = 0;

  const openOrders = await prisma.productionOrder.findMany({
    where: { status: { in: ["pendiente", "en_proceso"] }, station: { not: null } },
    select: {
      id: true,
      orderNumber: true,
      station: true,
      createdAt: true,
      rolls: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  for (const o of openOrders) {
    const lastActivity = o.rolls[0]?.createdAt ?? o.createdAt;
    const days = Math.floor((now.getTime() - lastActivity.getTime()) / DAY_MS);
    if (days < STALLED_OP_DAYS) continue;
    const link = `/produccion/ordenes/${o.id}`;
    if (await alreadyNotified(OP_TYPE, link, new Date(now.getTime() - REMIND_DAYS * DAY_MS))) continue;
    const station = STATION_LABELS[o.station as OpStation];
    const message = o.rolls.length
      ? `OP #${o.orderNumber} (${station}) lleva ${days} días sin registrar rollos — revisá si sigue en producción o hay que cerrarla`
      : `OP #${o.orderNumber} (${station}) lleva ${days} días abierta sin ningún rollo — revisá si arrancó o hay que cancelarla`;
    await prisma.notification.createMany({ data: userIds.map((userId) => ({ userId, type: OP_TYPE, message, link })) });
    ops++;
  }

  const transitSince = new Date(now.getTime() - STALE_TRANSIT_HOURS * 60 * 60 * 1000);
  const staleTransfers = await prisma.rollTransfer.findMany({
    where: { status: "en_transito", createdAt: { lt: transitSince } },
    select: { id: true, fromStation: true, toStation: true, carrierName: true, createdAt: true, roll: { select: { station: true, stationSequence: true } } },
  });
  for (const t of staleTransfers) {
    const link = `/produccion/inventario-bodegas#traslado-${t.id}`;
    if (await alreadyNotified(TRANSIT_TYPE, link)) continue;
    const hours = Math.floor((now.getTime() - t.createdAt.getTime()) / (60 * 60 * 1000));
    const code = `${ROLL_CODE_PREFIX[t.roll.station as OpStation]}-${t.roll.stationSequence}`;
    const message = `El rollo ${code} salió de ${WAREHOUSE_LABELS[t.fromStation]} hacia ${WAREHOUSE_LABELS[t.toStation]} hace ${hours} horas y nadie lo ha recibido (lo llevó ${t.carrierName})`;
    await prisma.notification.createMany({ data: userIds.map((userId) => ({ userId, type: TRANSIT_TYPE, message, link })) });
    transits++;
  }
  return { ops, transits };
}

/** Se revisa al arrancar y luego cada hora (timer "unref", como la purga semanal). */
export function scheduleStalledAlerts(): void {
  const run = () => {
    runStalledAlerts()
      .then((r) => {
        if (r.ops || r.transits) console.log(`[avisos] OPs estancadas: ${r.ops}, rollos en tránsito hace mucho: ${r.transits}`);
      })
      .catch((err) => console.error("[avisos] error revisando OPs estancadas / rollos en tránsito:", err));
  };
  setTimeout(run, 10_000).unref?.();
  setInterval(run, CHECK_MS).unref?.();
}
