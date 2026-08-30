import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CircleCheck, CircleX, CircleDashed, Factory, Package, Warehouse, Truck } from "lucide-react";
import { api } from "../api/client";

const STATION_LABELS: Record<string, string> = {
  extrusion: "Extrusión",
  impresion: "Impresión",
  sellado: "Sellado",
  precorte: "Precorte",
};

const STATUS_LABELS: Record<string, string> = {
  borrador: "Borrador",
  pendiente: "Pendiente",
  en_proceso: "En proceso",
  pendiente_calidad: "Pendiente de calidad",
  detenida: "Detenida",
  finalizada: "Terminada",
  cancelada: "Cancelada",
};

/** Arma la cadena completa (todas las etapas comparten orderNumber, ver
 * GET /production-orders/:id) como filas con profundidad, para dibujarla
 * de una sola vez en vez de ir clickeando padre por padre. */
function buildChainRows(chain: any[]) {
  const byId = new Map(chain.map((c) => [c.id, c]));
  const childrenOf = new Map<number, any[]>();
  for (const c of chain) {
    if (c.parentOrderId != null) {
      if (!childrenOf.has(c.parentOrderId)) childrenOf.set(c.parentOrderId, []);
      childrenOf.get(c.parentOrderId)!.push(c);
    }
  }
  const roots = chain.filter((c) => c.parentOrderId == null || !byId.has(c.parentOrderId));
  const rows: { node: any; depth: number }[] = [];
  function walk(node: any, depth: number) {
    rows.push({ node, depth });
    for (const child of childrenOf.get(node.id) ?? []) walk(child, depth + 1);
  }
  for (const r of roots) walk(r, 0);
  return rows;
}

function kgOf(node: any) {
  return (node.rolls ?? []).reduce((acc: number, r: any) => acc + Number(r.weightKg), 0);
}

