import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { api } from "../api/client";
import PrintOnPrinter from "../components/PrintOnPrinter";
import {
  DEFAULT_PRINTER_SETTINGS,
  LABEL_FORMATS,
  PRINTER_MAX_WIDTH_MM,
  getPrinterSettings,
  labelSheet,
  printRollLabels,
  rollLabelsHtml,
  savePrinterSettings,
  type LabelStation,
  type PrinterSettings,
  type RollLabel,
} from "../lib/rollLabels";

const STATIONS: { station: LabelStation; name: string }[] = [
  { station: "sellado", name: "Bulto de Sellado" },
  { station: "precorte", name: "Rollo de Precorte" },
  { station: "impresion", name: "Rollo de Impresión" },
  { station: "extrusion", name: "Rollo de Extrusión" },
  { station: "embobinado", name: "Rollo de Embobinado" },
];

/** Datos de muestra (los de su etiqueta de papel), marcados como PRUEBA. */
function sampleLabel(station: LabelStation, qrDataUrl: string): RollLabel {
  return {
    station,
    code: "PRUEBA",
    qrDataUrl,
    orderNumber: "OP-PRUEBA",
    productName: "Bolsa basura",
    reference: "55x70 cm · cal 2.5",
    color: "Negro",
    weightKg: 12.5,
    date: new Date(),
    cantPaca: 50,
    clientName: "Cliente de prueba",
  };
}

const num = "border rounded px-2 py-1.5 text-sm w-24 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";

/** Corrimiento en mm: guarda el texto tal cual se escribe (para poder teclear
 * "-" o "1." sin que se convierta en 0 a mitad de camino) y solo aplica el
 * número cuando es válido; al salir del campo lo deja limpio. */
function OffsetInput({ label, value, onChange }: { label: string; value: number; onChange: (mm: number) => void }) {
  const [text, setText] = useState(String(value));
  const clamp = (n: number) => Math.max(-20, Math.min(20, n));
  return (
    <label className="flex items-center gap-2">
      {label}
      <input
        type="text"
        inputMode="decimal"
        className={num}
        value={text}
        onChange={(e) => {
          const raw = e.target.value.replace(",", ".");
          setText(raw);
          const n = Number(raw);
          if (raw.trim() !== "" && raw !== "-" && Number.isFinite(n)) onChange(clamp(n));
        }}
        onBlur={() => {
          const n = Number(text);
          const clean = Number.isFinite(n) ? clamp(n) : 0;
          setText(String(clean));
          onChange(clean);
        }}
      />
    </label>
  );
}

/**
 * Prueba de impresión de etiquetas (impresora SAT TT460 UE): imprime una
 * etiqueta de muestra de cada estación sin crear rollos, y calibra el giro y
 * el corrimiento de ESTE equipo (se guarda en su navegador).
 */
