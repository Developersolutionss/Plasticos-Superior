import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";

/** Componente de nivel de módulo (no anidado en Calidad): si se define
 * adentro, React crea una función nueva en cada render y remonta este
 * subárbol cada vez que cambia `observations` — es decir, en cada tecla
 * que se escribe en el motivo de rechazo, perdiendo el foco del textarea. */
function Actions({
  order,
  align,
  rejectingId,
  submittingId,
  observations,
  setObservations,
  setRejectingId,
  handleSubmit,
}: {
  order: any;
  align: "end" | "stretch";
  rejectingId: number | null;
  submittingId: number | null;
  observations: string;
  setObservations: (v: string) => void;
  setRejectingId: (id: number | null) => void;
  handleSubmit: (orderId: number, result: "aprobado" | "rechazado") => void;
}) {
  if (rejectingId === order.id) {
    return (
      <div className={`flex flex-col gap-2 ${align === "end" ? "items-end" : ""}`}>
        <textarea
          className="border rounded px-2 py-1 text-xs w-full sm:w-56"
          placeholder="Motivo del rechazo (opcional)"
          value={observations}
          onChange={(e) => setObservations(e.target.value)}
          rows={2}
        />
        <div className="flex gap-2">
          <button
            className="text-slate-500 hover:text-slate-700 text-xs px-2 py-1"
            type="button"
            onClick={() => {
              setRejectingId(null);
              setObservations("");
            }}
          >
            Cancelar
          </button>
          <button
            className="bg-red-600 hover:bg-red-700 text-white text-xs font-medium px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
            type="button"
            disabled={submittingId === order.id}
            onClick={() => handleSubmit(order.id, "rechazado")}
          >
            Confirmar rechazo
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className={`flex gap-2 ${align === "end" ? "justify-end" : ""}`}>
      <button
        className="border border-red-300 text-red-700 hover:bg-red-50 text-xs font-medium px-3 py-1.5 rounded-md transition-colors disabled:opacity-50 flex-1 sm:flex-none"
        type="button"
        disabled={submittingId === order.id}
        onClick={() => setRejectingId(order.id)}
      >
        Rechazar
      </button>
      <button
        className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-3 py-1.5 rounded-md transition-colors disabled:opacity-50 flex-1 sm:flex-none"
        type="button"
        disabled={submittingId === order.id}
        onClick={() => handleSubmit(order.id, "aprobado")}
      >
        {submittingId === order.id ? "Guardando..." : "Aprobar"}
      </button>
    </div>
  );
}

export default function Calidad() {
  const [error, setError] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<number | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [observations, setObservations] = useState("");
  const queryClient = useQueryClient();

  const { data: pending, isLoading } = useQuery({
    queryKey: ["productionOrders", "pendiente_calidad"],
    queryFn: () => api.getProductionOrders("pendiente_calidad"),
  });

  async function handleSubmit(orderId: number, result: "aprobado" | "rechazado") {
    setError(null);
    setSubmittingId(orderId);
    try {
      await api.submitQualityCheck(orderId, { result, observations: observations || undefined });
      setRejectingId(null);
      setObservations("");
      queryClient.invalidateQueries({ queryKey: ["productionOrders"] });
    } catch {
      setError("No se pudo registrar el control de calidad");
    } finally {
      setSubmittingId(null);
    }
  }

  function precorteKg(order: any) {
    const precorte = (order.stages ?? []).filter((s: any) => s.station === "precorte").at(-1);
    return precorte?.kilosProduced;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Calidad</h1>
        <p className="text-sm text-slate-500">Órdenes de producción que ya pasaron por precorte, pendientes de aprobar</p>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {isLoading && <div className="bg-white rounded-lg shadow p-4 text-center text-slate-500 text-sm">Cargando...</div>}
      {!isLoading && pending?.length === 0 && (
        <div className="bg-white rounded-lg shadow p-4 text-center text-slate-500 text-sm">
          No hay órdenes pendientes de control de calidad.
        </div>
      )}

      {!isLoading && pending && pending.length > 0 && (
        <>
          <div className="hidden md:block bg-white rounded-lg shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-left">
                <tr>
                  <th className="p-3">OP</th>
                  <th className="p-3">Producto</th>
                  <th className="p-3">Cant. planificada</th>
                  <th className="p-3">Kg en precorte</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {pending.map((order: any) => (
                  <tr key={order.id} className="border-t align-top">
                    <td className="p-3 font-medium">{order.orderNumber}</td>
                    <td className="p-3">{order.product.name}</td>
                    <td className="p-3">
                      {order.quantityPlanned} {order.product.unit}
                    </td>
                    <td className="p-3">{precorteKg(order) ?? "—"}</td>
                    <td className="p-3">
                      <Actions
                        order={order}
                        align="end"
                        rejectingId={rejectingId}
                        submittingId={submittingId}
                        observations={observations}
                        setObservations={setObservations}
                        setRejectingId={setRejectingId}
                        handleSubmit={handleSubmit}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden bg-white rounded-lg shadow divide-y divide-slate-100">
            {pending.map((order: any) => (
              <div key={order.id} className="p-4 space-y-3">
                <div>
                  <p className="font-medium text-slate-800">{order.orderNumber}</p>
                  <p className="text-sm text-slate-600">{order.product.name}</p>
                  <p className="text-sm text-slate-500">
                    Planificado: {order.quantityPlanned} {order.product.unit} · Precorte: {precorteKg(order) ?? "—"}
                  </p>
                </div>
                <Actions
                  order={order}
                  align="stretch"
                  rejectingId={rejectingId}
                  submittingId={submittingId}
                  observations={observations}
                  setObservations={setObservations}
                  setRejectingId={setRejectingId}
                  handleSubmit={handleSubmit}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
