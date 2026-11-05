import { useState } from "react";
import { Download } from "lucide-react";
import { api, ApiError, type ExportResource } from "../api/client";

interface ExportDef {
  resource: ExportResource;
  label: string;
  description: string;
  /** Si el filtro "desde/hasta" aplica (los de estado actual, como el stock, no tienen fecha). */
  dated: boolean;
}

const GROUPS: { title: string; exports: ExportDef[] }[] = [
  {
    title: "Producción",
    exports: [
      { resource: "ordenes-produccion", label: "Órdenes de producción", description: "OPs con estación, estado, cliente, kilos producidos, merma y rollos", dated: true },
      { resource: "rollos", label: "Rollos", description: "Rollos registrados con OP, operario, turno, máquina, peso y rollo de origen", dated: true },
      { resource: "despachos-bodegas", label: "Despachos a bodegas", description: "Rollos enviados entre bodegas: desde, hacia, kilos enviados y recibidos", dated: true },
      { resource: "materia-prima", label: "Materia prima", description: "Compras, consumo en producción y ajustes de materia prima", dated: true },
    ],
  },
  {
    title: "Inventario",
    exports: [
      { resource: "inventario", label: "Inventario", description: "Stock actual por producto, categoría y mínimo", dated: false },
      { resource: "movimientos", label: "Movimientos de inventario", description: "Entradas, despachos, ajustes (con su motivo) y devoluciones", dated: true },
    ],
  },
  {
    title: "Ventas",
    exports: [
      { resource: "pedidos", label: "Pedidos", description: "Pedidos con cliente, estado y total de la versión vigente", dated: true },
      { resource: "facturas", label: "Facturas", description: "Facturas con total, pagado y saldo pendiente", dated: true },
      { resource: "clientes", label: "Clientes", description: "Clientes activos con límite de crédito y cartera", dated: false },
    ],
  },
];

export default function Exportaciones() {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  async function handleDownload(e: ExportDef) {
    setError(null);
    setDownloadingId(e.resource);
    try {
      await api.downloadExport(e.resource, e.dated ? { desde, hasta } : {});
    } catch (err) {
      setError(err instanceof ApiError && err.message ? `No se pudo generar el archivo: ${err.message}` : "No se pudo generar el archivo");
    } finally {
      setDownloadingId(null);
    }
  }

  const inputClass = "border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm dark:bg-slate-800 dark:text-slate-100";

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Exportaciones</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Descargá los datos del sistema en Excel</p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm px-5 py-4 space-y-2">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Rango de fechas (opcional)</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-500 dark:text-slate-400">
            Desde
            <input type="date" className={`${inputClass} block mt-1`} value={desde} onChange={(e) => setDesde(e.target.value)} />
          </label>
          <label className="text-xs text-slate-500 dark:text-slate-400">
            Hasta
            <input type="date" className={`${inputClass} block mt-1`} value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </label>
          {(desde || hasta) && (
            <button
              type="button"
              className="text-sm px-3 py-2 rounded border dark:border-slate-600"
              onClick={() => {
                setDesde("");
                setHasta("");
              }}
            >
              Quitar fechas
            </button>
          )}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">Sin fechas se exporta todo. Inventario y Clientes son siempre el estado de hoy.</p>
      </div>

      {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}

      {GROUPS.map((g) => (
        <section key={g.title} className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-300">{g.title}</h2>
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm divide-y divide-slate-100 dark:divide-slate-700">
            {g.exports.map((e) => (
              <div key={e.resource} className="flex items-center justify-between gap-3 px-5 py-4">
                <div>
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{e.label}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{e.description}</p>
                </div>
                <button
                  type="button"
                  aria-label={`Exportar ${e.label}`}
                  className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium px-3 py-2 rounded-md transition-colors disabled:opacity-50 shrink-0"
                  disabled={downloadingId === e.resource}
                  onClick={() => handleDownload(e)}
                >
                  <Download size={14} strokeWidth={2} aria-hidden="true" />
                  {downloadingId === e.resource ? "Generando..." : "Exportar"}
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
