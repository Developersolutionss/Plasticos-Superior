import { useQueryClient } from "@tanstack/react-query";
import { ChangeEvent, useState } from "react";
import { api } from "../api/client";

export default function ProductionUpload() {
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.previewImport>> | null>(null);
  const [result, setResult] = useState<{ processed: number; failed: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setResult(null);
    try {
      const data = await api.previewImport(file);
      setPreview(data);
    } finally {
      setLoading(false);
    }
  }

  async function confirmImport() {
    if (!preview) return;
    setLoading(true);
    try {
      const res = await api.confirmImport(preview.filename, preview.rows);
      setResult(res);
      setPreview(null);
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="bg-white rounded-lg shadow p-6 border-2 border-dashed border-slate-300 text-center">
        <p className="text-slate-600 mb-3">
          Sube el reporte de producción (Excel/CSV) con columnas: SKU, Etiqueta, Operario, Cliente, Medida, Kilos,
          Conductor, Observaciones.
        </p>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} />
      </div>

      {loading && <p className="text-slate-500">Procesando...</p>}

      {preview && (
        <div className="bg-white rounded-lg shadow p-4 space-y-3">
          <p className="text-sm text-slate-600">
            {preview.filename}: {preview.totalRows} filas · {preview.validRows} válidas · {preview.invalidRows} con
            error
          </p>
          <div className="hidden sm:block overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-100 text-left">
                <tr>
                  <th className="p-2">Fila</th>
                  <th className="p-2">SKU</th>
                  <th className="p-2">Operario</th>
                  <th className="p-2">Cliente</th>
                  <th className="p-2">Kilos</th>
                  <th className="p-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.rowNumber} className={`border-t ${r.error ? "bg-red-50" : ""}`}>
                    <td className="p-2">{r.rowNumber}</td>
                    <td className="p-2">{r.sku}</td>
                    <td className="p-2">{r.operatorName}</td>
                    <td className="p-2">{r.clientName ?? "-"}</td>
                    <td className="p-2">{r.kilos}</td>
                    <td className="p-2 text-red-600">{r.error ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="sm:hidden max-h-80 overflow-y-auto divide-y border rounded">
            {preview.rows.map((r) => (
              <div key={r.rowNumber} className={`p-2.5 text-xs space-y-0.5 ${r.error ? "bg-red-50" : ""}`}>
                <div className="flex items-center justify-between">
                  <p className="font-medium">
                    Fila {r.rowNumber} — {r.sku}
                  </p>
                  <p>{r.kilos} kg</p>
                </div>
                <p className="text-slate-500">
                  {r.operatorName} · {r.clientName ?? "-"}
                </p>
                {r.error && <p className="text-red-600">{r.error}</p>}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              disabled={preview.validRows === 0}
              onClick={confirmImport}
              className="bg-slate-800 text-white px-4 py-2 rounded disabled:opacity-50"
            >
              Confirmar importación ({preview.validRows} filas)
            </button>
            <button onClick={() => setPreview(null)} className="px-4 py-2 rounded border">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="bg-emerald-50 border border-emerald-300 text-emerald-800 rounded px-4 py-3 text-sm">
          Importación completada: {result.processed} entradas creadas, {result.failed} filas fallidas.
        </div>
      )}
    </div>
  );
}
