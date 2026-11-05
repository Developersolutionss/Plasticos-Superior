/**
 * Medida de un producto para mostrar al lado del nombre (ej. "8+2.5+5.5x16 pulg",
 * "20x30 cm"). Varias bolsas comparten nombre y solo se distinguen por la medida,
 * así que los selectores y listas de producto la muestran.
 */
export interface MeasuredProduct {
  name: string;
  measure?: string | null;
  measureUnit?: string | null;
}

const UNIT_SHORT: Record<string, string> = { Pulgadas: "pulg", "Cms.": "cm" };

export function productMeasure(p: Pick<MeasuredProduct, "measure" | "measureUnit">): string {
  const m = p.measure?.trim() ?? "";
  if (!m) return "";
  const unit = p.measureUnit ? UNIT_SHORT[p.measureUnit] ?? p.measureUnit : "";
  // Si la medida ya trae la unidad escrita ("20x30cm", '8"'), no se repite.
  return unit && !/[a-zA-Z"]\s*$/.test(m) ? `${m} ${unit}` : m;
}

/** "Bolsa manigueta · 8+2.5+5.5x16 pulg" (o solo el nombre si no tiene medida). */
export function nameWithMeasure(p: MeasuredProduct): string {
  const m = productMeasure(p);
  return m ? `${p.name} · ${m}` : p.name;
}