export default function PruebaEtiquetas() {
  const { data: sample } = useQuery({ queryKey: ["labelSampleQr"], queryFn: api.getLabelSampleQr, staleTime: Infinity });
  const [settings, setSettings] = useState<PrinterSettings>(getPrinterSettings);
  const [preview, setPreview] = useState<LabelStation>("sellado");
  const [resets, setResets] = useState(0);
  const qr = sample?.qrDataUrl ?? "";

  function update(patch: Partial<PrinterSettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    savePrinterSettings(next);
  }

  const previewHtml = useMemo(
    () => (qr ? rollLabelsHtml([sampleLabel(preview, qr)], `${window.location.origin}/logo-full.png`, settings) : ""),
    [preview, qr, settings]
  );

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Prueba de etiquetas</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Imprime una etiqueta de muestra de cada estación, sin crear rollos, para probar la impresora y calibrarla. Los ajustes se guardan en
          este equipo: hacelo en el PC que tiene la impresora conectada.
        </p>
      </div>

      <section className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 space-y-3">
        <h2 className="font-medium text-slate-700 dark:text-slate-200">Etiquetas</h2>
        {/* Impresora de planta (la que se usa desde el celular): la etiqueta
            sale al tamaño del rollo cargado en esa impresora. */}
        <div className="flex flex-wrap items-center gap-2 rounded border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950 p-3 text-sm">
          <span className="text-slate-700 dark:text-slate-200">Probar en la impresora de planta:</span>
          <select
            aria-label="Etiqueta de prueba"
            className="border rounded px-2 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            value={preview}
            onChange={(e) => setPreview(e.target.value as LabelStation)}
          >
            {STATIONS.map((s) => (
              <option key={s.station} value={s.station}>
                {s.name}
              </option>
            ))}
          </select>
          <PrintOnPrinter key={preview} testStation={preview} label="Imprimir prueba en impresora" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 dark:text-slate-400">
                <th className="py-1.5 pr-3 font-normal">Etiqueta</th>
                <th className="py-1.5 pr-3 font-normal">Tamaño</th>
                <th className="py-1.5 pr-3 font-normal">Rollo de etiquetas a cargar</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {STATIONS.map(({ station, name }) => {
                const f = LABEL_FORMATS[station];
                const sheet = labelSheet(station, settings);
                return (
                  <tr key={station}>
                    <td className="py-2 pr-3 font-medium text-slate-800 dark:text-slate-100">{name}</td>
                    <td className="py-2 pr-3 text-slate-600 dark:text-slate-300">
                      {f.widthMm / 10} × {f.heightMm / 10} cm
                    </td>
                    <td className="py-2 pr-3 text-slate-600 dark:text-slate-300">
                      {sheet.widthMm / 10} cm de ancho{sheet.rotated ? " · sale girada" : ""}
                      {sheet.widthMm > PRINTER_MAX_WIDTH_MM && <span className="block text-xs text-red-600 dark:text-red-400">No entra en la impresora (máx. {PRINTER_MAX_WIDTH_MM / 10} cm)</span>}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <button type="button" onClick={() => setPreview(station)} className="text-sky-700 dark:text-sky-400 hover:underline mr-3">
                        Ver
                      </button>
                      <button
                        type="button"
                        disabled={!qr}
                        onClick={() => printRollLabels([sampleLabel(station, qr)])}
                        className="inline-flex items-center gap-1.5 bg-slate-800 text-white rounded px-3 py-1.5 disabled:opacity-50"
                      >
                        <Printer size={14} aria-hidden="true" /> Imprimir prueba
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {qr && (
          <iframe
            title="Vista previa de la etiqueta"
            srcDoc={previewHtml}
            className="w-full h-[460px] rounded border border-slate-200 dark:border-slate-700 bg-slate-200"
          />
        )}
      </section>

      <section className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 space-y-3">
        <h2 className="font-medium text-slate-700 dark:text-slate-200">Ajustes de este equipo</h2>
        <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input type="checkbox" className="mt-0.5" checked={settings.rotateWide} onChange={(e) => update({ rotateWide: e.target.checked })} />
          <span>
            Girar las etiquetas más anchas que {PRINTER_MAX_WIDTH_MM / 10} cm (Sellado y rollos).
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              La impresora imprime hasta {PRINTER_MAX_WIDTH_MM / 10} cm a lo ancho: esas etiquetas salen a lo largo del rollo.
            </span>
          </span>
        </label>
        <div className="flex flex-wrap gap-4 text-sm text-slate-700 dark:text-slate-200">
          {/* key: "Volver a lo normal" reinicia también el texto de los campos. */}
          <OffsetInput key={`x${resets}`} label="Correr a la derecha (mm)" value={settings.offsetXmm} onChange={(mm) => update({ offsetXmm: mm })} />
          <OffsetInput key={`y${resets}`} label="Correr hacia abajo (mm)" value={settings.offsetYmm} onChange={(mm) => update({ offsetYmm: mm })} />
          <button
            type="button"
            onClick={() => {
              update(DEFAULT_PRINTER_SETTINGS);
              setResets((n) => n + 1);
            }}
            className="text-sky-700 dark:text-sky-400 hover:underline"
          >
            Volver a lo normal
          </button>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Si la etiqueta sale corrida o cortada en un borde, corregí acá en milímetros (negativo = hacia la izquierda / arriba) y volvé a imprimir la
          prueba.
        </p>
      </section>

      <section className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 space-y-2 text-sm text-slate-600 dark:text-slate-300">
        <h2 className="font-medium text-slate-700 dark:text-slate-200">Al imprimir (ventana de Chrome)</h2>
        <ol className="list-decimal pl-5 space-y-1">
          <li>Destino: la impresora SAT TT460.</li>
          <li>Márgenes: <strong>Ninguno</strong>. Escala: <strong>Predeterminada (100%)</strong>, nunca "Ajustar".</li>
          <li>Tamaño de papel: el mismo del rollo cargado (por ejemplo 80 × 160 mm para Sellado). Si no aparece, crealo en las preferencias de la impresora de Windows.</li>
          <li>En la impresora: tipo de medio etiqueta con separación (gap) y calibrar el sensor después de cambiar de rollo.</li>
        </ol>
      </section>
    </div>
  );
}
