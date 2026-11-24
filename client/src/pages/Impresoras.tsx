import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { Download, KeyRound, Plus, Printer } from "lucide-react";
import { api, type LabelPrinter } from "../api/client";
import { AGENT_INSTALLER_NAME, AGENT_SCRIPT_NAME, buildAgentScript, buildInstallerCmd, downloadText } from "../lib/printAgentScript";
import PrintOnPrinter from "../components/PrintOnPrinter";

const STATIONS: { value: string; label: string }[] = [
  { value: "extrusion", label: "Extrusión" },
  { value: "impresion", label: "Impresión" },
  { value: "sellado", label: "Sellado" },
  { value: "precorte", label: "Precorte" },
  { value: "embobinado", label: "Embobinado" },
];
const DEFAULT_WINDOWS_PRINTER = "SAT TT460 UE (203 dpi) (ZPL)";
const input = "border rounded px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";

function lastSeen(p: LabelPrinter): string {
  if (!p.lastSeenAt) return "el puente nunca se conectó";
  const s = Math.round((Date.now() - new Date(p.lastSeenAt).getTime()) / 1000);
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  return new Date(p.lastSeenAt).toLocaleString();
}

/** Token recién generado: se muestra una sola vez, con las descargas del puente ya configuradas. */
function AgentDownload({ printer, token, onClose }: { printer: { id: number; name: string }; token: string; onClose: () => void }) {
  const [windowsName, setWindowsName] = useState(DEFAULT_WINDOWS_PRINTER);
  const server = window.location.origin;
  return (
    <div className="rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950 p-4 space-y-3 text-sm">
      <p className="font-medium text-emerald-900 dark:text-emerald-200">Instalar el puente de impresión de «{printer.name}»</p>
      <p className="text-emerald-900 dark:text-emerald-200">
        Hacelo en el PC donde está conectada la impresora (tiene que quedar prendido). Este archivo lleva la clave de esta impresora: se muestra
        solo ahora. Si se pierde, generá una nueva.
      </p>
      <label className="block">
        <span className="text-slate-700 dark:text-slate-200">Nombre de la impresora en Windows (Panel de control → Impresoras)</span>
        <input className={`${input} w-full mt-1`} value={windowsName} onChange={(e) => setWindowsName(e.target.value)} />
      </label>
      <ol className="list-decimal pl-5 space-y-1 text-slate-700 dark:text-slate-200">
        <li>
          Creá la carpeta <code>C:\PuenteImpresion</code> y descargá ahí los dos archivos:
          <div className="flex flex-wrap gap-2 mt-1">
            <button
              type="button"
              onClick={() => downloadText(AGENT_SCRIPT_NAME, buildAgentScript({ server, token, printerName: windowsName.trim() || DEFAULT_WINDOWS_PRINTER }), { bom: true })}
              className="inline-flex items-center gap-1.5 bg-slate-800 text-white rounded px-3 py-1.5"
            >
              <Download size={14} aria-hidden="true" /> {AGENT_SCRIPT_NAME}
            </button>
            <button
              type="button"
              onClick={() => downloadText(AGENT_INSTALLER_NAME, buildInstallerCmd())}
              className="inline-flex items-center gap-1.5 bg-slate-800 text-white rounded px-3 py-1.5"
            >
              <Download size={14} aria-hidden="true" /> {AGENT_INSTALLER_NAME}
            </button>
          </div>
        </li>
        <li>
          Doble clic en <code>{AGENT_INSTALLER_NAME}</code> y aceptá el permiso de administrador. Queda corriendo y arranca solo al prender el PC.
        </li>
        <li>En unos segundos esta impresora aparece «en línea». Probala con «Imprimir prueba».</li>
      </ol>
      <button type="button" onClick={onClose} className="text-sky-700 dark:text-sky-400 hover:underline">
        Listo, ya lo descargué
      </button>
    </div>
  );
}

/**
 * Configuración → Impresoras (Gestión): impresoras de etiquetas de planta y
 * su puente de impresión, para imprimir desde los celulares (pedido del
 * cliente 2026-11-24).
 */
