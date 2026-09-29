import { useState } from "react";

/**
 * Una fuente de sugerencia aplicable (manual, por frecuencia, etc.). `detail`
 * es el resumen legible de lo que se va a aplicar (ej. "Medida 1.20 x 30 · 45
 * kg" o "Color: Negro, Ancho: 30").
 */
export interface SuggestionSourceItem {
  key: string;
  label: string;
  detail: string;
  onApply: () => void;
  /** Solo las manuales se pueden borrar -- las calculadas por frecuencia no. */
  onRemove?: () => void;
}

/**
 * Muestra varias fuentes de sugerencia a la vez sin mezclarlas (ej. la que un
 * usuario con permiso cargó a mano y la que el sistema calculó por
 * frecuencia de pedidos) -- la primera queda visible, el resto bajo un menú
 * "+N más" para no llenar la pantalla si en el futuro se suman más fuentes.
 */
export function SuggestionSources({ items }: { items: SuggestionSourceItem[] }) {
  const [menuOpen, setMenuOpen] = useState(false);
  if (items.length === 0) return null;
  const [primary, ...rest] = items;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded px-3 py-2">
      <span className="text-slate-500 dark:text-slate-400 shrink-0">{primary.label}:</span>
      <button
        type="button"
        onClick={primary.onApply}
        className="border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 rounded-full px-2.5 py-1 hover:bg-emerald-50 dark:hover:bg-emerald-950"
      >
        {primary.detail}
      </button>
      {primary.onRemove && (
        <button type="button" onClick={primary.onRemove} className="text-red-600 dark:text-red-400 hover:underline shrink-0">
          Quitar
        </button>
      )}
      <span className="grow" />
      {rest.length > 0 && (
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="text-slate-500 dark:text-slate-400 hover:underline"
          >
            +{rest.length} más ▾
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 mt-1 z-20 w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded shadow-lg p-2 space-y-2">
                {rest.map((item) => (
                  <div key={item.key} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-slate-500 dark:text-slate-400">{item.label}</p>
                      <p className="text-slate-800 dark:text-slate-100 truncate" title={item.detail}>
                        {item.detail}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          item.onApply();
                          setMenuOpen(false);
                        }}
                        className="border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 rounded px-2 py-1"
                      >
                        Usar
                      </button>
                      {item.onRemove && (
                        <button
                          type="button"
                          onClick={() => {
                            item.onRemove!();
                            setMenuOpen(false);
                          }}
                          className="text-red-600 dark:text-red-400 hover:underline"
                        >
                          Quitar
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
