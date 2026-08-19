import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CircleCheck, CircleX, CircleDashed, Factory, Package } from "lucide-react";
import { api } from "../api/client";

const STATION_LABELS: Record<string, string> = {
  extrusion: "Extrusión",
  impresion: "Impresión",
  sellado: "Sellado",
  precorte: "Precorte",
};

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
              {o.orderNumber} ({STATION_LABELS[o.station] ?? o.station}) — {o.product.name}
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
                <span className="text-slate-800 dark:text-slate-100">{STATION_LABELS[order.station] ?? order.station}</span>
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
              {(order.parent || order.derivedOrders?.length > 0) && (
                <div className="sm:col-span-2">
                  <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">Cadena de derivación</span>
                  <span className="text-slate-800 dark:text-slate-100">
                    {order.parent && `Derivada de ${order.parent.orderNumber} (${STATION_LABELS[order.parent.station] ?? order.parent.station})`}
                    {order.parent && order.derivedOrders?.length > 0 && " · "}
                    {order.derivedOrders?.length > 0 &&
                      `Deriva en ${order.derivedOrders
                        .map((d: any) => `${d.orderNumber} (${STATION_LABELS[d.station] ?? d.station})`)
                        .join(", ")}`}
                  </span>
                </div>
              )}
            </div>
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
