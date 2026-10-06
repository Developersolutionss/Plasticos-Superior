/** El QR de un rollo lleva el código y el token de posesión pegados con
 * un guión de más (`EXT-9-K7M9XT4P2R6HW3JC`, ver
 * server/src/services/rollPossessionToken.ts) -- se separan acá ANTES de
 * decidir qué tipo de código es. Una etiqueta de bulto no tiene esta
 * protección (no lleva token), así que si no hay un segundo guión se asume
 * que no hay token -- eso pasa igual con cualquier código tipeado a mano
 * en vez de escaneado. */
export function splitScannedCode(raw: string): { code: string; token: string } {
  // El alfabeto del token y los prefijos de rollo son solo en mayúsculas: a
  // mano el teclado del celular puede escribir "ext-8-k7m9..." en minúscula.
  const match = /^([A-Za-z]+-\d+)-(.+)$/.exec(raw);
  if (match) return { code: match[1].toUpperCase(), token: match[2].trim().toUpperCase() };
  return { code: /^[A-Za-z]+-\d+$/.test(raw) ? raw.toUpperCase() : raw, token: "" };
}
