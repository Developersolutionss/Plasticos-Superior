import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, ChevronDown, GitBranch } from "lucide-react";
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

/**
 * Todas las etapas de una misma cadena de derivación comparten orderNumber
 * (ver server/src/routes/productionOrders.ts, POST /:id/derive) — agrupamos
 * por ahí para mostrar una sola fila por OP en la lista, con las etapas
 * derivadas anidadas debajo al expandir. La "cabeza" de cada grupo es la fila
 * sin padre dentro de lo que llegó filtrado; si el filtro de proceso dejó
 * afuera a la raíz real, se usa la de menor id como cabeza de reemplazo.
 */
function buildChains(orders: any[]) {
  const groups = new Map<string, any[]>();
  for (const o of orders) {
    const key = o.orderNumber;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(o);
  }
  const chains: { orderNumber: string; head: any; children: any[] }[] = [];
  for (const [orderNumber, group] of groups) {
    const idsInGroup = new Set(group.map((o) => o.id));
    const head = group.find((o) => !o.parent || !idsInGroup.has(o.parent.id)) ?? group.reduce((a, b) => (a.id < b.id ? a : b));
    const children = group.filter((o) => o.id !== head.id).sort((a, b) => a.id - b.id);
    chains.push({ orderNumber, head, children });
  }
  chains.sort((a, b) => b.head.id - a.head.id);
  return chains;
}

function DerivationCell({ order }: { order: any }) {
  if (order.parent) {
    return (
      <span className="inline-flex items-center gap-1">
        <GitBranch size={12} aria-hidden="true" /> de {order.parent.orderNumber} ({STATION_LABELS[order.parent.station as OpStation] ?? order.parent.station})
      </span>
    );
  }
  if (order.derivedOrders?.length > 0) {
    return (
      <span className="block">
        → {order.derivedOrders.map((d: any) => `${STATION_LABELS[d.station as OpStation] ?? d.station}`).join(", ")}
      </span>
    );
  }
  return <>—</>;
}

function FragmentChain({
  orderNumber,
  head,
  children_,
  isExpanded,
  onToggle,
}: {
  orderNumber: string;
  head: any;
  children_: any[];
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-t hover:bg-slate-50 dark:hover:bg-slate-800">
        <td className="p-3 font-medium">
          <div className="flex items-center gap-1">
            {children_.length > 0 ? (
              <button
                type="button"
                onClick={onToggle}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                aria-label={isExpanded ? "Contraer etapas derivadas" : "Expandir etapas derivadas"}
              >
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            ) : (
              <span className="inline-block w-[14px]" />
            )}
            <Link className="text-sky-700 dark:text-sky-400 hover:underline" to={`/produccion/ordenes/${head.id}`}>
              {orderNumber}
            </Link>
          </div>
        </td>
        <td className="p-3">
          <StationBadge station={head.station} />
        </td>
        <td className="p-3">{head.client?.name ?? "—"}</td>
        <td className="p-3">{head.product.name}</td>
        <td className="p-3">
          {kilosProducidos(head)} / {Number(head.quantityPlanned)} {head.product.unit}
        </td>
        <td className="p-3 text-xs text-slate-500 dark:text-slate-400">
          <DerivationCell order={head} />
        </td>
        <td className="p-3">
          <span className={`text-xs rounded-full px-2 py-1 ${STATUS_COLORS[head.status]}`}>{STATUS_LABELS[head.status]}</span>
        </td>
      </tr>
      {isExpanded &&
        children_.map((c) => (
          <tr key={c.id} className="border-t bg-slate-50/60 dark:bg-slate-800/40 hover:bg-slate-50 dark:hover:bg-slate-800">
            <td className="p-3 pl-8 text-slate-500 dark:text-slate-400">
              <Link className="text-sky-700 dark:text-sky-400 hover:underline" to={`/produccion/ordenes/${c.id}`}>
                {orderNumber}
              </Link>
            </td>
            <td className="p-3">
              <StationBadge station={c.station} />
            </td>
            <td className="p-3">{c.client?.name ?? "—"}</td>
            <td className="p-3">{c.product.name}</td>
            <td className="p-3">
              {kilosProducidos(c)} / {Number(c.quantityPlanned)} {c.product.unit}
            </td>
            <td className="p-3 text-xs text-slate-500 dark:text-slate-400">
              <DerivationCell order={c} />
            </td>
            <td className="p-3">
              <span className={`text-xs rounded-full px-2 py-1 ${STATUS_COLORS[c.status]}`}>{STATUS_LABELS[c.status]}</span>
            </td>
          </tr>
        ))}
    </>
  );
}

export function StationBadge({ station }: { station: string | null }) {
  if (!station) {
    return (
      <span className="text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
        Sin proceso
      </span>
    );
  }
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
  const [quantityPlanned, setQuantityPlanned] = useState("");
  const [measure, setMeasure] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  function toggleExpanded(orderNumber: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(orderNumber)) next.delete(orderNumber);
      else next.add(orderNumber);
      return next;
    });
  }

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
        // Sin proceso todavía: se crea "en blanco" y se deriva a Extrusión
        // como primer paso explícito desde la hoja de la OP.
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
          La OP se crea sin proceso asignado; el primer paso es derivarla a Extrusión desde su hoja
        </p>
      </div>

      <form onSubmit={handleCreate} className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 space-y-3">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Nueva orden de producción</p>
        {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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
                {buildChains(orders).map(({ orderNumber, head, children }) => {
                  const isExpanded = expanded.has(orderNumber);
                  return (
                    <FragmentChain
                      key={orderNumber}
                      orderNumber={orderNumber}
                      head={head}
                      children_={children}
                      isExpanded={isExpanded}
                      onToggle={() => toggleExpanded(orderNumber)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="md:hidden bg-white dark:bg-slate-900 rounded-lg shadow divide-y divide-slate-100 dark:divide-slate-700">
            {buildChains(orders).map(({ orderNumber, head, children }) => {
              const isExpanded = expanded.has(orderNumber);
              const rows = [head, ...(isExpanded ? children : [])];
              return (
                <div key={orderNumber}>
                  {rows.map((o: any, i: number) => (
                    <div key={o.id} className={`flex items-stretch ${i > 0 ? "bg-slate-50/60 dark:bg-slate-800/40" : ""}`}>
                      {i === 0 && children.length > 0 && (
                        <button
                          type="button"
                          onClick={() => toggleExpanded(orderNumber)}
                          className="px-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                          aria-label={isExpanded ? "Contraer etapas derivadas" : "Expandir etapas derivadas"}
                        >
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      )}
                      <Link
                        to={`/produccion/ordenes/${o.id}`}
                        className={`flex-1 block p-4 space-y-2 hover:bg-slate-50 dark:hover:bg-slate-800 ${i === 0 && children.length === 0 ? "pl-4" : ""} ${i > 0 ? "pl-8" : ""}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium text-slate-800 dark:text-slate-100">{orderNumber}</p>
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
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
