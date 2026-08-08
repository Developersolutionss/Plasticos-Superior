import { prisma } from "../prisma";
import { redistributeScores, FrequencyEntry } from "./frequency";

/**
 * Purga semanal "Frecuentes".
 *
 * Adaptador de cada modelo que usa el motor genérico de `services/frequency.ts`
 * (clientes y contactos, cada uno con su frecuencia independiente): solo sabe
 * cómo leer/guardar los registros de cada tabla y dónde registrar la última
 * purga. La matemática (orden por frecuencia, escalera n-1…0, umbral de hot)
 * vive en el motor.
 */

const RESET_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_CHECK_MS = 60 * 60 * 1000;

type ResetTarget = {
  metaKey: string;
  label: string;
  fetch: () => Promise<FrequencyEntry[]>;
  apply: (updates: { id: number; score: number }[]) => Promise<unknown>;
};

const TARGETS: Record<"clients" | "contacts", ResetTarget> = {
  clients: {
    metaKey: "frecuentes:lastResetAt",
    label: "clientes",
    fetch: async () => {
      const rows = await prisma.client.findMany({
        select: { id: true, viewCount: true, lastViewedAt: true },
      });
      return rows.map((r) => ({ id: r.id, score: r.viewCount ?? 0, lastActiveAt: r.lastViewedAt }));
    },
    apply: (updates) =>
      prisma.$transaction(
        updates.map((u) => prisma.client.update({ where: { id: u.id }, data: { viewCount: u.score, cycleInteractions: 0 } }))
      ),
  },
  contacts: {
    metaKey: "frecuentes:lastResetAt:contacts",
    label: "contactos",
    fetch: async () => {
      const rows = await prisma.clientContact.findMany({
        select: { id: true, viewCount: true, lastViewedAt: true },
      });
      return rows.map((r) => ({ id: r.id, score: r.viewCount ?? 0, lastActiveAt: r.lastViewedAt }));
    },
    apply: (updates) =>
      prisma.$transaction(
        updates.map((u) => prisma.clientContact.update({ where: { id: u.id }, data: { viewCount: u.score, cycleInteractions: 0 } }))
      ),
  },
};

async function purge(target: ResetTarget): Promise<boolean> {
  const meta = await prisma.appMeta.findUnique({ where: { key: target.metaKey } });
  if (meta && Date.now() - new Date(meta.value).getTime() < RESET_INTERVAL_MS) return false;

  const next = redistributeScores(await target.fetch());
  await target.apply(next);

  await prisma.appMeta.upsert({
    where: { key: target.metaKey },
    update: { value: new Date().toISOString() },
    create: { key: target.metaKey, value: new Date().toISOString() },
  });

  return true;
}

/** Purga semanal de un solo grupo (clientes o contactos). */
export function runFrecuentesReset(kind: "clients" | "contacts" = "clients"): Promise<boolean> {
  return purge(TARGETS[kind]);
}

/** Purga semanal de todos los grupos que usan el motor de frecuencia. */
export async function runAllResets(): Promise<void> {
  await Promise.allSettled(Object.values(TARGETS).map(purge));
}

/**
 * Scheduler de la purga semanal. Se dispara al arrancar el servidor y luego
 * una vez por hora. El timer se "unref" para no mantener vivo el proceso
 * (importante para que los tests terminen).
 */
export function scheduleFrecuentesReset(): void {
  const run = () => {
    runAllResets()
      .then(() => console.log("[frecuentes] purga semanal: rankings redistribuidos (clientes y contactos)"))
      .catch((err) => console.error("[frecuentes] error en la purga semanal:", err));
  };

  setTimeout(run, 5_000);
  const timer = setInterval(run, RESET_CHECK_MS);
  timer.unref?.();
}

export type { FrequencyEntry };
