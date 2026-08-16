import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import ClienteAvatar from "./ClienteAvatar";
import { byFrequency } from "../lib/frequency";

/** Cantidad fija de sugerencias del picker (compacto). */
const SLOTS = 4;

/**
 * Selector de cliente reutilizable con foto de perfil y búsqueda por
 * frecuencia:
 * - Campo vacío → 4 sugeridos por frecuencia (viewCount/lastViewedAt).
 * - A partir del 1er carácter → búsqueda por coincidencia (substring), top 4.
 * Muestra la pfp del cliente seleccionado y permite limpiar la selección.
 */
export default function ClientePicker({
  clients,
  value,
  onChange,
  placeholder = "Buscar cliente...",
}: {
  clients: any[];
  value: number | null;
  onChange: (clientId: number | null) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = clients.find((c) => c.id === value) ?? null;

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return [...clients]
        .sort(byFrequency((c) => c.viewCount, (c) => c.lastViewedAt))
        .slice(0, SLOTS);
    }
    return clients
      .filter((c) => c.name.toLowerCase().includes(q))
      .sort(byFrequency((c) => c.viewCount, (c) => c.lastViewedAt))
      .slice(0, SLOTS);
  }, [clients, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function pick(id: number) {
    onChange(id);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-center gap-2 border rounded px-2">
        {selected ? (
          <ClienteAvatar name={selected.name} avatarUrl={selected.avatarUrl} size={28} />
        ) : (
          <Search size={16} strokeWidth={2} className="text-slate-400 dark:text-slate-400 shrink-0" aria-hidden="true" />
        )}
        <input
          className="flex-1 py-2 text-sm outline-none min-w-0 dark:bg-slate-800 dark:text-slate-100"
          placeholder={selected ? selected.name : placeholder}
          value={open ? query : ""}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && options[0]) pick(options[0].id);
          }}
          aria-label="Buscar cliente"
        />
        {selected && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-slate-400 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-0.5"
            title="Quitar cliente"
            aria-label="Quitar cliente"
          >
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
        <ChevronDown size={16} strokeWidth={2} className={`text-slate-400 dark:text-slate-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white dark:bg-slate-900 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 py-1 z-30">
          {options.length === 0 && <p className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">Sin resultados.</p>}
          {options.map((c) => {
            const active = c.id === value;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => pick(c.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left ${active ? "bg-slate-100 dark:bg-slate-800" : "hover:bg-slate-50 dark:hover:bg-slate-800"}`}
              >
                <ClienteAvatar name={c.name} avatarUrl={c.avatarUrl} size={28} />
                <span className="flex-1 min-w-0 truncate">{c.name}</span>
                {active && <Check size={16} strokeWidth={2} className="text-sky-600 dark:text-sky-400 shrink-0" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