export default function Impresoras() {
  const queryClient = useQueryClient();
  const { data: printers, isLoading } = useQuery({ queryKey: ["printersAdmin"], queryFn: api.getPrintersAdmin, refetchInterval: 5000 });
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "SAT TT460", width: "100", height: "75", stations: [] as string[] });
  const [error, setError] = useState<string | null>(null);
  const [newToken, setNewToken] = useState<{ printer: { id: number; name: string }; token: string } | null>(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["printersAdmin"] });
    queryClient.invalidateQueries({ queryKey: ["printers"] });
  };

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const p = await api.createPrinter({
        name: form.name.trim(),
        labelWidthMm: Number(form.width),
        labelHeightMm: Number(form.height),
        stations: form.stations,
      });
      setNewToken({ printer: p, token: p.agentToken });
      setCreating(false);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la impresora");
    }
  }

  async function rotate(p: LabelPrinter) {
    if (!window.confirm(`¿Generar una clave nueva para «${p.name}»? El puente instalado deja de funcionar hasta que se reinstale con la nueva.`)) return;
    const { agentToken } = await api.rotatePrinterToken(p.id);
    setNewToken({ printer: p, token: agentToken });
    refresh();
  }

  async function toggle(p: LabelPrinter) {
    await api.updatePrinter(p.id, { active: !p.active });
    refresh();
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Impresoras de etiquetas</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Para imprimir las etiquetas desde los celulares: el celular pide la etiqueta y el puente de impresión, instalado en el PC donde está
            conectada la impresora, la imprime.
          </p>
        </div>
        {!creating && (
          <button type="button" onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 bg-slate-800 text-white text-sm rounded px-3 py-2">
            <Plus size={14} aria-hidden="true" /> Agregar impresora
          </button>
        )}
      </div>

      {newToken && <AgentDownload printer={newToken.printer} token={newToken.token} onClose={() => setNewToken(null)} />}

      {creating && (
        <form onSubmit={create} className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 space-y-3 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block sm:col-span-3">
              <span className="text-slate-600 dark:text-slate-300">Nombre (como la van a ver en el celular)</span>
              <input className={`${input} w-full mt-1`} required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-slate-600 dark:text-slate-300">Ancho de la etiqueta (mm)</span>
              <input className={`${input} w-full mt-1`} type="number" min={20} max={108} required value={form.width} onChange={(e) => setForm({ ...form, width: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-slate-600 dark:text-slate-300">Largo de la etiqueta (mm)</span>
              <input className={`${input} w-full mt-1`} type="number" min={20} max={300} required value={form.height} onChange={(e) => setForm({ ...form, height: e.target.value })} />
            </label>
          </div>
          <fieldset>
            <legend className="text-slate-600 dark:text-slate-300">Estaciones que imprimen acá por defecto (ninguna = todas)</legend>
            <div className="flex flex-wrap gap-3 mt-1">
              {STATIONS.map((s) => (
                <label key={s.value} className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={form.stations.includes(s.value)}
                    onChange={(e) =>
                      setForm({ ...form, stations: e.target.checked ? [...form.stations, s.value] : form.stations.filter((x) => x !== s.value) })
                    }
                  />
                  {s.label}
                </label>
              ))}
            </div>
          </fieldset>
          {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" className="bg-slate-800 text-white rounded px-4 py-2">
              Crear impresora
            </button>
            <button type="button" onClick={() => setCreating(false)} className="px-3 py-2 text-slate-600 dark:text-slate-300">
              Cancelar
            </button>
          </div>
        </form>
      )}

      {isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
      {printers && printers.length === 0 && !creating && (
        <p className="text-sm text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 rounded-lg shadow p-4">
          Todavía no hay impresoras. Agregá la SAT TT460 (etiqueta de 100 × 75 mm) para empezar.
        </p>
      )}

      {printers?.map((p) => (
        <section key={p.id} className={`bg-white dark:bg-slate-900 rounded-lg shadow p-4 space-y-3 ${p.active ? "" : "opacity-60"}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-medium text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <Printer size={16} aria-hidden="true" /> {p.name}
                <span className={`text-xs font-normal ${p.online ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>
                  {p.online ? "● en línea" : "● fuera de línea"}
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Etiqueta {p.labelWidthMm} × {p.labelHeightMm} mm ·{" "}
                {p.stations.length ? STATIONS.filter((s) => p.stations.includes(s.value)).map((s) => s.label).join(", ") : "todas las estaciones"} ·
                puente: {lastSeen(p)}
                {p.agentInfo ? ` (${p.agentInfo})` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              <button type="button" onClick={() => rotate(p)} className="inline-flex items-center gap-1 text-sky-700 dark:text-sky-400 hover:underline">
                <KeyRound size={13} aria-hidden="true" /> Instalar puente / clave nueva
              </button>
              <button type="button" onClick={() => toggle(p)} className="text-slate-600 dark:text-slate-300 hover:underline">
                {p.active ? "Desactivar" : "Activar"}
              </button>
            </div>
          </div>
          {p.active && <PrintOnPrinter printerId={p.id} testStation="precorte" label="Imprimir prueba" />}
          {p.jobs.length > 0 && (
            <ul className="text-xs divide-y divide-slate-100 dark:divide-slate-700 border border-slate-100 dark:border-slate-800 rounded">
              {p.jobs.map((j) => (
                <li key={j.id} className="px-3 py-1.5 flex flex-wrap justify-between gap-2">
                  <span className="text-slate-700 dark:text-slate-200">
                    {j.description} · {j.createdByName ?? "—"} · {j.createdAt ? new Date(j.createdAt).toLocaleString() : ""}
                  </span>
                  <span
                    className={
                      j.status === "impreso"
                        ? "text-emerald-700 dark:text-emerald-400"
                        : j.status === "error"
                          ? "text-red-600 dark:text-red-400"
                          : "text-slate-500"
                    }
                  >
                    {j.status === "impreso" ? "impresa" : j.status === "error" ? `error: ${j.error}` : j.status === "enviado" ? "en la impresora…" : "en cola"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
