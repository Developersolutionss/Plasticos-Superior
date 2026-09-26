import { prisma } from "../prisma";
import type { TxClient } from "./stockService";
import { STATION_LABELS, type OpStation } from "./opTemplates";

/**
 * Dónde está físicamente un rollo AHORA, según los despachos a bodegas
 * (roll_transfers): en la bodega del último despacho recibido, en camino si
 * el último despacho sigue abierto, o en la estación donde se produjo si
 * nunca se movió. El último despacho (por id) manda: solo puede haber uno
 * abierto a la vez (ver POST /roll-transfers) y uno anulado se borra.
 */
export type RollLocation =
  | { status: "en_bodega"; station: OpStation }
  | { status: "en_transito"; fromStation: OpStation; toStation: OpStation; carrierName: string };

export async function getRollLocation(
  tx: TxClient | typeof prisma,
  roll: { id: number; station: string }
): Promise<RollLocation> {
  const last = await tx.rollTransfer.findFirst({ where: { rollId: roll.id }, orderBy: { id: "desc" } });
  if (last?.status === "en_transito") {
    return {
      status: "en_transito",
      fromStation: last.fromStation as OpStation,
      toStation: last.toStation as OpStation,
      carrierName: last.carrierName,
    };
  }
  return { status: "en_bodega", station: (last?.status === "recibido" ? last.toStation : roll.station) as OpStation };
}

/**
 * Regla de planta (confirmada por Gestión 2026-09-26): un rollo solo se
 * consume en la estación donde está físicamente. Para usarlo en otra
 * estación primero hay que despacharlo a su bodega y que allá lo reciban
 * (Despacho a bodegas). Devuelve el mensaje para el operario si no se puede
 * consumir en `consumingStation`, o null si está ahí.
 */
export function rollLocationBlock(code: string, location: RollLocation, consumingStation: OpStation): string | null {
  if (location.status === "en_transito") {
    return `El rollo ${code} está en camino a la bodega de ${STATION_LABELS[location.toStation]} (lo lleva ${location.carrierName}) — hay que confirmar que llegó en Despacho a bodegas antes de poder consumirlo`;
  }
  if (location.station !== consumingStation) {
    return `El rollo ${code} está en la bodega de ${STATION_LABELS[location.station]} — para consumirlo en ${STATION_LABELS[consumingStation]} primero hay que despacharlo a la bodega de ${STATION_LABELS[consumingStation]} y recibirlo allá (Despacho a bodegas)`;
  }
  return null;
}
