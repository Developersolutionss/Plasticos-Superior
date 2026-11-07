/**
 * Medida y calibre de un producto para mostrar al lado del nombre (ej.
 * "8+2.5+5.5x16 pulg · cal 0.6"). Varias bolsas comparten nombre y solo se
 * distinguen por la medida y el calibre, así que los selectores y listas de
 * producto los muestran.
 */
export interface MeasuredProduct {
  name: string;
  measure?: string | null;
  measureUnit?: string | null;
  calibre?: string | null;
  color?: string | null;
}

const UNIT_SHORT: Record<string, string> = { Pulgadas: "pulg", "Cms.": "cm" };

export function productMeasure(p: Pick<MeasuredProduct, "measure" | "measureUnit">): string {
  const m = p.measure?.trim() ?? "";
  if (!m) return "";
  const unit = p.measureUnit ? UNIT_SHORT[p.measureUnit] ?? p.measureUnit : "";
  // Si la medida ya trae la unidad escrita ("20x30cm", '8"'), no se repite.
  return unit && !/[a-zA-Z"]\s*$/.test(m) ? `${m} ${unit}` : m;
}

/** "cal 0.7", o "" si no tiene calibre (no se repite "cal" si ya lo escribieron). */
export function productCalibre(p: Pick<MeasuredProduct, "calibre">): string {
  const c = p.calibre?.trim() ?? "";
  if (!c) return "";
  return /^cal/i.test(c) ? c : `cal ${c}`;
}

/** "5x10 pulg · cal 0.7 · Blanco" — medida, calibre y color, lo que tenga. El color
 * distingue la misma referencia en distinto color. */
export function productSpecs(p: Omit<MeasuredProduct, "name">): string {
  return [productMeasure(p), productCalibre(p), p.color?.trim() ?? ""].filter(Boolean).join(" · ");
}

/** "Bolsa baja densidad · 5x10 pulg · cal 0.7" (o solo el nombre si no tiene medida ni calibre). */
export function nameWithMeasure(p: MeasuredProduct): string {
  const specs = productSpecs(p);
  return specs ? `${p.name} · ${specs}` : p.name;
}
