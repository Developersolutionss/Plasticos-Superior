import { ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

/** Generaliza el único patrón de carga/error/vacío ya "correcto" que había
 * en el repo (UbicacionDetalle.tsx) a un wrapper reusable, en vez de que
 * cada página repita a mano su propio `{isLoading && ...}` (así era antes
 * — 30 páginas, 30 variantes ligeramente distintas, y solo 1 revisaba
 * `isError`). */
type AsyncQuery<T> = {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
};

export default function AsyncState<T>({
  query,
  skeleton,
  isEmpty,
  emptyMessage = "Sin resultados.",
  errorMessage = "No se pudieron cargar los datos.",
  children,
}: {
  query: AsyncQuery<T>;
  skeleton: ReactNode;
  isEmpty?: (data: T) => boolean;
  emptyMessage?: string;
  errorMessage?: string;
  children: (data: T) => ReactNode;
}) {
  const { data, isLoading, isError, refetch } = query;

  if (isLoading) return <>{skeleton}</>;

  if (isError || data === undefined) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 text-center p-6 bg-white dark:bg-slate-900 rounded-lg shadow">
        <AlertTriangle size={22} className="text-red-500" aria-hidden="true" />
        <p className="text-red-600 dark:text-red-400 text-sm">{errorMessage}</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="inline-flex items-center gap-1.5 bg-slate-800 text-white text-sm px-4 py-2 rounded hover:bg-slate-700"
        >
          <RotateCcw size={14} aria-hidden="true" /> Reintentar
        </button>
      </div>
    );
  }

  const empty = isEmpty ? isEmpty(data) : Array.isArray(data) && data.length === 0;
  if (empty) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 text-center text-sm text-slate-500 dark:text-slate-400">
        {emptyMessage}
      </div>
    );
  }

  return <>{children(data)}</>;
}
