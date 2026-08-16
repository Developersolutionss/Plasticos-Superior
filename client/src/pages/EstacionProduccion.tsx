import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, ReactNode, useState } from "react";
import { useParams } from "react-router-dom";
import { CircleCheck, CircleAlert, History, ScanLine } from "lucide-react";
import { api } from "../api/client";
import BarcodeScanner from "../components/BarcodeScanner";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "w-full border border-slate-300 dark:border-slate-600 rounded-md px-3 py-2 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-500";

type Station = "extrusion" | "impresion" | "sellado" | "precorte";

interface FieldDef {
  key: string;
  label: string;
  type: "text" | "number" | "select";
  placeholder?: string;
  options?: string[];
}

const STATION_INFO: Record<Station, { label: string; fields: FieldDef[] }> = {
  extrusion: {
    label: "Extrusión",
    fields: [
      { key: "rawMaterial", label: "Materia prima (resina)", type: "text", placeholder: "Ej. PEBD virgen" },
      { key: "rawMaterialKg", label: "Kg de materia prima consumidos", type: "number" },
      { key: "thicknessMicrons", label: "Espesor (micras)", type: "number" },
      { key: "rollWidth", label: "Ancho de manga (cm)", type: "number" },
    ],
  },
  impresion: {
    label: "Impresión",
    fields: [
      { key: "sourceRoll", label: "Rollo/bobina de origen", type: "text", placeholder: "Código o etiqueta del rollo" },
      { key: "designName", label: "Diseño / arte impreso", type: "text" },
      { key: "colorsCount", label: "Cantidad de tintas", type: "number" },
    ],
  },
  sellado: {
    label: "Sellado",
    fields: [
      { key: "sealType", label: "Tipo de sellado", type: "select", options: ["Lateral", "Fondo", "Fuelle"] },
      { key: "finalMeasure", label: "Medida final (ancho x largo)", type: "text" },
      { key: "sealTemperature", label: "Temperatura de sellado (°C)", type: "number" },
    ],
  },
  precorte: {
    label: "Precorte",
    fields: [
      { key: "unitsProduced", label: "Unidades cortadas", type: "number" },
      { key: "finalMeasure", label: "Medida final", type: "text" },
    ],
  },
};

const emptyForm = {
  productionOrderId: "",
  machine: "",
  operatorName: "",
  startTime: "",
  endTime: "",
  kilosProduced: "",
  mermaKg: "",
  downtimeMinutes: "",
  downtimeReason: "",
  notes: "",
};

