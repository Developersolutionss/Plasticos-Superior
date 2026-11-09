import { productCalibre, productMeasure } from "./productMeasure";

/** Producto con los campos por los que se busca en Inventario → Productos. */
export interface SearchableProduct {
  sku?: string | null;
  name?: string | null;
  measure?: string | null;
  measureUnit?: string | null;
  calibre?: string | null;
  color?: string | null;
  densidad?: string | null;
  talla?: string | null;
  category?: string | null;
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * ¿El producto coincide con lo que se escribió en el buscador? Cada palabra
 * tiene que aparecer en algún dato (código, nombre, medida, calibre, color,
 * densidad, talla o categoría), sin importar mayúsculas ni tildes. Así
 * "bolsa 13x21 blanco" o "baja 0.7" encuentran la referencia exacta.
 * La medida se busca también sin espacios ("13 x 21" ≡ "13x21").
 */
export function matchesProductSearch(p: SearchableProduct, query: string, categoryLabel = ""): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const measure = productMeasure(p);
  const haystack = fold(
    [
      p.sku,
      p.name,
      measure,
      measure.replace(/\s+/g, ""),
      productCalibre(p),
      p.color,
      p.densidad,
      p.densidad ? `${p.densidad} densidad` : "",
      p.talla,
      categoryLabel,
    ]
      .filter(Boolean)
      .join(" | ")
  );
  return words.every((w) => haystack.includes(w));
}
