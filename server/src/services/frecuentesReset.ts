import { prisma } from "../prisma";

/**
 * Reset semanal del contador de visitas de clientes (filtro "Frecuentes").
 *
 * El contador (`viewCount`) es un contador vivo: se incrementa con cada visita
 * y el boost por racha (ver `CONSECUTIVE_DAYS_BOOST`) se aplica en el momento,
 * igualando el máximo actual + 1 para subir al cliente arriba del ranking sin
 * esperar ninguna fecha.
 *
 * El reset semanal es solo una PURGA: redistribuye los valores por ranking para
 * que los números no crezcan sin límite (en vez de volverlos a cero, el cliente
 * más visitado conserva el valor más alto y el menos visitado 0).
 *
 *   antes:  a=50, b=37, c=12, d=2
 *   luego:  a=3,  b=2,  c=1,  d=0
 *
 * La purga NO toca el resto del sistema: las visitas siguen contando igual en
 * vivo después de ella.
 */

const RESET_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_CHECK_MS = 60 * 60 * 1000;
const META_KEY_LAST_RESET = "frecuentes:lastResetAt";

/** Umbral de racha (días seguidos con visita) para el boost. */
export const CONSECUTIVE_DAYS_BOOST = 5;

function isHot(streak?: number | null): boolean {
  return (streak ?? 0) >= CONSECUTIVE_DAYS_BOOST;
}

/**
 * Valor para el boost en vivo: el cliente que cruza el umbral de racha iguala
 * el máximo actual y suma uno, para quedar arriba del ranking "Frecuentes"
 * al instante (sin esperar al reset semanal).
 */
export function liveBoostValue(currentMax?: number | null): number {
  return (currentMax ?? 0) + 1;
}

/**
 * Racha de días seguidos con al menos una visita, calculada al registrar una
 * visita. Función pura y testeable.
 *
 * - última visita hoy           → la racha se mantiene (misma streak)
 * - última visita el día anterior → la racha crece en 1
 * - última visita más lejos / sin visitas → la racha se reinicia en 1
 */
export function nextStreak(
  prevStreak: number | null | undefined,
  lastViewedAt: Date | string | null | undefined,
  now: Date = new Date()
): number {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = startOf(now);
  if (!lastViewedAt) return 1;

  const last = new Date(lastViewedAt);
  const dayDiff = Math.round((startOf(last).getTime() - today.getTime()) / 86_400_000);
  if (dayDiff === 0) return prevStreak ?? 0;
  if (dayDiff === -1) return (prevStreak ?? 0) + 1;
  return 1;
}

/** Puro y testeable: devuelve el conteo nuevo de cada cliente según su ranking. */
export function computeRedistribution(
  entries: { id: number; viewCount: number; lastViewedAt?: Date | string | null; streak?: number | null }[]
): { id: number; viewCount: number }[] {
  const sorted = [...entries].sort((a, b) => {
    const aHot = isHot(a.streak);
    const bHot = isHot(b.streak);
    if (aHot !== bHot) return aHot ? -1 : 1;
    // Entre los que superaron el umbral, arriba el que lleve la racha más larga.
    if (aHot && bHot) {
      const diff = (b.streak ?? 0) - (a.streak ?? 0);
      if (diff !== 0) return diff;
    }
    const diff = b.viewCount - a.viewCount;
    if (diff !== 0) return diff;
    const aTime = a.lastViewedAt ? new Date(a.lastViewedAt).getTime() : -Infinity;
    const bTime = b.lastViewedAt ? new Date(b.lastViewedAt).getTime() : -Infinity;
    return bTime - aTime;
  });

  return sorted.map((e, i) => ({ id: e.id, viewCount: sorted.length - i - 1 }));
}

export async function runFrecuentesReset(): Promise<boolean> {
  const meta = await prisma.appMeta.findUnique({ where: { key: META_KEY_LAST_RESET } });
  if (meta && Date.now() - new Date(meta.value).getTime() < RESET_INTERVAL_MS) return false;

  const clients = await prisma.client.findMany({
    select: { id: true, viewCount: true, lastViewedAt: true, visitStreak: true },
  });
  const next = computeRedistribution(clients);

  await prisma.$transaction(
    next.map((c) =>
      prisma.client.update({ where: { id: c.id }, data: { viewCount: c.viewCount, visitStreak: 0 } })
    )
  );

  await prisma.appMeta.upsert({
    where: { key: META_KEY_LAST_RESET },
    update: { value: new Date().toISOString() },
    create: { key: META_KEY_LAST_RESET, value: new Date().toISOString() },
  });

  return true;
}

/**
 * Scheduler del reset semanal. Se dispara al arrancar el servidor y luego
 * una vez por hora. El timer se "unref" para no mantener vivo el proceso
 * (importante para que los tests terminen).
 */
export function scheduleFrecuentesReset(): void {
  const run = () => {
    runFrecuentesReset()
      .then((did) => {
        if (did) console.log("[frecuentes] contador redistribuido por ranking (con boost por racha)");
      })
      .catch((err) => console.error("[frecuentes] error en el reset semanal:", err));
  };

  setTimeout(run, 5_000);
  const timer = setInterval(run, RESET_CHECK_MS);
  timer.unref?.();
}