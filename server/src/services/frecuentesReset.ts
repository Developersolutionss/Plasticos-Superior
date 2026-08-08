import { prisma } from "../prisma";
import { redistributeScores, FrequencyEntry } from "./frequency";

/**
 * Purga semanal "Frecuentes" de clientes.
 *
 * Este archivo es el adaptador del modelo `Client` al motor genérico de
 * `services/frequency.ts`: solo sabe cómo leer/guardar los clientes y dónde
 * registrar la última purga. La matemática (orden por frecuencia, escalera
 * n-1…0, umbral de hot) vive en el motor, que sirve para clientes y para
 * cualquier otra área que sume interacciones.
 */

const RESET_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_CHECK_MS = 60 * 60 * 1000;
const META_KEY_LAST_RESET = "frecuentes:lastResetAt";

export async function runFrecuentesReset(): Promise<boolean> {
  const meta = await prisma.appMeta.findUnique({ where: { key: META_KEY_LAST_RESET } });
  if (meta && Date.now() - new Date(meta.value).getTime() < RESET_INTERVAL_MS) return false;

  const clients = await prisma.client.findMany({
    select: { id: true, viewCount: true, lastViewedAt: true },
  });
  const entries: FrequencyEntry[] = clients.map((c) => ({
    id: c.id,
    score: c.viewCount ?? 0,
    lastActiveAt: c.lastViewedAt,
  }));
  const next = redistributeScores(entries);

  await prisma.$transaction(
    next.map((c) =>
      prisma.client.update({ where: { id: c.id }, data: { viewCount: c.score, cycleInteractions: 0 } })
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
 * Scheduler de la purga semanal. Se dispara al arrancar el servidor y luego
 * una vez por hora. El timer se "unref" para no mantener vivo el proceso
 * (importante para que los tests terminen).
 */
export function scheduleFrecuentesReset(): void {
  const run = () => {
    runFrecuentesReset()
      .then((did) => {
        if (did) console.log("[frecuentes] purga semanal: valores redistribuidos por ranking");
      })
      .catch((err) => console.error("[frecuentes] error en la purga semanal:", err));
  };

  setTimeout(run, 5_000);
  const timer = setInterval(run, RESET_CHECK_MS);
  timer.unref?.();
}

export type { FrequencyEntry };