import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";

type Row = {
  clientId: number;
  clientName: string;
  productId: number;
  productName: string;
  unit: string;
  totalQuantity: number;
  dispatchCount: number;
  lastDispatchedDate: string | null;
  /** Lo que todavía falta despacharle (despachos abiertos). */
  pendingQuantity: number;
  /** De lo pendiente, lo que ya está fabricado y reservado para él. */
  reservedQuantity: number;
};

const n = (v: number) => Math.round(v * 100) / 100;

/** Histórico de cuánto se le despachó a cada cliente, agrupado por producto
 * (sumar entre productos con unidades distintas no tiene sentido) — el
 * cliente pidió poder verlo de un vistazo en vez de sumarlo a mano
 * revisando despacho por despacho. Ver server/src/routes/dispatches.ts,
 * GET /summary-by-client. */
export default function DespachosPorCliente() {
  const [search, setSearch] = useState("");

  const { data: rows, isLoading } = useQuery({ queryKey: ["dispatchSummaryByClient"], queryFn: api.getDispatchSummaryByClient });

  const filtered = ((rows as Row[]) ?? []).filter((r) => r.clientName.toLowerCase().includes(search.toLowerCase()));

  // Total por cliente, para el subtotal visual entre grupos.
  const clientOrder: string[] = [];
  for (const r of filtered) if (!clientOrder.includes(r.clientName)) clientOrder.push(r.clientName);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Despachos por cliente</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Cuánto se le despachó a cada cliente, por producto, y cuánto falta despacharle (de eso, lo que ya está fabricado y reservado para él)
        </p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4">
        <input
          className="border rounded px-3 py-2 text-sm w-full sm:w-72 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          placeholder="Buscar cliente..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading && <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 text-center text-slate-500 dark:text-slate-400 text-sm">Cargando...</div>}

      {!isLoading && filtered.length === 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 text-center text-slate-500 dark:text-slate-400 text-sm">
          Todavía no hay despachos.
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <>
          <div className="hidden md:block bg-white dark:bg-slate-900 rounded-lg shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 dark:bg-slate-800 text-left">
                <tr>
                  <th className="p-3">Cliente</th>
                  <th className="p-3">Producto</th>
                  <th className="p-3">Total despachado</th>
                  <th className="p-3">Por despachar</th>
                  <th className="p-3"># Despachos</th>
                  <th className="p-3">Último despacho</th>
                </tr>
              </thead>
              <tbody>
                {clientOrder.map((clientName) => {
                  const clientRows = filtered.filter((r) => r.clientName === clientName);
                  return clientRows.map((r, i) => (
                    <tr key={`${r.clientId}-${r.productId}`} className="border-t hover:bg-slate-50 dark:hover:bg-slate-800">
                      <td className="p-3 font-medium">{i === 0 ? r.clientName : ""}</td>
                      <td className="p-3">{r.productName}</td>
                      <td className="p-3">
                        {n(r.totalQuantity)} {r.unit}
                      </td>
                      <td className="p-3">
                        {r.pendingQuantity > 0 ? (
                          <>
                            {n(r.pendingQuantity)} {r.unit}
                            {r.reservedQuantity > 0 && (
                              <span className="block text-xs text-sky-700 dark:text-sky-400">
                                {n(r.reservedQuantity)} {r.unit} ya fabricados (reservados)
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="p-3">{r.dispatchCount}</td>
                      <td className="p-3">{r.lastDispatchedDate ? new Date(r.lastDispatchedDate).toLocaleDateString() : "—"}</td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-3">
            {clientOrder.map((clientName) => {
              const clientRows = filtered.filter((r) => r.clientName === clientName);
              return (
                <div key={clientName} className="bg-white dark:bg-slate-900 rounded-lg shadow overflow-hidden">
                  <div className="px-4 py-2 bg-slate-100 dark:bg-slate-800 font-medium text-slate-800 dark:text-slate-100">{clientName}</div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-700">
                    {clientRows.map((r) => (
                      <div key={`${r.clientId}-${r.productId}`} className="p-3 space-y-1">
                        <p className="font-medium text-slate-800 dark:text-slate-100">{r.productName}</p>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          {n(r.totalQuantity)} {r.unit} · {r.dispatchCount} despacho{r.dispatchCount === 1 ? "" : "s"}
                        </p>
                        {r.pendingQuantity > 0 && (
                          <p className="text-sm text-amber-700 dark:text-amber-400">
                            Por despachar: {n(r.pendingQuantity)} {r.unit}
                            {r.reservedQuantity > 0 && ` (${n(r.reservedQuantity)} ya fabricados)`}
                          </p>
                        )}
                        <p className="text-xs text-slate-400 dark:text-slate-500">
                          Último: {r.lastDispatchedDate ? new Date(r.lastDispatchedDate).toLocaleDateString() : "—"}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
