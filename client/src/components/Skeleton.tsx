/** Primitivas de esqueleto de carga — reusan la paleta ya establecida en el
 * resto de la app (bg-slate-200/700, tarjetas bg-white/slate-900) en vez de
 * inventar un lenguaje visual nuevo. */
export function SkeletonLine({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-slate-200 dark:bg-slate-700 rounded ${className}`} />;
}

export function SkeletonRows({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 space-y-3">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4">
          {Array.from({ length: cols }).map((_, c) => (
            <SkeletonLine key={c} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 space-y-3">
      <SkeletonLine className="h-4 w-1/3" />
      <SkeletonLine className="h-8 w-1/2" />
    </div>
  );
}
