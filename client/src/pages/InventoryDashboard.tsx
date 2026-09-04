import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { api } from "../api/client";

const CATEGORIES = [
  { value: "", label: "Todos" },
  { value: "bultos", label: "Bultos" },
  { value: "rollos_prec_lam", label: "Rollos Prec y Lam" },
  { value: "rollos_fuelle", label: "Rollos Fuelle" },
  { value: "mangueta", label: "Mangueta" },
  { value: "tiras", label: "Tiras" },
  { value: "control_impresion", label: "Control Impresión" },
];

export default function InventoryDashboard() {
  const [category, setCategory] = useState("");

  const { data: alerts } = useQuery({ queryKey: ["alerts"], queryFn: api.getAlerts });
  const { data: stock, isLoading } = useQuery({
    queryKey: ["inventory", category],
    queryFn: () => api.getInventory(category || undefined),
  });

  return (
    <div className="space-y-4">
      <div className="hidden md:flex gap-2 overflow-x-auto">
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            onClick={() => setCategory(c.value)}
            className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap border ${
              category === c.value ? "bg-slate-800 text-white border-slate-800" : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* En escritorio las píldoras se ven y caben bien, pero en celular una
          fila horizontal con scroll se siente "de página web" — un select
          nativo es el patrón mobile-friendly que ya usa el resto de la app
          (ej. filtro de estado en Etiquetas de bulto). */}
      <select
        className="md:hidden w-full border rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
      >
        {CATEGORIES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>

      {alerts && alerts.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950 border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 rounded px-4 py-2 text-sm flex items-start gap-2">
          <TriangleAlert size={16} strokeWidth={2} className="flex-shrink-0 mt-0.5" />
          <span>
            {alerts.length} producto(s) bajo stock mínimo: {alerts.map((a: any) => a.name).join(", ")}
          </span>
        </div>
      )}

      {isLoading && <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 text-center text-slate-500 dark:text-slate-400 text-sm">Cargando...</div>}

      {!isLoading && stock && (
        <>
          <div className="hidden md:block bg-white dark:bg-slate-900 rounded-lg shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 dark:bg-slate-800 text-left">
                <tr>
                  <th className="p-3">SKU</th>
                  <th className="p-3">Producto</th>
                  <th className="p-3">Medida</th>
                  <th className="p-3">Stock actual</th>
                  <th className="p-3">Mínimo</th>
                  <th className="p-3">Estado</th>
                </tr>
              </thead>
              <tbody>
                {stock.map((p: any) => (
                  <tr key={p.id} className="border-t">
                    <td className="p-3">{p.sku}</td>
                    <td className="p-3">{p.name}</td>
                    <td className="p-3">{p.measure ?? "-"}</td>
                    <td className="p-3">
                      {p.currentStock} {p.unit}
                    </td>
                    <td className="p-3">{p.minStock}</td>
                    <td className="p-3">
                      {p.belowMinimum ? (
                        <span className="text-amber-700 dark:text-amber-400 font-medium">Bajo mínimo</span>
                      ) : (
                        <span className="text-emerald-700 dark:text-emerald-400">OK</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden bg-white dark:bg-slate-900 rounded-lg shadow divide-y divide-slate-100 dark:divide-slate-700">
            {stock.map((p: any) => (
              <div key={p.id} className="p-4 space-y-1">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-slate-800 dark:text-slate-100">
                    {p.name} <span className="text-slate-400 dark:text-slate-400 font-normal">({p.sku})</span>
                  </p>
                  {p.belowMinimum ? (
                    <span className="text-amber-700 dark:text-amber-400 font-medium text-xs shrink-0">Bajo mínimo</span>
                  ) : (
                    <span className="text-emerald-700 dark:text-emerald-400 text-xs shrink-0">OK</span>
                  )}
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {p.measure ?? "-"} · Stock: {p.currentStock} {p.unit} · Mínimo: {p.minStock}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
