import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TriangleAlert } from "lucide-react";
import { api } from "../api/client";
import { useTheme } from "../theme/ThemeContext";

function formatCOP(n: number) {
  return `$${Math.round(n).toLocaleString("es-CO")}`;
}

function formatKg(n: number) {
  return `${Math.round(n).toLocaleString("es-CO")} kg`;
}

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function formatMes(mes: string) {
  const [, month] = mes.split("-");
  return MESES_CORTOS[Number(month) - 1] ?? mes;
}

const PERIODOS = [
  { value: "mes", label: "Mes" },
  { value: "trimestre", label: "Trimestre" },
  { value: "anio", label: "Año" },
] as const;

const ESTACION_LABELS: Record<string, string> = {
  extrusion: "Extrusión",
  impresion: "Impresión",
  sellado: "Sellado",
  precorte: "Precorte",
};

const SEVERITY_STYLES: Record<string, string> = {
  critica: "border-red-500 dark:border-red-500",
  alta: "border-amber-500 dark:border-amber-500",
  media: "border-sky-500 dark:border-sky-500",
};

function Tile({ label, value, valueClassName, delta, sub }: { label: string; value: string; valueClassName?: string; delta?: number | null; sub?: string }) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <div className="flex items-baseline gap-2 mt-1">
        <p className={`text-2xl font-bold ${valueClassName ?? "text-slate-800 dark:text-slate-100"}`}>{value}</p>
        {delta !== undefined && (
          <span className={`text-xs font-medium ${delta === null || delta === 0 ? "text-slate-400 dark:text-slate-400" : delta > 0 ? "text-green-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
            {delta === null ? "—" : `${delta > 0 ? "▲" : delta < 0 ? "▼" : ""}${Math.abs(delta).toFixed(1)}%`}
          </span>
        )}
      </div>
      {sub && <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{children}</h2>;
}

export default function DashboardEjecutivo() {
  const [period, setPeriod] = useState<"mes" | "trimestre" | "anio">("mes");
  const { data, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ["dashboardResumen", period],
    queryFn: () => api.getDashboardResumen(period),
  });
  const { resolved } = useTheme();
  // slate-800 (barra en modo claro) es casi invisible sobre el fondo
  // slate-900 de las tarjetas en modo oscuro — se usa un tono más claro ahí.
  const ventasFill = resolved === "dark" ? "#38bdf8" : "#1e293b";
  const kgFill = resolved === "dark" ? "#64748b" : "#94a3b8";
  const axisStroke = resolved === "dark" ? "#64748b" : "#94a3b8";

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Dashboard ejecutivo</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Comercial, cartera y producción</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-slate-300 dark:border-slate-600 overflow-hidden">
            {PERIODOS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                className={`px-3 py-1.5 text-sm ${
                  period === p.value
                    ? "bg-slate-800 dark:bg-sky-600 text-white"
                    : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {dataUpdatedAt > 0 && (
            <span className="text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap">
              Actualizado {new Date(dataUpdatedAt).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
      </div>

      {isLoading && <p className="text-slate-500 dark:text-slate-400 text-sm">Cargando...</p>}

      {!isLoading && data && (
        <>
          <div>
            <SectionLabel>Comercial y cartera</SectionLabel>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
              <Tile label="Ventas del período" value={formatCOP(data.ventasDelPeriodo)} delta={data.cambioVentasPct} />
              <Tile label="Cartera pendiente" value={formatCOP(data.carteraPendiente)} />
              <Tile
                label="Cartera vencida"
                value={formatCOP(data.carteraVencida)}
                valueClassName={data.carteraVencida > 0 ? "text-rose-600 dark:text-rose-400" : undefined}
              />
              <Tile
                label="Embudo de cotizaciones"
                value={String(data.cotizacionesAbiertas)}
                sub={`${formatCOP(data.valorCotizacionesAbiertas)} abiertas${
                  data.tasaCierrePct != null ? ` · ${data.tasaCierrePct.toFixed(0)}% cierre` : ""
                }`}
              />
            </div>
          </div>

          <div>
            <SectionLabel>Producción</SectionLabel>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
              <Tile label="OPs en curso" value={String(data.opsEnCurso)} />
              <Tile label="Pedidos en producción" value={String(data.pedidosEnProduccion)} />
              <Tile label="Kg producidos" value={formatKg(data.kgProducidosDelPeriodo)} />
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4">
            <SectionLabel>Ventas vs kg producidos · últimos 6 meses</SectionLabel>
            <div className="h-56 mt-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.ventasUltimos6Meses}>
                  <XAxis dataKey="mes" tickFormatter={formatMes} tick={{ fontSize: 12 }} stroke={axisStroke} />
                  <YAxis yAxisId="ventas" tickFormatter={(v: number) => formatCOP(v)} tick={{ fontSize: 11 }} stroke={axisStroke} width={70} />
                  <YAxis yAxisId="kg" orientation="right" tickFormatter={(v: number) => `${Math.round(v / 1000)}t`} tick={{ fontSize: 11 }} stroke={axisStroke} width={45} />
                  <Tooltip
                    formatter={(v, name) => (name === "kg" ? formatKg(Number(v)) : formatCOP(Number(v)))}
                    labelFormatter={(label) => formatMes(String(label))}
                  />
                  <Bar yAxisId="ventas" dataKey="total" name="Ventas" fill={ventasFill} radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="kg" dataKey="kg" name="kg" fill={kgFill} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700">
              <SectionLabel>Alertas y acciones</SectionLabel>
            </div>
            {data.alertas.length === 0 ? (
              <p className="px-5 py-4 text-center text-slate-500 dark:text-slate-400 text-sm">Sin alertas por ahora.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                {data.alertas.map((a, i) => (
                  <li key={i} className={`flex items-start gap-2.5 px-5 py-3 border-l-4 ${SEVERITY_STYLES[a.severity]}`}>
                    <TriangleAlert size={15} strokeWidth={2} className="flex-shrink-0 mt-0.5 text-slate-400 dark:text-slate-500" />
                    <div>
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{a.title}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{a.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-5">
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 dark:border-slate-700">
                <SectionLabel>Órdenes de producción en curso</SectionLabel>
                <Link to="/produccion/ordenes" className="text-xs text-sky-600 dark:text-sky-400 hover:underline whitespace-nowrap">
                  Ver todas ({data.ordenesEnCursoTotal})
                </Link>
              </div>

              {data.ordenesEnCurso.length === 0 ? (
                <p className="px-5 py-4 text-center text-slate-500 dark:text-slate-400 text-sm">Sin OPs en curso.</p>
              ) : (
                <>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 dark:bg-slate-800 text-left">
                        <tr>
                          <th className="px-5 py-2">OP</th>
                          <th className="px-3 py-2">Cliente</th>
                          <th className="px-3 py-2">Producto</th>
                          <th className="px-3 py-2">Estación</th>
                          <th className="px-3 py-2">Avance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.ordenesEnCurso.map((o) => (
                          <tr key={o.id} className="border-t border-slate-100 dark:border-slate-700">
                            <td className="px-5 py-2.5 font-medium text-slate-800 dark:text-slate-100">{o.orderNumber}</td>
                            <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{o.clientName ?? "—"}</td>
                            <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{o.productName}</td>
                            <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{o.station ? ESTACION_LABELS[o.station] : "—"}</td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-2">
                                <div className="w-16 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                                  <div className="h-full bg-sky-500" style={{ width: `${o.avancePct}%` }} />
                                </div>
                                <span className="text-xs text-slate-500 dark:text-slate-400">{o.avancePct}%</span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <ul className="md:hidden divide-y divide-slate-100 dark:divide-slate-700">
                    {data.ordenesEnCurso.map((o) => (
                      <li key={o.id} className="px-5 py-3 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium text-slate-800 dark:text-slate-100">{o.orderNumber}</p>
                          <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">{o.station ? ESTACION_LABELS[o.station] : "—"}</span>
                        </div>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          {o.clientName ?? "—"} · {o.productName}
                        </p>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                            <div className="h-full bg-sky-500" style={{ width: `${o.avancePct}%` }} />
                          </div>
                          <span className="text-xs text-slate-500 dark:text-slate-400">{o.avancePct}%</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700">
                <SectionLabel>Clientes con mayor saldo</SectionLabel>
              </div>
              <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                {data.topClientesSaldo.map((c) => (
                  <li key={c.clientId} className="flex items-center justify-between px-5 py-3 text-sm">
                    <span className="text-slate-700 dark:text-slate-200">{c.name}</span>
                    <span className="font-medium text-slate-800 dark:text-slate-100">{formatCOP(c.saldo)}</span>
                  </li>
                ))}
                {data.topClientesSaldo.length === 0 && (
                  <li className="px-5 py-4 text-center text-slate-500 dark:text-slate-400 text-sm">Sin saldos pendientes.</li>
                )}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
