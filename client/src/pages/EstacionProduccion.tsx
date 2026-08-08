import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";

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
  const queryClient = useQueryClient();

  const { data: orders } = useQuery({ queryKey: ["productionOrders"], queryFn: () => api.getProductionOrders() });
  const openOrders = orders?.filter((o: any) => o.status !== "finalizada" && o.status !== "cancelada") ?? [];

  const { data: stages } = useQuery({
    queryKey: ["productionOrderStages", form.productionOrderId],
    queryFn: () => api.getProductionOrderStages(Number(form.productionOrderId)),
    enabled: !!form.productionOrderId,
  });

  if (!info) {
    return <p className="text-red-600">Estación desconocida.</p>;
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
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-xl font-semibold text-slate-800">{info.label}</h1>

      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-4 space-y-3">
        {error && <p className="text-red-600 text-sm">{error}</p>}
        {result && <p className="text-emerald-700 text-sm">{result}</p>}

        <select
          className="w-full border rounded px-3 py-2 text-sm"
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            className="border rounded px-3 py-2 text-sm"
            placeholder="Máquina"
            value={form.machine}
            onChange={(e) => setForm({ ...form, machine: e.target.value })}
          />
          <input
            className="border rounded px-3 py-2 text-sm"
            placeholder="Operario"
            value={form.operatorName}
            onChange={(e) => setForm({ ...form, operatorName: e.target.value })}
          />
          <label className="text-xs text-slate-500 -mb-1 sm:col-span-1">
            Hora inicio
            <input
              className="w-full border rounded px-3 py-2 text-sm mt-1"
              type="datetime-local"
              value={form.startTime}
              onChange={(e) => setForm({ ...form, startTime: e.target.value })}
            />
          </label>
          <label className="text-xs text-slate-500 -mb-1">
            Hora fin (opcional)
            <input
              className="w-full border rounded px-3 py-2 text-sm mt-1"
              type="datetime-local"
              value={form.endTime}
              onChange={(e) => setForm({ ...form, endTime: e.target.value })}
            />
          </label>
          <input
            className="border rounded px-3 py-2 text-sm"
            placeholder="Kg producidos"
            type="number"
            step="0.01"
            value={form.kilosProduced}
            onChange={(e) => setForm({ ...form, kilosProduced: e.target.value })}
          />
          <input
            className="border rounded px-3 py-2 text-sm"
            placeholder="Merma (kg)"
            type="number"
            step="0.01"
            value={form.mermaKg}
            onChange={(e) => setForm({ ...form, mermaKg: e.target.value })}
          />
          <input
            className="border rounded px-3 py-2 text-sm"
            placeholder="Tiempo muerto (minutos)"
            type="number"
            value={form.downtimeMinutes}
            onChange={(e) => setForm({ ...form, downtimeMinutes: e.target.value })}
          />
          <input
            className="border rounded px-3 py-2 text-sm"
            placeholder="Motivo del tiempo muerto"
            value={form.downtimeReason}
            onChange={(e) => setForm({ ...form, downtimeReason: e.target.value })}
          />
        </div>

        <div className="border-t pt-3 space-y-2">
          <p className="text-xs uppercase tracking-wide text-slate-500">Específico de {info.label}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {info.fields.map((field) => (
              <div key={field.key}>
                {field.type === "select" ? (
                  <select
                    className="w-full border rounded px-3 py-2 text-sm"
                    value={details[field.key] ?? ""}
                    onChange={(e) => setDetails({ ...details, [field.key]: e.target.value })}
                  >
                    <option value="">{field.label}...</option>
                    {field.options!.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="w-full border rounded px-3 py-2 text-sm"
                    placeholder={field.label}
                    type={field.type}
                    value={details[field.key] ?? ""}
                    onChange={(e) => setDetails({ ...details, [field.key]: e.target.value })}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        <input
          className="w-full border rounded px-3 py-2 text-sm"
          placeholder="Notas (opcional)"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />

        <button className="bg-slate-800 text-white text-sm px-4 py-2 rounded" type="submit">
          Registrar paso
        </button>
      </form>

      {form.productionOrderId && (
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm font-medium text-slate-700 mb-2">Historial de {info.label} para esta OP</p>
          <ul className="divide-y text-sm">
            {stationStages.map((s: any) => (
              <li key={s.id} className="py-2">
                {s.operatorName} · {s.machine} · {s.kilosProduced} kg
                {Number(s.mermaKg) > 0 && ` · merma ${s.mermaKg} kg`}
                {" · "}
                {new Date(s.startTime).toLocaleString()}
              </li>
            ))}
            {stationStages.length === 0 && <p className="text-slate-500 py-2">Sin registros todavía.</p>}
          </ul>
        </div>
      )}
    </div>
  );
}
