import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { api } from "../api/client";

/** Página a la que apunta el QR impreso de cada ubicación (Almacen.tsx).
 * Ruta pública (App.tsx: `/qr/:token`, fuera de <Layout>/RequireAuth) — el
 * token es la única "credencial", así que cualquiera con el link exacto ve
 * el stock de ESA ubicación sin loguearse y sin poder navegar al resto de
 * la app. Se refresca sola cada 5s, sin necesidad de tocar nada. */
export default function UbicacionDetalle() {
  const { token } = useParams<{ token: string }>();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["publicLocation", token],
    queryFn: () => api.getPublicLocation(token!),
    enabled: !!token,
    refetchInterval: 5000,
  });

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-800 p-4">
      <div className="max-w-md mx-auto space-y-4 pt-6">
        {isLoading && <p className="text-slate-500 dark:text-slate-400 text-center py-10">Cargando...</p>}
        {!isLoading && (isError || !data) && (
          <p className="text-red-600 dark:text-red-400 text-center py-10">No se encontró esta ubicación.</p>
        )}

        {!isLoading && data && (
          <>
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5 text-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Ubicación</p>
              <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mt-1">{data.location.code}</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">{data.location.label}</p>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 dark:border-slate-700">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Stock en esta ubicación</p>
                <span className="flex items-center gap-1 text-xs text-slate-400 dark:text-slate-400">
                  <RefreshCw size={12} strokeWidth={2} aria-hidden="true" />
                  en vivo
                </span>
              </div>
              <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                {data.items.map((item) => (
                  <li key={item.productId} className="flex items-center justify-between px-5 py-4">
                    <div>
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{item.name}</p>
                      <p className="text-xs text-slate-400 dark:text-slate-400">{item.sku}</p>
                    </div>
                    <p className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                      {item.quantity} <span className="text-sm font-normal text-slate-500 dark:text-slate-400">{item.unit}</span>
                    </p>
                  </li>
                ))}
                {data.items.length === 0 && (
                  <li className="px-5 py-8 text-center text-slate-500 dark:text-slate-400 text-sm">Esta ubicación está vacía.</li>
                )}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
