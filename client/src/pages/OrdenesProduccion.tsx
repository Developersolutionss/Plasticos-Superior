import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { CircleCheck, Circle } from "lucide-react";
import { api } from "../api/client";

const STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  en_proceso: "En proceso",
  pendiente_calidad: "Pendiente de calidad",
  detenida: "Detenida",
  finalizada: "Finalizada",
  cancelada: "Cancelada",
};

const STATUS_COLORS: Record<string, string> = {
  pendiente: "bg-slate-100 text-slate-700",
  en_proceso: "bg-sky-100 text-sky-700",
  pendiente_calidad: "bg-purple-100 text-purple-700",
  detenida: "bg-amber-100 text-amber-700",
  finalizada: "bg-emerald-100 text-emerald-700",
  cancelada: "bg-red-100 text-red-700",
};

const STATIONS = [
  { value: "extrusion", label: "Extrusión" },
  { value: "impresion", label: "Impresión" },
  { value: "sellado", label: "Sellado" },
  { value: "precorte", label: "Precorte" },
];

function StationsCompleted({ order }: { order: any }) {
  const done = new Set((order.stages ?? []).map((s: any) => s.station));
  return (
    <span className="inline-flex gap-1 align-middle">
      {STATIONS.map((s) =>
        done.has(s.value) ? (
          <CircleCheck key={s.value} size={16} strokeWidth={2} className="text-emerald-600" />
        ) : (
          <Circle key={s.value} size={16} strokeWidth={2} className="text-slate-300" />
        )
      )}
    </span>
  );
}

export default function OrdenesProduccion() {
  const [productId, setProductId] = useState("");
  const [quantityPlanned, setQuantityPlanned] = useState("");
  const [measure, setMeasure] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: products } = useQuery({ queryKey: ["products"], queryFn: api.getProducts });
  const { data: orders, isLoading } = useQuery({ queryKey: ["productionOrders"], queryFn: () => api.getProductionOrders() });

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!productId || !quantityPlanned) return;
    try {
      await api.createProductionOrder({
        productId: Number(productId),
        quantityPlanned: Number(quantityPlanned),
        measure: measure || undefined,
        notes: notes || undefined,
      });
      setProductId("");
      setQuantityPlanned("");
      setMeasure("");
      setNotes("");
      queryClient.invalidateQueries({ queryKey: ["productionOrders"] });
    } catch {
      setError("No se pudo crear la OP");
    }
  }

  async function handleStatusChange(id: number, status: string) {
    await api.updateProductionOrderStatus(id, status);
    queryClient.invalidateQueries({ queryKey: ["productionOrders"] });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleCreate} className="bg-white rounded-lg shadow p-4 space-y-3">
        <p className="text-sm font-medium text-slate-700">Nueva orden de producción</p>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
          <select className="border rounded px-3 py-2 text-sm" value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Producto...</option>
            {products?.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.sku})
              </option>
            ))}
          </select>
          <input
            className="border rounded px-3 py-2 text-sm"
            placeholder="Cantidad planificada (kg)"
            type="number"
            step="0.01"
            value={quantityPlanned}
            onChange={(e) => setQuantityPlanned(e.target.value)}
          />
          <input
            className="border rounded px-3 py-2 text-sm"
            placeholder="Medida (opcional)"
            value={measure}
            onChange={(e) => setMeasure(e.target.value)}
          />
          <input
            className="border rounded px-3 py-2 text-sm"
            placeholder="Notas (opcional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <button className="bg-slate-800 text-white text-sm px-4 py-2 rounded" type="submit">
          Crear OP
        </button>
      </form>

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left">
            <tr>
              <th className="p-3">OP</th>
              <th className="p-3">Producto</th>
              <th className="p-3">Cant. planificada</th>
              <th className="p-3">Avance</th>
              <th className="p-3">Estado</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-slate-500">
                  Cargando...
                </td>
              </tr>
            )}
            {orders?.map((o: any) => (
              <tr key={o.id} className="border-t">
                <td className="p-3 font-medium">{o.orderNumber}</td>
                <td className="p-3">{o.product.name}</td>
                <td className="p-3">
                  {o.quantityPlanned} {o.product.unit}
                </td>
                <td className="p-3" title="Extrusión · Impresión · Sellado · Precorte">
                  <StationsCompleted order={o} />
                </td>
                <td className="p-3">
                  <select
                    className={`text-xs rounded-full px-2 py-1 border-0 ${STATUS_COLORS[o.status]}`}
                    value={o.status}
                    onChange={(e) => handleStatusChange(o.id, e.target.value)}
                  >
                    {Object.entries(STATUS_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
            {orders?.length === 0 && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-slate-500">
                  Todavía no hay órdenes de producción.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
