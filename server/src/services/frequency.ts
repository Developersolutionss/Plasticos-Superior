/**
 * Motor de "frecuencia" genérico y reutilizable.
 *
 * Se usa para ordenar y puntuar cualquier colección por cuán frecuente es
 * (clientes "Frecuentes", y en el futuro contactos u otras áreas). Es puro:
 * no conoce ni de Prisma ni de ningún modelo, así que se puede adaptar a
 * cualquier tabla que tenga: un conteo (`score`), interacciones por ciclo
 * (`cycle`) y el último acceso (`lastActiveAt`).
 *
 * Reglas (ver también purga semanal):
 * - `boostValue`: cuando un cliente cruza el umbral de interacciones, sube el
 *   score al máximo actual + 1 (arriba del ranking en vivo).
 * - `sortByFrequency` / `redistributeScores`: la purga semanal reordena por
 *   frecuencia y redistribuye en una escala acotada (n-1…0) para que los
 *   números no crezcan sin límite.
 */

export const HOT_THRESHOLD = 5;

export interface FrequencyEntry {
  id: number;
  /** Conteo "en vivo" (p. ej. `viewCount`). */
  score: number;
  /** Interacciones desde la última purga (p. ej. `cycleInteractions`). */
  cycle?: number | null;
  /** Última actividad, para desempate (p. ej. `lastViewedAt`). */
  lastActiveAt?: Date | string | null;
}

/** ¿El elemento ya cruzó el umbral de interacciones (está "hot")? */
export function isHot(cycle: number | null | undefined, threshold: number = HOT_THRESHOLD): boolean {
  return (cycle ?? 0) >= threshold;
}

/** Valor del boost en vivo: iguala el máximo actual y suma uno. */
export function boostValue(currentMax?: number | null): number {
  return (currentMax ?? 0) + 1;
}

/** Devuelve el conteo de interacciones luego de una nueva (desde la purga). */
export function nextCycle(previous?: number | null): number {
  return (previous ?? 0) + 1;
}

/**
 * Estado siguiente tras una visita: +1 al conteo; al cruzar el umbral de
 * interacciones el elemento sube a `maxScore + 1` (arriba del ranking) y
 * consume el boost (interacciones vuelven a 0). Compartido por la visita de
 * clientes y de contactos reutilizando el mismo motor.
 */
export function nextVisitState(
  prev: { viewCount?: number | null; cycleInteractions?: number | null },
  maxScore: number
): { viewCount: number; cycleInteractions: number } {
  const cycleInteractions = nextCycle(prev.cycleInteractions);
  const hot = isHot(cycleInteractions);
  return {
    cycleInteractions: hot ? 0 : cycleInteractions,
    viewCount: hot ? maxScore + 1 : (prev.viewCount ?? 0) + 1,
  };
}

/** Comparador por frecuencia: más score primero, desempata por actividad reciente. */
export function sortByFrequency<T extends FrequencyEntry>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    const diff = (b.score ?? 0) - (a.score ?? 0);
    if (diff !== 0) return diff;
    const aTime = a.lastActiveAt ? new Date(a.lastActiveAt).getTime() : -Infinity;
    const bTime = b.lastActiveAt ? new Date(b.lastActiveAt).getTime() : -Infinity;
    return bTime - aTime;
  });
}

/**
 * Purga de ranking: asigna a cada elemento el valor de la escalera
 * (n-1 … 0) según su orden de frecuencia, para acotar los números.
 */
export function redistributeScores<T extends FrequencyEntry>(entries: T[]): { id: number; score: number }[] {
  const sorted = sortByFrequency(entries);
  return sorted.map((e, i) => ({ id: e.id, score: sorted.length - i - 1 }));
}