/** El QR de un rollo lleva el código y el token de posesión pegados con
 * un guión de más (`EXT-9-K7M9XT4P2R6HW3JC`, ver
 * server/src/services/rollPossessionToken.ts) -- se separan acá ANTES de
 * decidir qué tipo de código es. Una etiqueta de bulto no tiene esta
 * protección (no lleva token), así que si no hay un segundo guión se asume
 * que no hay token -- eso pasa igual con cualquier código tipeado a mano
 * en vez de escaneado. */
export function splitScannedCode(raw: string): { code: string; token: string } {
  const match = /^([A-Za-z]+-\d+)-(.+)$/.exec(raw);
  return match ? { code: match[1], token: match[2] } : { code: raw, token: "" };
}
