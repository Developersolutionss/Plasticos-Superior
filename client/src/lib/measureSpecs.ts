const NUM = String.raw`\d+(?:[.,]\d+)?`;
const SINGLE = new RegExp(String.raw`^(${NUM})`);
// "A x L" o, para bolsas con fuelles, "A + F1 + F2 x L" (ancho más fuelles, por largo).
const PAIR = new RegExp(String.raw`^(${NUM})(?:\s*\+\s*${NUM})*\s*[xX]\s*(${NUM})`);

/** El dueño pidió que "Medidas" (ej. "12x18") precargue Ancho (primer
 * número, casilla ANCHO de Especificaciones/Material) y, cuando el formato
 * es "AxB", el segundo número se reparte según pinta: si es chico/decimal
 * (< 1, ej. "0.00045") es un CALIBRE, no un largo — se guarda en `calibre`
 * (existe en las 4 estaciones). Si es un número "de tamaño normal" (ej.
 * "18"), se interpreta como el Largo del par Ancho/Largo de "Medidas
 * finales" (medAncho/medLargo) — esas dos claves solo existen en Sellado/
 * Precorte, en Extrusión/Impresión simplemente no aplican y no se setean.
 *
 * Las bolsas con fuelles se cargan "8+2.5+5.5x16" (ancho + fuelles x largo):
 * Ancho y Largo salen igual que en "8x16"; los fuelles no se reparten solos
 * (no hay una regla confirmada de cuál va en Lateral y cuál en Fuelle fondo),
 * quedan en el texto de Medidas para que los cargue quien arma la OP. */
export function deriveSpecsFromMeasure(measure: string): Record<string, string> {
  const value = measure.trim();
  const result: Record<string, string> = {};
  const anchoMatch = SINGLE.exec(value);
  if (anchoMatch) result.ancho = anchoMatch[1];

  const parMatch = PAIR.exec(value);
  if (parMatch) {
    const second = Number(parMatch[2].replace(",", "."));
    if (second > 0 && second < 1) {
      result.calibre = parMatch[2];
    } else {
      result.medAncho = parMatch[1];
      result.medLargo = parMatch[2];
    }
  }
  return result;
}
