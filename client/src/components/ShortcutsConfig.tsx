import { useEffect, useRef } from "react";
import { buildChoices } from "./navConfig";
import { useShortcuts } from "./useShortcuts";

export default function ShortcutsConfig({ onClose }: { onClose: () => void }) {
  const { isActive, toggle, clearAll } = useShortcuts();
  const choices = buildChoices();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const groups = new Map<string, typeof choices>();
  for (const c of choices) {
    groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
  }

  return (
    <div
      className="sc-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sc-title"
      onClick={onClose}
    >
      <div className="sc-panel" onClick={(e) => e.stopPropagation()}>
        <div className="sc-header">
          <h3 id="sc-title">🛠️ Ajustar los Atajos</h3>
          <button className="sc-close" type="button" ref={closeRef} onClick={onClose} title="Cerrar">
            ✕
          </button>
        </div>

        <div className="sc-body">
          <p className="sc-hint">
            Marca los ítems del menú que quieres tener como accesos directos en "⚡ Atajos".
          </p>
          {[...groups.entries()].map(([group, items]) => (
            <div className="sc-group" key={group}>
              <div className="sc-group-label">{group}</div>
              {items.map((item) => (
                <label key={item.id} className={`sc-row ${item.disabled ? "disabled" : ""}`}>
                  <input
                    type="checkbox"
                    checked={isActive(item.id)}
                    onChange={() => toggle(item.id)}
                    disabled={item.disabled}
                  />
                  <span className="sc-label">{item.label}</span>
                  {item.disabled && <span className="sc-soon">Próximamente</span>}
                </label>
              ))}
            </div>
          ))}
        </div>

        <div className="sc-footer">
          <button className="sc-btn sc-btn-ghost" type="button" onClick={clearAll}>
            Quitar todos
          </button>
          <button className="sc-btn sc-btn-primary" type="button" onClick={onClose}>
            Hecho
          </button>
        </div>
      </div>
    </div>
  );
}