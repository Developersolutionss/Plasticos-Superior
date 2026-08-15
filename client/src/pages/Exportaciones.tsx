import { useState } from "react";
import { Download } from "lucide-react";
import { api } from "../api/client";

const EXPORTS: { resource: "inventario" | "pedidos" | "facturas" | "clientes"; label: string; description: string }[] = [
  { resource: "inventario", label: "Inventario", description: "Stock actual por producto, categoría y mínimo" },
  { resource: "pedidos", label: "Pedidos", description: "Pedidos con cliente, estado y total de la versión vigente" },
  { resource: "facturas", label: "Facturas", description: "Facturas con total, pagado y saldo pendiente" },
  { resource: "clientes", label: "Clientes", description: "Clientes activos con límite de crédito y cartera" },
];

export default function Exportaciones() {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload(resource: (typeof EXPORTS)[number]["resource"]) {
    setError(null);
    setDownloadingId(resource);
    try {
      await api.downloadExport(resource);
    } catch {
      setError("No se pudo generar el archivo");
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Exportaciones</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Descargá los datos del sistema en Excel</p>
      </div>

      {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm divide-y divide-slate-100 dark:divide-slate-700">
        {EXPORTS.map((e) => (
          <div key={e.resource} className="flex items-center justify-between gap-3 px-5 py-4">
            <div>
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{e.label}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{e.description}</p>
            </div>
            <button
              type="button"
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium px-3 py-2 rounded-md transition-colors disabled:opacity-50 shrink-0"
              disabled={downloadingId === e.resource}
              onClick={() => handleDownload(e.resource)}
            >
              <Download size={14} strokeWidth={2} aria-hidden="true" />
              {downloadingId === e.resource ? "Generando..." : "Exportar"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