export default function EstacionProduccion() {
  const { station } = useParams<{ station: string }>();
  const info = STATION_INFO[station as Station];

  const [form, setForm] = useState(emptyForm);
  const [details, setDetails] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const queryClient = useQueryClient();

  const { data: orders } = useQuery({ queryKey: ["productionOrders"], queryFn: () => api.getProductionOrders() });
  const openOrders = orders?.filter((o: any) => o.status !== "finalizada" && o.status !== "cancelada") ?? [];

  function handleScannedOrder(orderNumber: string) {
    setScanning(false);
    const match = openOrders.find((o: any) => o.orderNumber === orderNumber);
    if (!match) {
      setError(`No se encontró ninguna OP abierta con número "${orderNumber}".`);
      return;
    }
    setError(null);
    setForm((f) => ({ ...f, productionOrderId: String(match.id) }));
  }

  const { data: stages } = useQuery({
    queryKey: ["productionOrderStages", form.productionOrderId],
    queryFn: () => api.getProductionOrderStages(Number(form.productionOrderId)),
    enabled: !!form.productionOrderId,
  });

  if (!info) {
    return <p className="text-red-600 dark:text-red-400">Estación desconocida.</p>;
  }

  const stationStages = stages?.filter((s: any) => s.station === station) ?? [];

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!form.productionOrderId || !form.machine || !form.operatorName || !form.startTime || !form.kilosProduced) {
      setError("Completá al menos OP, máquina, operario, hora de inicio y kg producidos");
      return;
    }
    try {
      const detailsPayload = Object.fromEntries(Object.entries(details).filter(([, v]) => v !== ""));
      await api.createProductionStageLog(Number(form.productionOrderId), {
        station: station as Station,
        machine: form.machine,
        operatorName: form.operatorName,
        startTime: new Date(form.startTime).toISOString(),
        endTime: form.endTime ? new Date(form.endTime).toISOString() : undefined,
        kilosProduced: Number(form.kilosProduced),
        mermaKg: form.mermaKg ? Number(form.mermaKg) : 0,
        downtimeMinutes: form.downtimeMinutes ? Number(form.downtimeMinutes) : 0,
        downtimeReason: form.downtimeReason || undefined,
        details: Object.keys(detailsPayload).length ? detailsPayload : undefined,
        notes: form.notes || undefined,
      });
      setResult(
        station === "precorte"
          ? "Registrado. Como es el último paso, se generó la entrada de inventario y la OP quedó finalizada."
          : "Registrado correctamente."
      );
      setForm({ ...emptyForm, productionOrderId: form.productionOrderId });
      setDetails({});
      queryClient.invalidateQueries({ queryKey: ["productionOrderStages", form.productionOrderId] });
      queryClient.invalidateQueries({ queryKey: ["productionOrders"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
    } catch {
      setError("No se pudo registrar el paso");
    }
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">{info.label}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Registro de paso de producción por estación</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        {(error || result) && (
          <div
            className={`flex items-center gap-2 px-5 py-3 text-sm border-b ${
              error
                ? "bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-400 border-red-100 dark:border-red-800"
                : "bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border-emerald-100 dark:border-emerald-800"
            }`}
          >
            {error ? <CircleAlert size={16} strokeWidth={2} aria-hidden="true" /> : <CircleCheck size={16} strokeWidth={2} aria-hidden="true" />}
            <span>{error ?? result}</span>
          </div>
        )}

        <div className="p-5 space-y-5">
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Orden de producción</h2>
            <div className="flex gap-2">
              <select
                className={inputClass}
                value={form.productionOrderId}
                onChange={(e) => setForm({ ...form, productionOrderId: e.target.value })}
              >
                <option value="">Orden de producción (OP)...</option>
                {openOrders.map((o: any) => (
                  <option key={o.id} value={o.id}>
                    {o.orderNumber} — {o.product.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="shrink-0 border border-slate-300 dark:border-slate-600 rounded-md px-3 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                title="Escanear OP"
                onClick={() => setScanning(true)}
              >
                <ScanLine size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          </section>

          <section className="space-y-3 border-t border-slate-100 dark:border-slate-700 pt-5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Datos generales</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Máquina">
                <input
                  className={inputClass}
                  placeholder="Ej. Extrusora 1"
                  value={form.machine}
                  onChange={(e) => setForm({ ...form, machine: e.target.value })}
                />
              </Field>
              <Field label="Operario">
                <input
                  className={inputClass}
                  placeholder="Nombre del operario"
                  value={form.operatorName}
                  onChange={(e) => setForm({ ...form, operatorName: e.target.value })}
                />
              </Field>
              <Field label="Hora inicio">
                <input
                  className={inputClass}
                  type="datetime-local"
                  value={form.startTime}
                  onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                />
              </Field>
              <Field label="Hora fin (opcional)">
                <input
                  className={inputClass}
                  type="datetime-local"
                  value={form.endTime}
                  onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                />
              </Field>
              <Field label="Kg producidos">
                <input
                  className={inputClass}
                  placeholder="0.00"
                  type="number"
                  step="0.01"
                  value={form.kilosProduced}
                  onChange={(e) => setForm({ ...form, kilosProduced: e.target.value })}
                />
              </Field>
              <Field label="Merma (kg)">
                <input
                  className={inputClass}
                  placeholder="0.00"
                  type="number"
                  step="0.01"
                  value={form.mermaKg}
                  onChange={(e) => setForm({ ...form, mermaKg: e.target.value })}
                />
              </Field>
              <Field label="Tiempo muerto (minutos)">
                <input
                  className={inputClass}
                  placeholder="0"
                  type="number"
                  value={form.downtimeMinutes}
                  onChange={(e) => setForm({ ...form, downtimeMinutes: e.target.value })}
                />
              </Field>
              <Field label="Motivo del tiempo muerto">
                <input
                  className={inputClass}
                  placeholder="Ej. Cambio de bobina"
                  value={form.downtimeReason}
                  onChange={(e) => setForm({ ...form, downtimeReason: e.target.value })}
                />
              </Field>
            </div>
          </section>

          <section className="space-y-3 border-t border-slate-100 dark:border-slate-700 pt-5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Específico de {info.label}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
              {info.fields.map((field) => (
                <Field key={field.key} label={field.label}>
                  {field.type === "select" ? (
                    <select
                      className={inputClass}
                      value={details[field.key] ?? ""}
                      onChange={(e) => setDetails({ ...details, [field.key]: e.target.value })}
                    >
                      <option value="">Seleccionar...</option>
                      {field.options!.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className={inputClass}
                      placeholder={field.placeholder}
                      type={field.type}
                      value={details[field.key] ?? ""}
                      onChange={(e) => setDetails({ ...details, [field.key]: e.target.value })}
                    />
                  )}
                </Field>
              ))}
            </div>
          </section>

          <section className="space-y-3 border-t border-slate-100 dark:border-slate-700 pt-5">
            <Field label="Notas (opcional)">
              <input
                className={inputClass}
                placeholder="Observaciones del paso"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </Field>
          </section>
        </div>

        <div className="px-5 py-4 bg-slate-50 dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 flex justify-end">
          <button
            className="bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium px-5 py-2 rounded-md transition-colors"
            type="submit"
          >
            Registrar paso
          </button>
        </div>
      </form>

      {form.productionOrderId && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100 dark:border-slate-700">
            <History size={16} strokeWidth={2} className="text-slate-500 dark:text-slate-400" aria-hidden="true" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Historial de {info.label} para esta OP</p>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-700 text-sm">
            {stationStages.map((s: any) => (
              <li key={s.id} className="px-5 py-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-slate-700 dark:text-slate-200">
                <span className="font-medium">{s.operatorName}</span>
                <span className="text-slate-300 dark:text-slate-400">·</span>
                <span>{s.machine}</span>
                <span className="text-slate-300 dark:text-slate-400">·</span>
                <span>{s.kilosProduced} kg</span>
                {Number(s.mermaKg) > 0 && (
                  <>
                    <span className="text-slate-300 dark:text-slate-400">·</span>
                    <span>merma {s.mermaKg} kg</span>
                  </>
                )}
                <span className="text-slate-300 dark:text-slate-400">·</span>
                <span className="text-slate-500 dark:text-slate-400">{new Date(s.startTime).toLocaleString()}</span>
              </li>
            ))}
            {stationStages.length === 0 && <p className="text-slate-500 dark:text-slate-400 px-5 py-4">Sin registros todavía.</p>}
          </ul>
        </div>
      )}

      {scanning && (
        <BarcodeScanner title="Escanear OP" onDetected={handleScannedOrder} onClose={() => setScanning(false)} />
      )}
    </div>
  );
}
