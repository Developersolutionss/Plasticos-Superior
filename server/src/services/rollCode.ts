import type { Prisma } from "../generated/prisma/client";
import type { OpStation } from "./opTemplates";

// Cada estación numera aparte, arrancando en 1 (ver ProductionRoll.station/
// stationSequence en el schema) — el código captura el prefijo Y el número
// para poder resolver por ambos, no solo por el número.
export const ROLL_CODE_RE = /^(EXT|IMP|SELL|PRE)-(\d+)$/;
// Formato viejo, de ANTES de tener prefijo por estación (ver 51fc5ed): el
// número era el id global de la tabla. Las etiquetas físicas ya impresas con
// este formato (pegadas en rollos que todavía pueden estar circulando en
// planta) tienen que seguir resolviendo — si no, un operario que escanea un
// rollo viejo se encuentra con "código inválido" de la nada.
export const LEGACY_ROLL_CODE_RE = /^RL-(\d+)$/;
export const PREFIX_TO_STATION: Record<string, OpStation> = { EXT: "extrusion", IMP: "impresion", SELL: "sellado", PRE: "precorte" };

/**
 * Traduce el código de la etiqueta de un rollo (`EXT-9`, o el viejo `RL-12`)
 * al `where` para buscarlo. Null si el formato no es de rollo o el número no
 * entra en un `integer` de Postgres (un QR mal leído puede traer un número
 * absurdo, que llegaría tal cual a la query y explotaría como 500).
 */
export function rollWhereFromCode(code: string): Prisma.ProductionRollWhereUniqueInput | null {
  const match = ROLL_CODE_RE.exec(code);
  const legacyMatch = LEGACY_ROLL_CODE_RE.exec(code);
  if (!match && !legacyMatch) return null;
  const codeNumber = Number(match ? match[2] : legacyMatch![1]);
  if (!Number.isSafeInteger(codeNumber) || codeNumber > 2147483647) return null;
  return match
    ? { station_stationSequence: { station: PREFIX_TO_STATION[match[1]], stationSequence: codeNumber } }
    : { id: codeNumber };
}
