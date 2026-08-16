import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";

const MOVEMENT_TYPES = ["entrada_produccion", "salida_despacho", "ajuste", "devolucion"];

const MOVEMENT_LABELS: Record<string, string> = {
  entrada_produccion: "Entrada por producción",
  salida_despacho: "Salida por despacho",
  ajuste: "Ajuste",
  devolucion: "Devolución",
};

const MOVEMENT_COLORS: Record<string, string> = {
  entrada_produccion: "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400",
  salida_despacho: "bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-400",
  ajuste: "bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-400",
  devolucion: "bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400",
};

const ENTRADAS = new Set(["entrada_produccion", "devolucion"]);

const PAGE_SIZE = 50;

function MovementBadge({ type }: { type: string }) {
  return (
    <span className={`text-xs rounded-full px-2 py-1 ${MOVEMENT_COLORS[type] ?? "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200"}`}>
      {MOVEMENT_LABELS[type] ?? type}
    </span>
  );
}

function MovementQuantity({ movement }: { movement: any }) {
  const isEntrada = ENTRADAS.has(movement.movementType);
  return (
    <span className={isEntrada ? "text-emerald-700 dark:text-emerald-400 font-medium" : "text-red-700 dark:text-red-400 font-medium"}>
      {isEntrada ? "+" : "−"}
      {Math.abs(Number(movement.quantity))} {movement.product?.unit}
    </span>
  );
}

export default function Movimientos() {
  const [movementType, setMovementType] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["inventoryMovements", movementType, page],
    queryFn: () => api.getInventoryMovements({ movementType: movementType || undefined, page, pageSize: PAGE_SIZE }),
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Movimientos de inventario</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Historial de entradas y salidas de stock</p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4">
        <select
          className="border rounded px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          value={movementType}
          onChange={(e) => {
            setMovementType(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Todos los tipos</option>
          {MOVEMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {MOVEMENT_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      {isLoading && <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 text-center text-slate-500 dark:text-slate-400 text-sm">Cargando...</div>}
      {!isLoading && data?.items.length === 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 text-center text-slate-500 dark:text-slate-400 text-sm">Sin movimientos todavía.</div>
      )}

      {!isLoading && data && data.items.length > 0 && (
        <>
          <div className="hidden md:block bg-white dark:bg-slate-900 rounded-lg shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 dark:bg-slate-800 text-left">
                <tr>
                  <th className="p-3">Producto</th>
                  <th className="p-3">Tipo</th>
                  <th className="p-3">Cantidad</th>
                  <th className="p-3">Usuario</th>
                  <th className="p-3">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((m: any) => (
                  <tr key={m.id} className="border-t">
                    <td className="p-3">
                      {m.product?.name} <span className="text-slate-400 dark:text-slate-400">({m.product?.sku})</span>
                    </td>
                    <td className="p-3">
                      <MovementBadge type={m.movementType} />
                    </td>
                    <td className="p-3">
                      <MovementQuantity movement={m} />
                    </td>
                    <td className="p-3 text-slate-500 dark:text-slate-400">{m.createdBy?.name ?? "—"}</td>
                    <td className="p-3 text-slate-500 dark:text-slate-400">{new Date(m.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden bg-white dark:bg-slate-900 rounded-lg shadow divide-y divide-slate-100 dark:divide-slate-700">
            {data.items.map((m: any) => (
              <div key={m.id} className="p-4 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-slate-800 dark:text-slate-100">
                    {m.product?.name} <span className="text-slate-400 dark:text-slate-400 font-normal">({m.product?.sku})</span>
                  </p>
                  <MovementBadge type={m.movementType} />
                </div>
                <div className="flex items-center justify-between text-sm">
                  <MovementQuantity movement={m} />
                  <span className="text-slate-500 dark:text-slate-400">{m.createdBy?.name ?? "—"}</span>
                </div>
                <p className="text-xs text-slate-400 dark:text-slate-400">{new Date(m.createdAt).toLocaleString()}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {data && data.total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm">
          <button
            className="px-3 py-1.5 border rounded disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Anterior
          </button>
          <span className="text-slate-500 dark:text-slate-400">
            Página {page} de {totalPages}
          </span>
          <button
            className="px-3 py-1.5 border rounded disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}
