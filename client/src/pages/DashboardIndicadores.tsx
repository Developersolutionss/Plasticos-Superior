import { useQuery } from "@tanstack/react-query";
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

export default function DashboardIndicadores() {
  const { data, isLoading } = useQuery({ queryKey: ["dashboardIndicadores"], queryFn: api.getDashboardIndicadores });

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Indicadores</h1>
        <p className="text-sm text-slate-500">Producción y calidad de los últimos 30 días</p>
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
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
              Top productos despachados (30 días)
            </h2>
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
