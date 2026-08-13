import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { VENTAS } from "../components/navConfig";

export default function Dispatches() {
  const [clientId, setClientId] = useState<string>("");
  const [status, setStatus] = useState<string>("pendiente");
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const canReadClients = !!user && VENTAS.includes(user.role);
  const { data: clients } = useQuery({
    queryKey: ["clients"],
    queryFn: api.getClients,
    enabled: canReadClients,
  });
  const { data: dispatches, isLoading } = useQuery({
    queryKey: ["dispatches", clientId, status],
    queryFn: () => api.getDispatches({ clientId: clientId ? Number(clientId) : undefined, status: status || undefined }),
  });

  async function markDispatched(dispatchId: number, itemId: number, quantityRequested: number) {
    await api.markItemDispatched(dispatchId, itemId, quantityRequested);
    queryClient.invalidateQueries({ queryKey: ["dispatches"] });
    queryClient.invalidateQueries({ queryKey: ["inventory"] });
    queryClient.invalidateQueries({ queryKey: ["alerts"] });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        {canReadClients && (
          <select className="border rounded px-3 py-2" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Todos los clientes</option>
            {clients?.map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <select className="border rounded px-3 py-2" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="pendiente">Pendiente</option>
          <option value="en_proceso">En proceso</option>
          <option value="despachado">Despachado</option>
        </select>
      </div>

      {isLoading && <p className="text-slate-500">Cargando...</p>}

      <div className="space-y-3">
        {dispatches?.map((d: any) => (
          <div key={d.id} className="bg-white rounded-lg shadow p-4">
            <div className="flex flex-wrap justify-between items-center gap-1 mb-2">
              <span className="font-medium">
                Pedido #{d.id} - {d.client.name}
              </span>
              <span className="text-xs uppercase tracking-wide text-slate-500">{d.status}</span>
            </div>
            <ul className="space-y-2">
              {d.items.map((item: any) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm border-t pt-2"
                >
                  <span>
                    {item.product.name} — solicitado: {item.quantityRequested} {item.product.unit}
                    {item.quantityDispatched != null && ` · despachado: ${item.quantityDispatched}`}
                  </span>
                  {item.quantityDispatched == null && (
                    <button
                      className="bg-emerald-600 text-white text-xs px-3 py-1.5 rounded"
                      onClick={() => markDispatched(d.id, item.id, Number(item.quantityRequested))}
                    >
                      Marcar despachado
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {dispatches?.length === 0 && <p className="text-slate-500">No hay despachos para este filtro.</p>}
      </div>
    </div>
  );
}
