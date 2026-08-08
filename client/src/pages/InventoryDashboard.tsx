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
      <div className="flex gap-2 overflow-x-auto">
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            onClick={() => setCategory(c.value)}
            className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap border ${
              category === c.value ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-700"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {alerts && alerts.length > 0 && (
        <div className="bg-amber-50 border border-amber-300 text-amber-800 rounded px-4 py-2 text-sm flex items-start gap-2">
          <TriangleAlert size={16} strokeWidth={2} className="flex-shrink-0 mt-0.5" />
          <span>
            {alerts.length} producto(s) bajo stock mínimo: {alerts.map((a: any) => a.name).join(", ")}
          </span>
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left">
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
            {isLoading && (
              <tr>
                <td colSpan={6} className="p-4 text-center text-slate-500">
                  Cargando...
                </td>
              </tr>
            )}
            {stock?.map((p: any) => (
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
                    <span className="text-amber-700 font-medium">Bajo mínimo</span>
                  ) : (
                    <span className="text-emerald-700">OK</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
