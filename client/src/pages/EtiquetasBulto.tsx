import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { Printer, Tag } from "lucide-react";
import { api } from "../api/client";

/** Mismo patrón que printLabels en Productos.tsx: ventana nueva
 * autocontenida con su propio @media print, esperando a que los QR (data:
 * URI) terminen de decodificar antes de imprimir. */
function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function printBultoLabels(labels: { code: string; qrDataUrl: string }[]) {
  const win = window.open("", "_blank");
  if (!win) return;

  const cards = labels
    .map((l) => {
      const code = escapeHtml(l.code);
      return `
        <div class="label">
          <img src="${l.qrDataUrl}" alt="QR ${code}" />
          <p class="code">${code}</p>
        </div>`;
    })
    .join("");

  win.document.write(`<!DOCTYPE html>
    <html>
      <head>
        <title>Etiquetas de bulto</title>
        <style>
          * { box-sizing: border-box; }
          body { font-family: sans-serif; margin: 0; padding: 8mm; }
          .grid { display: flex; flex-wrap: wrap; gap: 4mm; }
          .label {
            width: 4.2cm; height: 5cm;
            border: 1px dashed #999; border-radius: 3mm;
            padding: 3mm; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2mm;
            page-break-inside: avoid;
          }
          .label img { width: 3cm; height: 3cm; }
          .label .code { font-weight: bold; font-size: 10pt; margin: 0; text-align: center; overflow-wrap: anywhere; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="grid">${cards}</div>
      </body>
    </html>`);
  win.document.close();

  let printed = false;
  const doPrint = () => {
    if (printed) return;
    printed = true;
    win.focus();
    win.print();
  };
  win.onload = doPrint;
  setTimeout(doPrint, 400);
}

const STATUS_LABELS: Record<string, string> = { disponible: "Disponible", usada: "Usada" };
const STATUS_COLORS: Record<string, string> = {
  disponible: "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400",
  usada: "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400",
};

export default function EtiquetasBulto() {
  const [count, setCount] = useState("20");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const queryClient = useQueryClient();

  const { data: labels, isLoading } = useQuery({
    queryKey: ["bultoLabels", status],
    queryFn: () => api.getBultoLabels(status || undefined),
  });

  async function handleGenerate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const n = Number(count);
    if (!n || n < 1) return;
    setGenerating(true);
    try {
      await api.generateBultoLabels(n);
      queryClient.invalidateQueries({ queryKey: ["bultoLabels"] });
    } catch {
      setError("No se pudieron generar las etiquetas");
    } finally {
      setGenerating(false);
    }
  }

  async function handlePrintAvailable() {
    setError(null);
    try {
      const available = await api.getBultoLabels("disponible");
      if (available.length === 0) {
        setError("No hay etiquetas disponibles para imprimir");
        return;
      }
      const withQr = await Promise.all(available.map((l: any) => api.getBultoLabelQr(l.id)));
      printBultoLabels(withQr);
    } catch {
      setError("No se pudo generar la hoja de impresión");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Etiquetas de bulto</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Generá un lote, imprimilas y repartilas a los operarios de Sellado/Precorte — al escanear una, se completa sola la columna E.
          BULTO y queda marcada como usada, sin que nadie tenga que tipear el número.
        </p>
      </div>

      <form onSubmit={handleGenerate} className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Cantidad a generar</label>
          <input
            className="border rounded px-3 py-2 text-sm w-32 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            type="number"
            min={1}
            max={500}
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
        </div>
        <button className="bg-slate-800 text-white text-sm px-4 py-2 rounded disabled:opacity-50" type="submit" disabled={generating}>
          {generating ? "Generando..." : "Generar etiquetas"}
        </button>
        <button
          type="button"
          onClick={handlePrintAvailable}
          className="inline-flex items-center gap-1.5 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-sm px-4 py-2 rounded hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <Printer size={14} aria-hidden="true" /> Imprimir todas las disponibles
        </button>
        {error && <p className="text-red-600 dark:text-red-400 text-sm w-full">{error}</p>}
      </form>

      <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4">
        <select
          className="border rounded px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Todas</option>
          <option value="disponible">Disponibles</option>
          <option value="usada">Usadas</option>
        </select>
      </div>

      {isLoading && <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 text-center text-slate-500 dark:text-slate-400 text-sm">Cargando...</div>}

      {!isLoading && labels && labels.length > 0 && (
        <>
          <div className="hidden md:block bg-white dark:bg-slate-900 rounded-lg shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 dark:bg-slate-800 text-left">
                <tr>
                  <th className="p-3">Código</th>
                  <th className="p-3">Estado</th>
                  <th className="p-3">Usada por</th>
                  <th className="p-3">OP</th>
                  <th className="p-3">Fecha de uso</th>
                </tr>
              </thead>
              <tbody>
                {labels.map((l: any) => (
                  <tr key={l.id} className="border-t">
                    <td className="p-3 font-medium flex items-center gap-1.5">
                      <Tag size={13} className="text-slate-400" aria-hidden="true" /> {l.code}
                    </td>
                    <td className="p-3">
                      <span className={`text-xs rounded-full px-2 py-1 ${STATUS_COLORS[l.status]}`}>{STATUS_LABELS[l.status] ?? l.status}</span>
                    </td>
                    <td className="p-3">{l.usedBy?.name ?? "—"}</td>
                    <td className="p-3">{l.usedByRoll?.productionOrder?.orderNumber ?? "—"}</td>
                    <td className="p-3">{l.usedAt ? new Date(l.usedAt).toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden bg-white dark:bg-slate-900 rounded-lg shadow divide-y divide-slate-100 dark:divide-slate-700">
            {labels.map((l: any) => (
              <div key={l.id} className="p-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                    <Tag size={13} className="text-slate-400" aria-hidden="true" /> {l.code}
                  </p>
                  <span className={`text-xs rounded-full px-2 py-1 shrink-0 ${STATUS_COLORS[l.status]}`}>{STATUS_LABELS[l.status] ?? l.status}</span>
                </div>
                {l.status === "usada" && (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {l.usedBy?.name ?? "—"} · OP {l.usedByRoll?.productionOrder?.orderNumber ?? "—"} ·{" "}
                    {l.usedAt ? new Date(l.usedAt).toLocaleString() : "—"}
                  </p>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {!isLoading && labels && labels.length === 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 text-center text-slate-500 dark:text-slate-400 text-sm">
          Todavía no hay etiquetas generadas.
        </div>
      )}
    </div>
  );
}
