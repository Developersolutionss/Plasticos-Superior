import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";

export default function Planeacion() {
  const [error, setError] = useState<string | null>(null);
  const [creatingId, setCreatingId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const { data: pending, isLoading } = useQuery({ queryKey: ["pendingPlanning"], queryFn: api.getPendingPlanning });

  async function handleGenerate(pedidoVersionItemId: number) {
    setError(null);
    setCreatingId(pedidoVersionItemId);
    try {
      await api.createProductionOrderFromPedidoItem(pedidoVersionItemId);
      queryClient.invalidateQueries({ queryKey: ["pendingPlanning"] });
      queryClient.invalidateQueries({ queryKey: ["productionOrders"] });
    } catch {
      setError("No se pudo generar la OP");
    } finally {
      setCreatingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Planeación</h1>
        <p className="text-sm text-slate-500">Pedidos aprobados listos para generar su orden de producción</p>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {isLoading && <div className="bg-white rounded-lg shadow p-4 text-center text-slate-500 text-sm">Cargando...</div>}
      {!isLoading && pending?.length === 0 && (
        <div className="bg-white rounded-lg shadow p-4 text-center text-slate-500 text-sm">
          No hay pedidos pendientes de generar orden de producción.
        </div>
      )}

      {!isLoading && pending && pending.length > 0 && (
        <>
          <div className="hidden md:block bg-white rounded-lg shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-left">
                <tr>
                  <th className="p-3">Pedido</th>
                  <th className="p-3">Cliente</th>
                  <th className="p-3">Producto</th>
                  <th className="p-3">Cantidad</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {pending.map((item: any) => (
                  <tr key={item.pedidoVersionItemId} className="border-t">
                    <td className="p-3 font-medium">{item.pedidoOrderNumber}</td>
                    <td className="p-3">{item.clientName}</td>
                    <td className="p-3">
                      {item.productName} ({item.productSku})
                    </td>
                    <td className="p-3">
                      {item.quantity} {item.measure ? `· ${item.measure}` : ""}
                    </td>
                    <td className="p-3 text-right">
                      <button
                        className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
                        type="button"
                        disabled={creatingId === item.pedidoVersionItemId}
                        onClick={() => handleGenerate(item.pedidoVersionItemId)}
                      >
                        {creatingId === item.pedidoVersionItemId ? "Generando..." : "Generar OP"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden bg-white rounded-lg shadow divide-y divide-slate-100">
            {pending.map((item: any) => (
              <div key={item.pedidoVersionItemId} className="p-4 space-y-2">
                <p className="font-medium text-slate-800">{item.pedidoOrderNumber}</p>
                <p className="text-sm text-slate-600">{item.clientName}</p>
                <p className="text-sm text-slate-500">
                  {item.productName} ({item.productSku}) — {item.quantity} {item.measure ? `· ${item.measure}` : ""}
                </p>
                <button
                  className="w-full bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium px-3 py-2 rounded-md transition-colors disabled:opacity-50"
                  type="button"
                  disabled={creatingId === item.pedidoVersionItemId}
                  onClick={() => handleGenerate(item.pedidoVersionItemId)}
                >
                  {creatingId === item.pedidoVersionItemId ? "Generando..." : "Generar OP"}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
