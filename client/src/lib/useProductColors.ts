import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { COLORES } from "../opTemplates";

export const PRODUCT_COLORS_KEY = ["product-colors"] as const;

/**
 * Colores disponibles para productos y OPs: la lista base más los que se
 * agregaron desde el catálogo ("+ Agregar color"). Mientras carga, o si
 * falla, se usa la lista base para no dejar el selector vacío.
 */
export function useProductColors(): string[] {
  const { data } = useQuery({ queryKey: PRODUCT_COLORS_KEY, queryFn: api.getProductColors, staleTime: 5 * 60 * 1000 });
  return Array.isArray(data) && data.length > 0 ? data : COLORES;
}
