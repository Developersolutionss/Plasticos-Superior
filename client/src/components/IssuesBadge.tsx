import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";

const PANEL_WIDTH = 300;
const GAP = 6;
const MARGIN = 8;

/**
 * Etiqueta "Revisar (n)" del catálogo con un recuadro que explica qué no
 * cuadra. Reemplaza el `title` nativo (feo, chico y que no se ve en el
 * celular): se abre al pasar el mouse o al tocar, y se cierra al salir,
 * tocar afuera, con Escape o al hacer scroll.
 *
 * El recuadro va en un portal con posición fija para que no lo corte el
 * `overflow-hidden` de la tarjeta de la tabla (las últimas filas).
 */
export default function IssuesBadge({ issues }: { issues: string[] }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    setPinned(false);
  };

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const width = Math.min(PANEL_WIDTH, window.innerWidth - 2 * MARGIN);
    const left = Math.max(MARGIN, Math.min(rect.left, window.innerWidth - width - MARGIN));
    const panelHeight = panelRef.current?.offsetHeight ?? 160;
    const fitsBelow = rect.bottom + GAP + panelHeight <= window.innerHeight - MARGIN;
    setStyle(
      fitsBelow
        ? { position: "fixed", top: rect.bottom + GAP, left, width }
        : { position: "fixed", bottom: window.innerHeight - rect.top + GAP, left, width }
    );
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (!buttonRef.current?.contains(target) && !panelRef.current?.contains(target)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  if (issues.length === 0) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-label={`Revisar: ${issues.length} ${issues.length === 1 ? "dato no cuadra" : "datos no cuadran"}`}
        className="ml-2 text-xs font-medium text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-950 hover:bg-amber-200 dark:hover:bg-amber-900 px-2 py-0.5 rounded-full whitespace-nowrap align-middle"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => !pinned && setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => !pinned && setOpen(false)}
        onClick={() => {
          // Tocar fija el recuadro (celular); volver a tocar lo cierra.
          if (pinned) close();
          else {
            setOpen(true);
            setPinned(true);
          }
        }}
      >
        Revisar ({issues.length})
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="tooltip"
            style={style}
            className="z-50 rounded-lg border border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-800 shadow-lg p-3 text-left"
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => !pinned && setOpen(false)}
          >
            <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-300 mb-1.5">
              <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" />
              {issues.length === 1 ? "Hay un dato que revisar" : `Hay ${issues.length} datos que revisar`}
            </p>
            <ul className="space-y-1 text-sm font-normal text-slate-700 dark:text-slate-200 list-disc pl-5">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">No impide usar el producto. Para corregirlo, abrí Editar.</p>
          </div>,
          document.body
        )}
    </>
  );
}
