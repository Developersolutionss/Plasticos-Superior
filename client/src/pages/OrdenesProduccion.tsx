import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GitBranch } from "lucide-react";
import { api } from "../api/client";
import { STATION_LABELS, OpStation } from "../opTemplates";

const STATUS_LABELS: Record<string, string> = {
  borrador: "Borrador",
  pendiente: "Pendiente",
  en_proceso: "En proceso",
  pendiente_calidad: "Pendiente de calidad",
  detenida: "Detenida",
  finalizada: "Terminada",
  cancelada: "Cancelada",
};

const STATUS_COLORS: Record<string, string> = {
  borrador: "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300",
  pendiente: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200",
  en_proceso: "bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-400",
  pendiente_calidad: "bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-400",
  detenida: "bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400",
  finalizada: "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400",
  cancelada: "bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-400",
};

const STATION_COLORS: Record<string, string> = {
  extrusion: "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900",
  impresion: "bg-sky-700 text-white",
  sellado: "bg-emerald-700 text-white",
  precorte: "bg-amber-600 text-white",
};

function kilosProducidos(order: any) {
  return (order.rolls ?? []).reduce((acc: number, r: any) => acc + Number(r.weightKg), 0);
}

export function StationBadge({ station }: { station: string }) {
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 ${STATION_COLORS[station] ?? ""}`}>
      {STATION_LABELS[station as OpStation] ?? station}
    </span>
  );
}

export default function OrdenesProduccion() {
  const [station, setStation] = useState<string>("");
  const [productId, setProductId] = useState("");
  const [clientId, setClientId] = useState("");
  const [newStation, setNewStation] = useState<string>("extrusion");
  const [quantityPlanned, setQuantityPlanned] = useState("");
  const [measure, setMeasure] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: products } = useQuery({ queryKey: ["products"], queryFn: api.getProducts });
  const { data: clients } = useQuery({ queryKey: ["clients"], queryFn: api.getClients });
  const { data: orders, isLoading } = useQuery({
    queryKey: ["productionOrders", station],
    queryFn: () => api.getProductionOrders(station ? { station } : undefined),
  });

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!productId || !quantityPlanned) return;
    try {
      const order = await api.createProductionOrder({
        station: newStation,
        productId: Number(productId),
        clientId: clientId ? Number(clientId) : undefined,
        quantityPlanned: Number(quantityPlanned),
        measure: measure || undefined,
        notes: notes || undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["productionOrders"] });
      // Directo a la hoja de la OP para completar las specs de la plantilla.
      navigate(`/produccion/ordenes/${order.id}`);
    } catch {
      setError("No se pudo crear la OP");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Órdenes de producción</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Una OP por proceso: Extrusión es la base y de ella se derivan Impresión, Sellado y Precorte
        </p>
      </div>

      <form onSubmit={handleCreate} className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 space-y-3">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Nueva orden de producción</p>
        {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <select
            className="border rounded px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            value={newStation}
            onChange={(e) => setNewStation(e.target.value)}
          >
            {Object.entries(STATION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                Proceso: {label}
              </option>
            ))}
          </select>
          <select
            className="border rounded px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
          >
            <option value="">Producto (referencia)...</option>
            {products?.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.sku})
              </option>
            ))}
          </select>
          <select
            className="border rounded px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            <option value="">Cliente (opcional)...</option>
            {clients?.map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            className="border rounded px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            placeholder="Cantidad planificada (kg)"
            type="number"
            step="0.01"
            value={quantityPlanned}
            onChange={(e) => setQuantityPlanned(e.target.value)}
          />
          <input
            className="border rounded px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            placeholder="Medidas (opcional)"
            value={measure}
            onChange={(e) => setMeasure(e.target.value)}
          />
          <input
            className="border rounded px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            placeholder="Notas (opcional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <button className="bg-slate-800 text-white text-sm px-4 py-2 rounded" type="submit">
          Crear OP y abrir su hoja
        </button>
      </form>

      <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4">
        <select
          className="border rounded px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          value={station}
          onChange={(e) => setStation(e.target.value)}
        >
          <option value="">Todos los procesos</option>
          {Object.entries(STATION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {isLoading && <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 text-center text-slate-500 dark:text-slate-400 text-sm">Cargando...</div>}

      {!isLoading && orders?.length === 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 text-center text-slate-500 dark:text-slate-400 text-sm">
          Todavía no hay órdenes de producción.
        </div>
      )}

      {!isLoading && orders && orders.length > 0 && (
        <>
          <div className="hidden md:block bg-white dark:bg-slate-900 rounded-lg shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 dark:bg-slate-800 text-left">
                <tr>
                  <th className="p-3">OP</th>
                  <th className="p-3">Proceso</th>
                  <th className="p-3">Cliente</th>
                  <th className="p-3">Referencia</th>
                  <th className="p-3">Kg (prod. / plan.)</th>
                  <th className="p-3">Derivación</th>
                  <th className="p-3">Estado</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o: any) => (
                  <tr key={o.id} className="border-t hover:bg-slate-50 dark:hover:bg-slate-800">
                    <td className="p-3 font-medium">
                      <Link className="text-sky-700 dark:text-sky-400 hover:underline" to={`/produccion/ordenes/${o.id}`}>
                        {o.orderNumber}
                      </Link>
                    </td>
                    <td className="p-3">
                      <StationBadge station={o.station} />
                    </td>
                    <td className="p-3">{o.client?.name ?? "—"}</td>
                    <td className="p-3">{o.product.name}</td>
                    <td className="p-3">
                      {kilosProducidos(o)} / {Number(o.quantityPlanned)} {o.product.unit}
                    </td>
                    <td className="p-3 text-xs text-slate-500 dark:text-slate-400">
                      {o.parent && (
                        <span className="inline-flex items-center gap-1">
                          <GitBranch size={12} aria-hidden="true" /> de {o.parent.orderNumber}
                        </span>
                      )}
                      {o.derivedOrders?.length > 0 && (
                        <span className="block">→ {o.derivedOrders.map((d: any) => d.orderNumber).join(", ")}</span>
                      )}
                      {!o.parent && !o.derivedOrders?.length && "—"}
                    </td>
                    <td className="p-3">
                      <span className={`text-xs rounded-full px-2 py-1 ${STATUS_COLORS[o.status]}`}>{STATUS_LABELS[o.status]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden bg-white dark:bg-slate-900 rounded-lg shadow divide-y divide-slate-100 dark:divide-slate-700">
            {orders.map((o: any) => (
              <Link key={o.id} to={`/produccion/ordenes/${o.id}`} className="block p-4 space-y-2 hover:bg-slate-50 dark:hover:bg-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-slate-800 dark:text-slate-100">{o.orderNumber}</p>
                  <StationBadge station={o.station} />
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {o.product.name}
                  {o.client?.name ? ` · ${o.client.name}` : ""}
                </p>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500 dark:text-slate-400">
                    {kilosProducidos(o)} / {Number(o.quantityPlanned)} {o.product.unit}
                  </span>
                  <span className={`text-xs rounded-full px-2 py-1 ${STATUS_COLORS[o.status]}`}>{STATUS_LABELS[o.status]}</span>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