export default function Trazabilidad() {
  const [selectedId, setSelectedId] = useState("");

  const { data: orders } = useQuery({ queryKey: ["productionOrders"], queryFn: () => api.getProductionOrders() });
  const { data: order, isLoading } = useQuery({
    queryKey: ["productionOrder", selectedId],
    queryFn: () => api.getProductionOrder(Number(selectedId)),
    enabled: !!selectedId,
  });

  const origin = order?.pedidoVersionItem?.pedidoVersion?.pedido;

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Trazabilidad</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Historial completo de una orden de producción: estaciones, calidad y origen</p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5">
        <select
          className="w-full border border-slate-300 dark:border-slate-600 rounded-md px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-500"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          <option value="">Orden de producción (OP)...</option>
          {orders?.map((o: any) => (
            <option key={o.id} value={o.id}>
              {o.orderNumber} ({STATION_LABELS[o.station] ?? o.station ?? "Sin proceso"}) — {o.product.name}
            </option>
          ))}
        </select>
      </div>

      {isLoading && <p className="text-sm text-slate-500 dark:text-slate-400">Cargando...</p>}

      {order && (
        <>
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100 dark:border-slate-700">
              <Package size={16} strokeWidth={2} className="text-slate-500 dark:text-slate-400" aria-hidden="true" />
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{order.orderNumber}</p>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">Producto</span>
                <span className="text-slate-800 dark:text-slate-100">
                  {order.product.name} ({order.product.sku})
                </span>
              </div>
              <div>
                <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">Cantidad planificada</span>
                <span className="text-slate-800 dark:text-slate-100">
                  {order.quantityPlanned} {order.product.unit}
                </span>
              </div>
              <div>
                <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">Proceso</span>
                <span className="text-slate-800 dark:text-slate-100">{STATION_LABELS[order.station] ?? order.station ?? "Sin proceso"}</span>
              </div>
              <div>
                <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">Cliente</span>
                <span className="text-slate-800 dark:text-slate-100">{order.client?.name ?? "—"}</span>
              </div>
              <div className="sm:col-span-2">
                <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">Origen</span>
                <span className="text-slate-800 dark:text-slate-100">
                  {origin ? `Pedido ${origin.orderNumber} — ${origin.client.name}` : "Producción a stock (sin pedido de origen)"}
                </span>
              </div>
              {order.chain?.length > 1 && (
                <div className="sm:col-span-2">
                  <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Cadena de derivación completa</span>
                  <ul className="space-y-1">
                    {buildChainRows(order.chain).map(({ node, depth }) => (
                      <li
                        key={node.id}
                        style={{ paddingLeft: depth * 16 }}
                        className={`flex items-center gap-2 text-slate-800 dark:text-slate-100 ${node.id === order.id ? "font-semibold" : ""}`}
                      >
                        {depth > 0 && <span className="text-slate-400 dark:text-slate-500">↳</span>}
                        <span>{STATION_LABELS[node.station] ?? node.station ?? "Sin proceso"}</span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          ({STATUS_LABELS[node.status] ?? node.status}, {Math.round(kgOf(node) * 100) / 100} kg)
                        </span>
                        {node.id === order.id && <span className="text-xs text-sky-600 dark:text-sky-400">← esta</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100 dark:border-slate-700">
              <Warehouse size={16} strokeWidth={2} className="text-slate-500 dark:text-slate-400" aria-hidden="true" />
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Ubicación actual en almacén</p>
            </div>
            <div className="p-5 text-sm">
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                Stock actual de {order.product.name} por estantería — el inventario no distingue de qué OP vino cada kilo, así que esto es la
                foto general del producto, no específicamente el lote de esta OP.
              </p>
              {order.warehouseLocations?.length > 0 ? (
                <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                  {order.warehouseLocations.map((wl: any, i: number) => (
                    <li key={i} className="py-2 flex items-center justify-between">
                      <span className="text-slate-800 dark:text-slate-100">
                        {wl.location.code} — {wl.location.label}
                      </span>
                      <span className="text-slate-500 dark:text-slate-400">{Number(wl.quantity)} {order.product.unit}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-slate-500 dark:text-slate-400">Este producto todavía no tiene stock ubicado en ninguna estantería.</p>
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100 dark:border-slate-700">
              <Truck size={16} strokeWidth={2} className="text-slate-500 dark:text-slate-400" aria-hidden="true" />
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Despachos recientes de este producto</p>
            </div>
            <ul className="divide-y divide-slate-100 dark:divide-slate-700 text-sm">
              {order.recentDispatchItems?.map((it: any) => (
                <li key={it.id} className="px-5 py-3 flex items-center justify-between">
                  <span className="text-slate-800 dark:text-slate-100">
                    {it.dispatch.client.name} · {Number(it.quantityDispatched ?? it.quantityRequested)} {order.product.unit}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {it.dispatch.status === "despachado" && it.dispatch.dispatchedDate
                      ? new Date(it.dispatch.dispatchedDate).toLocaleDateString()
                      : "pendiente"}
                  </span>
                </li>
              ))}
              {(!order.recentDispatchItems || order.recentDispatchItems.length === 0) && (
                <li className="px-5 py-4 text-slate-500 dark:text-slate-400">Este producto todavía no tiene despachos.</li>
              )}
            </ul>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100 dark:border-slate-700">
              <Factory size={16} strokeWidth={2} className="text-slate-500 dark:text-slate-400" aria-hidden="true" />
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Registro de rollos</p>
            </div>
            <ul className="divide-y divide-slate-100 dark:divide-slate-700 text-sm">
              {order.rolls?.map((r: any) => (
                <li key={r.id} className="px-5 py-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-800 dark:text-slate-100">
                      {r.label ?? "Rollo"} · {Number(r.weightKg)} kg
                    </span>
                    <span className="text-slate-500 dark:text-slate-400">{new Date(r.date).toLocaleDateString()}</span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-300 mt-0.5">
                    {[r.shift, r.operatorName, r.machine].filter(Boolean).join(" · ")}
                    {Number(r.wasteKg) > 0 && ` · desperdicio ${Number(r.wasteKg)} kg`}
                  </p>
                  {r.createdBy?.name && r.createdBy.name !== r.operatorName && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                      Cargado desde la cuenta de {r.createdBy.name}
                    </p>
                  )}
                  {r.sourceRoll && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Insumo: rollo {r.sourceRoll.label ?? `#${r.sourceRoll.id}`} ({Number(r.sourceRoll.weightKg)} kg)
                      {r.sourceRoll.createdBy?.name && <> · producido por {r.sourceRoll.createdBy.name}</>} — escaneado por {r.createdBy?.name ?? r.operatorName}
                    </p>
                  )}
                </li>
              ))}
              {(!order.rolls || order.rolls.length === 0) && (
                <li className="px-5 py-4 text-slate-500 dark:text-slate-400">Todavía no tiene rollos registrados.</li>
              )}
            </ul>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100 dark:border-slate-700">
              <CircleCheck size={16} strokeWidth={2} className="text-slate-500 dark:text-slate-400" aria-hidden="true" />
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Control de calidad</p>
            </div>
            <div className="p-5 text-sm">
              {order.qualityCheck ? (
                <div className="flex items-start gap-2">
                  {order.qualityCheck.result === "aprobado" ? (
                    <CircleCheck size={18} strokeWidth={2} className="text-emerald-600 dark:text-emerald-400 mt-0.5" aria-hidden="true" />
                  ) : (
                    <CircleX size={18} strokeWidth={2} className="text-red-600 dark:text-red-400 mt-0.5" aria-hidden="true" />
                  )}
                  <div>
                    <p className="font-medium text-slate-800 dark:text-slate-100">
                      {order.qualityCheck.result === "aprobado" ? "Aprobado" : "Rechazado"}
                    </p>
                    {order.qualityCheck.observations && (
                      <p className="text-slate-600 dark:text-slate-300 mt-0.5">{order.qualityCheck.observations}</p>
                    )}
                    <p className="text-slate-500 dark:text-slate-400 mt-1">
                      {order.qualityCheck.createdBy?.name ?? "—"} ·{" "}
                      {new Date(order.qualityCheck.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                  <CircleDashed size={18} strokeWidth={2} aria-hidden="true" />
                  {order.status === "pendiente_calidad" ? "Pendiente de revisión" : "Todavía no llega a control de calidad"}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
