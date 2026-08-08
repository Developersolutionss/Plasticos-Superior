/**
 * Comparador de "frecuencia" reutilizable para ordenar listados.
 *
 * Sirve para clientes ("Frecuentes"), contactos y cualquier colección que
 * tenga un conteo (`score`, por ej. `viewCount`) y un último acceso
 * (`lastActiveAt`, por ej. `lastViewedAt`). Se ordena descendente por conteo
 * y, a igualdad, por actividad más reciente. Como recibe accesores, funciona
 * también con campos anidados (p. ej. `c.client?.viewCount`).
 */
type Accessor<T> = (item: T) => number | string | Date | null | undefined;

export function byFrequency<T>(
  score: Accessor<T>,
  lastActive: Accessor<T>
): (a: T, b: T) => number {
  return (a, b) => {
    const diff = (Number(score(b)) || 0) - (Number(score(a)) || 0);
    if (diff !== 0) return diff;
    const aTime = lastActive(a) ? new Date(lastActive(a) as Date | string).getTime() : -Infinity;
    const bTime = lastActive(b) ? new Date(lastActive(b) as Date | string).getTime() : -Infinity;
    return bTime - aTime;
  };
}

/** Umbral de interacciones por ciclo para entrar en modo "hot". Espeja el
 * motor del servidor (`server/src/services/frequency.ts`). */
export const HOT_THRESHOLD = 5;

/**
 * Siguiente estado tras una interacción (p. ej. abrir la ficha de un cliente).
 * Espeja el boost en vivo del servidor: +1 al conteo, y al cruzar el umbral –
 * de interacciones del ciclo el `viewCount` salta a `maxScore + 1` (arriba del
 * ranking al momento, sin esperar al refresh).
 */
export function nextInteraction(
  prev: { viewCount?: number | null; cycleInteractions?: number | null },
  maxScore: number
): { viewCount: number; cycleInteractions: number } {
  const cycleInteractions = (prev.cycleInteractions ?? 0) + 1;
  const hot = cycleInteractions >= HOT_THRESHOLD;
  return {
    cycleInteractions,
    viewCount: hot ? maxScore + 1 : (prev.viewCount ?? 0) + 1,
  };
}