/**
 * Datos del catálogo que no cuadran entre sí (ej. "ALTA DENSIDAD" en el nombre
 * y Densidad BAJA). Son avisos, no bloquean el guardado: quien carga decide
 * si corrige el nombre o el campo. Solo se marca lo inequívoco; si el nombre
 * nombra dos colores (ej. "blanca con impresión roja") no se adivina.
 */
export interface CatalogProductLike {
  id?: number;
  name?: string | null;
  color?: string | null;
  densidad?: string | null;
  measure?: string | null;
  measureUnit?: string | null;
  unitPrice?: number | string | null;
  active?: boolean;
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// "verde claro" antes que "verde" para que no se cuente dos veces.
const COLOR_WORDS: { color: string; pattern: RegExp }[] = [
  { color: "Verde claro", pattern: /\bverdes?\s+claros?\b/ },
  { color: "Verde", pattern: /\bverdes?\b/ },
  { color: "Negro", pattern: /\bnegr[oa]s?\b/ },
  { color: "Blanco", pattern: /\bblanc[oa]s?\b/ },
  { color: "Rojo", pattern: /\broj[oa]s?\b/ },
  { color: "Transparente", pattern: /\b(transparentes?|trasparentes?|natural(es)?)\b/ },
];

function colorsInName(name: string): string[] {
  let rest = fold(name);
  const found: string[] = [];
  for (const { color, pattern } of COLOR_WORDS) {
    if (pattern.test(rest)) {
      found.push(color);
      rest = rest.replace(new RegExp(pattern.source, "g"), " ");
    }
  }
  return found;
}

function densityInName(name: string): "ALTA" | "BAJA" | null {
  const m = /\b(alta|baja)\s+densidad\b|\bdensidad\s+(alta|baja)\b/.exec(fold(name));
  if (!m) return null;
  return (m[1] ?? m[2]).toUpperCase() as "ALTA" | "BAJA";
}

export function catalogIssues(p: CatalogProductLike): string[] {
  const issues: string[] = [];
  const name = p.name?.trim() ?? "";

  const nameDensity = name ? densityInName(name) : null;
  if (nameDensity && p.densidad && p.densidad !== nameDensity) {
    issues.push(`El nombre dice ${nameDensity} DENSIDAD pero la Densidad es ${p.densidad}.`);
  } else if (nameDensity && !p.densidad) {
    issues.push(`El nombre dice ${nameDensity} DENSIDAD pero la Densidad está vacía.`);
  }

  const nameColors = name ? colorsInName(name) : [];
  if (nameColors.length === 1 && p.color && p.color !== nameColors[0]) {
    issues.push(`El nombre dice ${nameColors[0].toLowerCase()} pero el Color es ${p.color}.`);
  }

  const measure = p.measure?.trim() ?? "";
  if (measure) {
    const m = fold(measure);
    if (!p.measureUnit) issues.push("Hay medida pero falta la Unidad de medida (pulgadas o cms).");
    else if (/\bcms?\b|\d\s*cms?\b/.test(m) && p.measureUnit === "Pulgadas") issues.push("La medida dice cm pero la Unidad de medida es Pulgadas.");
    else if (/("|\bpulg)/.test(m) && p.measureUnit === "Cms.") issues.push("La medida dice pulgadas pero la Unidad de medida es Cms.");
  }

  if (p.unitPrice != null && Number(p.unitPrice) === 0) {
    issues.push("El precio está en 0: saldría en cero en cotizaciones y facturas.");
  }
  return issues;
}

/** Productos activos con el mismo nombre y la misma medida (sin importar mayúsculas,
 * tildes ni espacios). Mismo nombre con distinta medida es normal (ej. rollos
 * precorte 9x14 y 20x30), no se marca. */
export function duplicateNameIds(products: CatalogProductLike[]): Set<number> {
  const norm = (v: string | null | undefined) => fold(v ?? "").replace(/\s+/g, "").trim();
  const byName = new Map<string, number[]>();
  for (const p of products) {
    if (p.active === false || p.id == null || !p.name) continue;
    const key = `${fold(p.name).replace(/\s+/g, " ").trim()}|${norm(p.measure)}|${norm(p.measureUnit)}`;
    byName.set(key, [...(byName.get(key) ?? []), p.id]);
  }
  const ids = new Set<number>();
  for (const group of byName.values()) if (group.length > 1) group.forEach((id) => ids.add(id));
  return ids;
}
