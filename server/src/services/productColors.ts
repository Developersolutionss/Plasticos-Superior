import { prisma } from "../prisma";
import { BASE_COLORES, COLORES, foldColor, matchColor } from "./colorList";

/** Clave en app_meta con los colores agregados (JSON: string[]), sin los de la lista base. */
const META_KEY = "product_colors";

let loading: Promise<void> | null = null;

function pushMissing(names: string[]): void {
  for (const name of names) {
    if (typeof name === "string" && name.trim() && !matchColor(name)) COLORES.push(name.trim());
  }
}

/** Carga (una sola vez por proceso) los colores agregados a la lista viva. */
export function ensureProductColorsLoaded(): Promise<void> {
  if (!loading) {
    loading = prisma.appMeta
      .findUnique({ where: { key: META_KEY } })
      .then((row) => {
        if (!row) return;
        try {
          const saved = JSON.parse(row.value);
          if (Array.isArray(saved)) pushMissing(saved);
        } catch {
          console.error("[colores] app_meta.product_colors no es un JSON válido; se usa solo la lista base");
        }
      })
      .catch((err) => {
        loading = null; // reintenta en la próxima llamada
        throw err;
      });
  }
  return loading;
}

/** "azul  rey" → "Azul rey" (primera letra en mayúscula, el resto como lo escribieron). */
function tidy(name: string): string {
  const clean = name.replace(/\s+/g, " ").trim();
  return clean.charAt(0).toLocaleUpperCase("es-CO") + clean.slice(1);
}

/**
 * Agrega un color a la lista (si ya existe, aunque sea con otras mayúsculas
 * o tildes, devuelve el existente sin duplicarlo).
 */
export async function addProductColor(name: string): Promise<{ color: string; created: boolean }> {
  await ensureProductColorsLoaded();
  const existing = matchColor(name);
  if (existing) return { color: existing, created: false };
  const color = tidy(name);
  const base = new Set(BASE_COLORES.map(foldColor));
  const extra = [...COLORES.filter((c) => !base.has(foldColor(c))), color];
  const value = JSON.stringify(extra);
  await prisma.appMeta.upsert({ where: { key: META_KEY }, create: { key: META_KEY, value }, update: { value } });
  COLORES.push(color);
  return { color, created: true };
}
