import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Lock, Truck } from "lucide-react";
import { api, type ClientReservation } from "../api/client";
import AsyncState from "../components/AsyncState";
import { SkeletonRows } from "../components/Skeleton";
import { STATION_LABELS, type OpStation } from "../opTemplates";

function fecha(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CO", { dateStyle: "medium" });
}

/**
 * Lo fabricado para cada cliente que todavía no se le despachó (reunión con
 * el cliente, 2026-10-06). Está en el inventario, pero reservado: no figura
 * como disponible en Existencias y Despachos no deja llevárselo a otro
 * cliente. Cancelar el despacho del cliente lo libera.
 */
export default function RollosClientes() {
  const [clientFilter, setClientFilter] = useState("");
  const query = useQuery({ queryKey: ["clientReservations"], queryFn: api.getClientReservations });

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Rollos para clientes</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Lo que se fabricó para un cliente y todavía no se le despachó. Está en el inventario pero reservado: no cuenta como disponible y no
          se puede despachar a otro cliente. Si el cliente cancela, cancelá su despacho y pasa a stock libre.
        </p>
      </div>

      <AsyncState
        query={query}
        skeleton={<SkeletonRows rows={4} cols={4} />}
        isEmpty={(rows) => rows.length === 0}
        emptyMessage="No hay nada reservado para clientes: todo lo fabricado para un cliente ya se le despachó."
        errorMessage="No se pudieron cargar los rollos para clientes."
      >
        {(reservations: ClientReservation[]) => {
          const clients = [...new Map(reservations.map((r) => [r.client.id, r.client])).values()].sort((a, b) => a.name.localeCompare(b.name));
          const visible = reservations.filter((r) => !clientFilter || String(r.client.id) === clientFilter);
          const byClient = new Map<number, ClientReservation[]>();
          for (const r of visible) byClient.set(r.client.id, [...(byClient.get(r.client.id) ?? []), r]);
          return (
            <>
              <select
                aria-label="Cliente"
                className="border rounded px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
              >
                <option value="">Todos los clientes ({clients.length})</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              {[...byClient.entries()].map(([clientId, rows]) => (
                <section key={clientId} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                  <p className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 font-medium text-slate-800 dark:text-slate-100">
                    {rows[0].client.name}
                  </p>
                  <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                    {rows.map((r) => {
                      const unit = r.items[0]?.product.unit ?? "kg";
                      return (
                        <li key={r.dispatchId} className="px-4 py-3 space-y-2">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="text-sm text-slate-800 dark:text-slate-100">
                                {r.items.map((i) => i.product.name).join(", ")}{" "}
                                <span className="text-slate-500 dark:text-slate-400">({r.items.map((i) => i.product.sku).join(", ")})</span>
                              </p>
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                <Link to={`/produccion/ordenes/${r.productionOrder.id}`} className="text-sky-700 dark:text-sky-400 hover:underline">
                                  {r.productionOrder.orderNumber}
                                </Link>
                                {r.productionOrder.station && ` · ${STATION_LABELS[r.productionOrder.station as OpStation]}`} · aprobada en Calidad el{" "}
                                {fecha(r.approvedAt)}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="inline-flex items-center gap-1 font-semibold text-slate-800 dark:text-slate-100">
                                <Lock size={13} aria-hidden="true" /> {r.reservedQuantity} {unit}
                              </p>
                              <p className="text-xs">
                                <Link to="/despachos" className="inline-flex items-center gap-1 text-sky-700 dark:text-sky-400 hover:underline">
                                  <Truck size={12} aria-hidden="true" /> Despacho #{r.dispatchId}
                                  {r.status === "en_proceso" ? " (en proceso)" : " (pendiente)"}
                                </Link>
                              </p>
                            </div>
                          </div>
                          {r.rolls.length > 0 && (
                            <ul className="flex flex-wrap gap-1.5" aria-label={`Rollos de ${r.productionOrder.orderNumber}`}>
                              {r.rolls.map((roll) => (
                                <li
                                  key={roll.id}
                                  className="text-xs rounded border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-slate-700 dark:text-slate-200"
                                >
                                  <strong>{roll.code}</strong> · {roll.weightKg} kg
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </>
          );
        }}
      </AsyncState>
    </div>
  );
}
