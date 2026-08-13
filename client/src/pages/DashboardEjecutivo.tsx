import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

function formatCOP(n: number) {
  return `$${Math.round(n).toLocaleString("es-CO")}`;
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-2xl font-bold text-slate-800 mt-1">{value}</p>
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
            <Tile label="Ventas del mes" value={formatCOP(data.ventasDelMes)} />
            <Tile label="Cartera pendiente" value={formatCOP(data.carteraPendiente)} />
            <Tile label="Facturas con saldo" value={String(data.facturasConSaldo)} />
            <Tile label="OPs en curso" value={String(data.opsEnCurso)} />
            <Tile label="Pedidos en producción" value={String(data.pedidosEnProduccion)} />
            <Tile label="Cotizaciones abiertas" value={String(data.cotizacionesAbiertas)} />
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
