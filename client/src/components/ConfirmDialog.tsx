import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" para acciones delicadas/irreversibles (cerrar, reabrir, borrar) — pinta el botón de confirmar en rojo. */
  tone?: "default" | "danger";
}

type ConfirmFn = (message: string, options?: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Reemplazo de `window.confirm` (el popup crudo del navegador, "localhost
 * dice...") por un diálogo con el mismo look del resto de la app. Misma API
 * por promesa que window.confirm — `if (!(await confirm("..."))) return;` —
 * para no tener que reescribir la lógica de cada lugar que lo usa. */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm debe usarse dentro de <ConfirmProvider>");
  return ctx;
}

interface PendingConfirm extends ConfirmOptions {
  message: string;
  resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback<ConfirmFn>((message, options) => {
    return new Promise<boolean>((resolve) => {
      setPending({ message, resolve, ...options });
    });
  }, []);

  function respond(value: boolean) {
    pending?.resolve(value);
    setPending(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => respond(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 space-y-2">
              {pending.title && <h3 className="font-semibold text-slate-800 dark:text-slate-100">{pending.title}</h3>}
              <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-line">{pending.message}</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 dark:border-slate-700 px-5 py-3">
              <button
                type="button"
                onClick={() => respond(false)}
                className="text-sm px-4 py-1.5 rounded border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                {pending.cancelLabel ?? "Cancelar"}
              </button>
              <button
                type="button"
                onClick={() => respond(true)}
                autoFocus
                className={`text-sm px-4 py-1.5 rounded text-white ${
                  pending.tone === "danger" ? "bg-red-600 hover:bg-red-500" : "bg-slate-800 hover:bg-slate-700"
                }`}
              >
                {pending.confirmLabel ?? "Aceptar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
