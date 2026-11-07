/**
 * Colores de producto / OP. Arranca con la lista base y se le suman los que
 * agregue Planeación desde el catálogo (ver productColors.ts, que los guarda
 * en app_meta y los empuja ACÁ al arrancar o al agregarlos).
 *
 * Es un arreglo vivo a propósito: las plantillas de OP (opTemplates.ts)
 * guardan esta misma referencia como `options` del campo Color, así un
 * color nuevo vale en el producto y en las OPs sin reiniciar el servidor.
 * Este archivo no importa nada para que opTemplates siga siendo puro.
 */
export const BASE_COLORES = ["Negro", "Transparente", "Blanco", "Rojo", "Verde", "Verde claro"] as const;

export const COLORES: string[] = [...BASE_COLORES];

/** Para comparar sin mayúsculas, tildes ni espacios de más. */
export function foldColor(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** El color de la lista que corresponde a `value` ("verde CLARO" → "Verde claro"), o null. */
export function matchColor(value: string): string | null {
  const folded = foldColor(value);
  return COLORES.find((c) => foldColor(c) === folded) ?? null;
}
