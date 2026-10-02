import type { OpStation } from "../opTemplates";

/**
 * Qué se puede precargar al escanear un rollo en Despacho a bodegas, a
 * partir de lo que devuelve GET /roll-transfers/scan y del rol de quien
 * escanea. Todo queda editable; si hay duda real no se elige nada (decisión
 * de Gestión 2026-10-02: mejor que el operario elija a que se vaya a la
 * bodega equivocada).
 *
 * Destino, en este orden:
 *  1. La estación del operario que escanea, si es un destino posible — es
 *     el que se lo está llevando a su bodega.
 *  2. La única estación con OP derivada abierta esperando material.
 *  3. Con varias esperando, la que coincide con "Material para" de la OP.
 *  4. Sin ninguna esperando: "Material para" si es un destino posible, o el
 *     único destino si hay uno solo.
 *  Si nada de eso aplica: ninguno.
 *
 * Modo: "retiro" si el destino es la bodega del operario que escanea (se lo
 * lleva él), "entrega" en cualquier otro caso.
 */
export function suggestDispatch(
  info: { destinations: OpStation[]; expectingStations?: OpStation[]; materialPara?: OpStation | null },
  ownStation: OpStation | undefined
): { toStation: OpStation | ""; mode: "entrega" | "retiro" } {
  const destinations = info.destinations;
  const expecting = (info.expectingStations ?? []).filter((s) => destinations.includes(s));
  const materialPara = info.materialPara ?? null;

  let toStation: OpStation | "" = "";
  if (ownStation && destinations.includes(ownStation)) toStation = ownStation;
  else if (expecting.length === 1) toStation = expecting[0];
  else if (expecting.length > 1) toStation = materialPara && expecting.includes(materialPara) ? materialPara : "";
  else if (materialPara && destinations.includes(materialPara)) toStation = materialPara;
  else if (destinations.length === 1) toStation = destinations[0];

  const mode = ownStation && toStation === ownStation ? "retiro" : "entrega";
  return { toStation, mode };
}
