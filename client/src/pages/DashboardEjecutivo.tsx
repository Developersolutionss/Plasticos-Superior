import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api/client";

function formatCOP(n: number) {
  return `$${Math.round(n).toLocaleString("es-CO")}`;
}

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function formatMes(mes: string) {
  const [, month] = mes.split("-");
  return MESES_CORTOS[Number(month) - 1] ?? mes;
}

function Tile({ label, value, valueClassName, delta }: { label: string; value: string; valueClassName?: string; delta?: number | null }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <div className="flex items-baseline gap-2 mt-1">
        <p className={`text-2xl font-bold ${valueClassName ?? "text-slate-800"}`}>{value}</p>
        {delta !== undefined && (
          <span className={`text-xs font-medium ${delta === null || delta === 0 ? "text-slate-400" : delta > 0 ? "text-green-600" : "text-red-600"}`}>
            {delta === null ? "—" : `${delta > 0 ? "▲" : delta < 0 ? "▼" : ""}${Math.abs(delta).toFixed(1)}%`}
          </span>
        )}
      </div>
    </div>
  );
}

export default function DashboardEjecutivo() {
  const { data, isLoading } = useQuery({ queryKey: ["dashboardResumen"], queryFn: api.getDashboardResumen });

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Dashboard ejecutivo</h1>
        <p className="text-sm text-slate-500">Resumen de ventas, cartera y producción</p>
      </div>

      {isLoading && <p className="text-slate-500 text-sm">Cargando...</p>}

      {!isLoading && data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Tile label="Ventas del mes" value={formatCOP(data.ventasDelMes)} delta={data.cambioVentasPct} />
            <Tile label="Cartera pendiente" value={formatCOP(data.carteraPendiente)} />
            <Tile
              label="Cartera vencida"
              value={formatCOP(data.carteraVencida)}
              valueClassName={data.carteraVencida > 0 ? "text-rose-600" : undefined}
            />
            <Tile
              label="Facturas con saldo"
              value={String(data.facturasConSaldo)}
              valueClassName={data.facturasConSaldo > 0 ? "text-amber-600" : undefined}
            />
            <Tile label="OPs en curso" value={String(data.opsEnCurso)} />
            <Tile label="Pedidos en producción" value={String(data.pedidosEnProduccion)} />
            <Tile label="Cotizaciones abiertas" value={String(data.cotizacionesAbiertas)} />
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Ventas últimos 6 meses</h2>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.ventasUltimos6Meses}>
                  <XAxis dataKey="mes" tickFormatter={formatMes} tick={{ fontSize: 12 }} stroke="#94a3b8" />
                  <YAxis tickFormatter={(v: number) => formatCOP(v)} tick={{ fontSize: 11 }} stroke="#94a3b8" width={70} />
                  <Tooltip formatter={(v) => formatCOP(Number(v))} labelFormatter={(label) => formatMes(String(label))} />
                  <Bar dataKey="total" fill="#1e293b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Clientes con mayor saldo pendiente
              </h2>
            </div>
            <ul className="divide-y divide-slate-100">
              {data.topClientesSaldo.map((c) => (
                <li key={c.clientId} className="flex items-center justify-between px-5 py-3 text-sm">
                  <span className="text-slate-700">{c.name}</span>
                  <span className="font-medium text-slate-800">{formatCOP(c.saldo)}</span>
                </li>
              ))}
              {data.topClientesSaldo.length === 0 && (
                <li className="px-5 py-4 text-center text-slate-500 text-sm">Sin saldos pendientes.</li>
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
