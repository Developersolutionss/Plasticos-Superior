/**
 * Limitador simple en memoria para la verificación del token de posesión de
 * rollos (ver rollPossessionToken.ts) -- pensado para el RENDIMIENTO del
 * servidor, no como control de seguridad: frena a un cliente que reintenta
 * en loop (ej. un bug de la PWA, o un escaneo que queda repitiendo sin
 * parar) para no gastar ciclos de CPU/DB en HMACs de sobra, no para
 * "banear" ni registrar nada como sospechoso. Por eso el límite es alto
 * (50 por minuto) y el bloqueo es corto: cualquier uso normal, incluso uno
 * bien intenso, nunca lo debería rozar.
 *
 * En memoria del proceso porque alcanza para esta escala (un solo server) y
 * no vale la pena una dependencia externa (Redis, etc.) para esto.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Saca buckets vencidos de tanto en tanto para que el Map no crezca sin
 * límite con claves que ya nadie vuelve a pedir. */
const SWEEP_INTERVAL_MS = 5 * 60_000;
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(key);
  }
}, SWEEP_INTERVAL_MS).unref();

/** true si `key` todavía tiene lugar dentro de la ventana actual (y cuenta
 * este intento); false si ya llegó al máximo y hay que esperar. */
export function checkRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count++;
  return bucket.count <= max;
}
