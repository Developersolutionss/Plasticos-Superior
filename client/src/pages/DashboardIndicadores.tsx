import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api/client";

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-2xl font-bold text-slate-800 mt-1">{value}</p>
    </div>
  );
}

function toISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}

const DEFAULT_FROM = toISODate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
const DEFAULT_TO = toISODate(new Date());

export default function DashboardIndicadores() {
  // Estado "borrador" de los inputs, separado del rango que realmente
  // dispara el refetch — así no recarga en cada tecla, solo al aplicar.
  const [fromDraft, setFromDraft] = useState(DEFAULT_FROM);
  const [toDraft, setToDraft] = useState(DEFAULT_TO);
  const [range, setRange] = useState({ from: DEFAULT_FROM, to: DEFAULT_TO });

  const { data, isLoading } = useQuery({
    queryKey: ["dashboardIndicadores", range.from, range.to],
    queryFn: () => api.getDashboardIndicadores(range),
  });

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Indicadores</h1>
        <p className="text-sm text-slate-500">Producción y calidad en el rango seleccionado</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-500">
          Desde
          <input
            className="border rounded px-3 py-2 text-sm block mt-1"
            type="date"
            value={fromDraft}
            onChange={(e) => setFromDraft(e.target.value)}
          />
        </label>
        <label className="text-xs text-slate-500">
          Hasta
          <input
            className="border rounded px-3 py-2 text-sm block mt-1"
            type="date"
            value={toDraft}
            onChange={(e) => setToDraft(e.target.value)}
          />
        </label>
        <button
          className="bg-slate-800 text-white text-sm px-4 py-2 rounded"
          onClick={() => setRange({ from: fromDraft, to: toDraft })}
        >
          Aplicar
        </button>
      </div>

      {isLoading && <p className="text-slate-500 text-sm">Cargando...</p>}

      {!isLoading && data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Tile
              label="Tasa de aprobación de calidad"
              value={data.calidad.pctAprobacion === null ? "—" : `${data.calidad.pctAprobacion.toFixed(1)}%`}
            />
            <Tile label="Checks aprobados" value={String(data.calidad.aprobadas)} />
            <Tile label="Checks rechazados" value={String(data.calidad.rechazadas)} />
            <Tile
              label="Tiempo promedio de producción"
              value={data.tiempoPromedioProduccionHoras === null ? "—" : `${data.tiempoPromedioProduccionHoras.toFixed(1)} hs`}
            />
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Top productos despachados</h2>
            {data.topProductosDespachados.length === 0 ? (
              <p className="text-slate-500 text-sm py-8 text-center">Sin despachos en el período.</p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.topProductosDespachados} layout="vertical" margin={{ left: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                    <YAxis type="category" dataKey="sku" tick={{ fontSize: 12 }} stroke="#94a3b8" width={90} />
                    <Tooltip formatter={(v, _n, item) => [`${v} ${item.payload.unit}`, item.payload.name]} />
                    <Bar dataKey="total" fill="#1e293b" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
