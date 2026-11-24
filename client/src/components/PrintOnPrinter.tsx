import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Printer, XCircle } from "lucide-react";
import { api, type LabelPrinter, type PrintJob } from "../api/client";

const LAST_PRINTER_KEY = "lastLabelPrinterId";

function rememberedPrinterId(): number | null {
  try {
    const v = Number(localStorage.getItem(LAST_PRINTER_KEY));
    return Number.isInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function rememberPrinter(id: number) {
  try {
    localStorage.setItem(LAST_PRINTER_KEY, String(id));
  } catch {
    // Sin almacenamiento: la próxima vez se vuelve a elegir sola.
  }
}

/** La impresora por defecto: la última usada en este celular, o la de la estación, o la primera en línea. */
export function defaultPrinter(printers: LabelPrinter[], station?: string | null): LabelPrinter | undefined {
  const last = rememberedPrinterId();
  return (
    printers.find((p) => p.id === last) ??
    (station ? printers.find((p) => p.stations.includes(station)) : undefined) ??
    printers.find((p) => p.stations.length === 0) ??
    printers.find((p) => p.online) ??
    printers[0]
  );
}

const DONE = new Set(["impreso", "error"]);

/**
 * "Imprimir en la impresora de planta" (pedido del cliente 2026-11-24:
 * imprimir desde los celulares): manda las etiquetas a la cola del servidor,
 * que el puente de impresión del PC de planta recoge y manda a la impresora.
 * Muestra el estado de cada etiqueta hasta que sale (o falla).
 *
 * `rolls` son los rollos con el token de posesión que vino al crearlos;
 * `testStation` imprime la etiqueta de muestra de esa estación.
 */
export default function PrintOnPrinter({
  rolls,
  testStation,
  station,
  label,
  printerId: fixedPrinterId,
}: {
  rolls?: { rollId: number; token: string }[];
  testStation?: string;
  station?: string | null;
  label?: string;
  /** Imprimir siempre en esta impresora (sin elegir). */
  printerId?: number;
}) {
  const { data: printers } = useQuery({ queryKey: ["printers"], queryFn: api.getPrinters, refetchInterval: 15_000 });
  const [printerId, setPrinterId] = useState<number | null>(null);
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  /** Pasó el tiempo de espera sin que el puente terminara: se avisa y se puede reintentar. */
  const [timedOut, setTimedOut] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const list = printers ?? [];
  const printer = fixedPrinterId ? list.find((p) => p.id === fixedPrinterId) : list.find((p) => p.id === printerId) ?? defaultPrinter(list, station);

  // Mientras haya etiquetas sin terminar, se consulta su estado (hasta 2 min).
  useEffect(() => {
    const open = jobs.filter((j) => !DONE.has(j.status));
    if (open.length === 0) return;
    const started = Date.now();
    pollRef.current = setInterval(async () => {
      try {
        const fresh = await api.getPrintJobs(open.map((j) => j.id));
        setJobs((prev) => prev.map((j) => fresh.find((f) => f.id === j.id) ?? j));
      } catch {
        // Sin señal un momento: se reintenta en el próximo tic.
      }
      if (Date.now() - started > 120_000) {
        if (pollRef.current) clearInterval(pollRef.current);
        setTimedOut(true);
      }
    }, 1500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // Solo cuando cambia el conjunto de trabajos abiertos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.map((j) => `${j.id}:${j.status}`).join(",")]);

  if (list.length === 0) return null;

  async function send() {
    if (!printer) return;
    setError(null);
    setTimedOut(false);
    setSending(true);
    try {
      const res = testStation
        ? await api.printTestLabelOn(printer.id, testStation)
        : await api.printRollLabelsOn(printer.id, rolls ?? []);
      if (!fixedPrinterId) rememberPrinter(printer.id);
      setJobs(res.jobs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo mandar a imprimir");
    } finally {
      setSending(false);
    }
  }

  const done = jobs.filter((j) => j.status === "impreso").length;
  const failed = jobs.filter((j) => j.status === "error");
  const waiting = jobs.length > 0 && done + failed.length < jobs.length && !timedOut;
  const count = testStation ? 1 : rolls?.length ?? 0;

  return (
    <div className="inline-flex flex-col gap-1">
      <div className="inline-flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={send}
          disabled={sending || waiting || !printer || count === 0}
          className="inline-flex items-center gap-1.5 text-sm bg-sky-700 hover:bg-sky-600 text-white rounded px-3 py-1.5 disabled:opacity-50"
        >
          <Printer size={14} aria-hidden="true" />
          {label ?? (count > 1 ? `Imprimir ${count} en ${printer?.name}` : `Imprimir en ${printer?.name}`)}
        </button>
        {list.length > 1 && !fixedPrinterId && (
          <select
            aria-label="Impresora"
            className="text-sm border rounded px-2 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            value={printer?.id ?? ""}
            onChange={(e) => setPrinterId(Number(e.target.value))}
          >
            {list.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.online ? "" : " (fuera de línea)"}
              </option>
            ))}
          </select>
        )}
        {printer && (
          <span className={`text-xs ${printer.online ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>
            {printer.online ? "● en línea" : "● fuera de línea (¿PC de la impresora apagado?)"}
          </span>
        )}
      </div>
      {timedOut && done + failed.length < jobs.length && (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
          Sin respuesta de la impresora ({done} de {jobs.length} impresas): revisá que el PC de la impresora esté prendido y volvé a intentar.
        </p>
      )}
      {jobs.length > 0 && !timedOut && (
        <p role="status" className="text-xs inline-flex items-center gap-1 text-slate-600 dark:text-slate-300">
          {waiting ? (
            <>
              <Loader2 size={12} className="animate-spin" aria-hidden="true" /> Imprimiendo… {done} de {jobs.length}
            </>
          ) : failed.length === 0 ? (
            <>
              <CheckCircle2 size={12} className="text-emerald-600" aria-hidden="true" /> {jobs.length === 1 ? "Impresa" : `${done} impresas`}
            </>
          ) : (
            <>
              <XCircle size={12} className="text-red-600" aria-hidden="true" /> {failed.length} no se {failed.length === 1 ? "imprimió" : "imprimieron"}:{" "}
              {failed[0].error}
            </>
          )}
        </p>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
