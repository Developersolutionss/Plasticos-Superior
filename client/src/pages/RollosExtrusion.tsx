import { useQuery } from "@tanstack/react-query";
import { api, type ExtrusionRollsByProduct } from "../api/client";
import AsyncState from "../components/AsyncState";
import { SkeletonRows } from "../components/Skeleton";

/**
 * Rollos de Extrusión con material sin consumir: cuántos hay y cuántos kilos
 * (decisión del cliente, 2026-10-21). Es material que se consume en las OPs
 * derivadas (Impresión, Sellado, Precorte), así que NO suma al stock de
 * producto terminado: ese entra al aprobar Calidad, y sumarlo también acá lo
 * contaría dos veces.
 */
export default function RollosExtrusion() {
  const query = useQuery({ queryKey: ["extrusionRolls"], queryFn: api.getExtrusionRolls });

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Rollos de Extrusión con material todavía sin consumir. Es material en proceso: se gasta en las OPs derivadas (Impresión, Sellado,
        Precorte), por eso no se suma al stock de producto terminado. Los de una OP sin cliente son material general; los de una OP con
        cliente son de ese cliente.
      </p>
      <AsyncState
        query={query}
        skeleton={<SkeletonRows rows={4} cols={5} />}
        isEmpty={(rows) => rows.length === 0}
        emptyMessage="No hay rollos de Extrusión con material sin consumir."
        errorMessage="No se pudieron cargar los rollos de Extrusión."
      >
        {(rows: ExtrusionRollsByProduct[]) => {
          const totalRolls = rows.reduce((acc, r) => acc + r.rollCount, 0);
          const totalKg = Math.round(rows.reduce((acc, r) => acc + r.totalKg, 0) * 100) / 100;
          return (
            <>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                En total: {totalRolls} {totalRolls === 1 ? "rollo" : "rollos"} · {totalKg} kg
              </p>
              <div className="bg-white dark:bg-slate-900 rounded-lg shadow overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-100 dark:bg-slate-800 text-left">
                    <tr>
                      <th className="p-3">Producto</th>
                      <th className="p-3">Rollos</th>
                      <th className="p-3">Kilos</th>
                      <th className="p-3">General (sin cliente)</th>
                      <th className="p-3">Para clientes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.productId} className="border-t align-top">
                        <td className="p-3">
                          {p.name} <span className="text-slate-400">({p.sku})</span>
                        </td>
                        <td className="p-3 font-medium">{p.rollCount}</td>
                        <td className="p-3 font-medium">{p.totalKg} kg</td>
                        <td className="p-3">
                          {p.general.rollCount > 0 ? `${p.general.rollCount} ${p.general.rollCount === 1 ? "rollo" : "rollos"} · ${p.general.kg} kg` : "—"}
                        </td>
                        <td className="p-3">
                          {p.clients.length === 0
                            ? "—"
                            : p.clients.map((c) => (
                                <p key={c.clientId}>
                                  <strong>{c.clientName}</strong>: {c.rollCount} {c.rollCount === 1 ? "rollo" : "rollos"} · {c.kg} kg
                                </p>
                              ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          );
        }}
      </AsyncState>
    </div>
  );
}
