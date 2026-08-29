import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import { STATION_LABELS, OpStation } from "../opTemplates";

type Row = {
  operatorName: string;
  day: string;
  station: string | null;
  rollCount: number;
  weightKg: number;
  wasteKg: number;
};

function todayISO() {
  return new Date().toLocaleDateString("en-CA");
}

function daysAgoISO(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toLocaleDateString("en-CA");
}

function formatDay(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * El cliente cuadra a mano cuánto usó cada operario en el día (kg de rollos
 * que sacó vs. lo producido + desperdicio) — este reporte lo saca solo de
 * los rollos ya cargados (por escaneo o a mano), sin pedirle a nadie que
 * tipee nada nuevo. Ver server/src/routes/productionOrders.ts,
 * GET /reports/por-operario.
 */
export default function ProduccionPorOperario() {
  const [from, setFrom] = useState(daysAgoISO(7));
  const [to, setTo] = useState(todayISO());
  const [station, setStation] = useState("");

  const { data: rows, isLoading } = useQuery({
    queryKey: ["produccionPorOperario", from, to, station],
    queryFn: () => api.getProduccionPorOperario({ from, to, station: station || undefined }),
  });

  const totalKg = (r: Row) => r.weightKg + r.wasteKg;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Producción por operario</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Rollos cargados por cada operario, agrupados por día — kg producidos vs. desperdicio, sin cuadrar nada a mano
        </p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 flex flex-wrap gap-2 items-end">
        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Desde</label>
          <input
            type="date"
            className="border rounded px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Hasta</label>
          <input
            type="date"
            className="border rounded px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            value={to}
            min={from}
            max={todayISO()}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Proceso</label>
          <select
            className="border rounded px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            value={station}
            onChange={(e) => setStation(e.target.value)}
          >
            <option value="">Todos los procesos</option>
            {Object.entries(STATION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isLoading && <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 text-center text-slate-500 dark:text-slate-400 text-sm">Cargando...</div>}

      {!isLoading && rows?.length === 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 text-center text-slate-500 dark:text-slate-400 text-sm">
          No hay rollos cargados en ese rango.
        </div>
      )}

      {!isLoading && rows && rows.length > 0 && (
        <>
          <div className="hidden md:block bg-white dark:bg-slate-900 rounded-lg shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 dark:bg-slate-800 text-left">
                <tr>
                  <th className="p-3">Operario</th>
                  <th className="p-3">Fecha</th>
                  <th className="p-3">Proceso</th>
                  <th className="p-3">Rollos</th>
                  <th className="p-3">Kg producidos</th>
                  <th className="p-3">Kg desperdicio</th>
                  <th className="p-3">Total kg</th>
                </tr>
              </thead>
              <tbody>
                {(rows as Row[]).map((r) => (
                  <tr key={`${r.operatorName}|${r.day}|${r.station}`} className="border-t hover:bg-slate-50 dark:hover:bg-slate-800">
                    <td className="p-3 font-medium">{r.operatorName}</td>
                    <td className="p-3">{formatDay(r.day)}</td>
                    <td className="p-3">{(r.station && STATION_LABELS[r.station as OpStation]) ?? r.station ?? "—"}</td>
                    <td className="p-3">{r.rollCount}</td>
                    <td className="p-3">{r.weightKg.toFixed(2)}</td>
                    <td className="p-3">{r.wasteKg.toFixed(2)}</td>
                    <td className="p-3 font-medium">{totalKg(r).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden bg-white dark:bg-slate-900 rounded-lg shadow divide-y divide-slate-100 dark:divide-slate-700">
            {(rows as Row[]).map((r) => (
              <div key={`${r.operatorName}|${r.day}|${r.station}`} className="p-4 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-slate-800 dark:text-slate-100">{r.operatorName}</p>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{formatDay(r.day)}</span>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {(r.station && STATION_LABELS[r.station as OpStation]) ?? r.station ?? "—"} · {r.rollCount} rollo{r.rollCount === 1 ? "" : "s"}
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {r.weightKg.toFixed(2)} kg producidos · {r.wasteKg.toFixed(2)} kg desperdicio · <span className="font-medium">{totalKg(r).toFixed(2)} kg total</span>
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
