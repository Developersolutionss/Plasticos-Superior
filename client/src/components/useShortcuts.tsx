import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { buildChoices, type NavChoice } from "./navConfig";
import { useAuth } from "../auth/AuthContext";
import type { UserRole } from "../auth/AuthContext";

const STORAGE_KEY = "ps_shortcuts";

interface ShortcutsContextValue {
  /** ítems elegidos como atajos, en orden de selección */
  atajos: NavChoice[];
  isActive: (id: string) => boolean;
  toggle: (id: string) => void;
  clearAll: () => void;
}

const ShortcutsContext = createContext<ShortcutsContextValue | null>(null);

function load(role: UserRole | undefined): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw || !role) return [];
    const parsed = JSON.parse(raw);
    const valid = new Set(buildChoices(role).map((c) => c.id));
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string" && valid.has(id)) : [];
  } catch {
    return [];
  }
}

export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [ids, setIds] = useState<string[]>(() => load(user?.role));

  useEffect(() => {
    setIds(load(user?.role));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    } catch {
      /* almacenamiento no disponible: no rompe la UI */
    }
  }, [ids]);

  const toggle = useCallback((id: string) => {
    setIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const clearAll = useCallback(() => setIds([]), []);

  const value = useMemo<ShortcutsContextValue>(() => {
    const byId = new Map(buildChoices(user?.role ?? "auditor").map((c) => [c.id, c]));
    const atajos = ids
      .map((id) => byId.get(id))
      .filter((c): c is NavChoice => Boolean(c));
    return {
      atajos,
      isActive: (id) => ids.includes(id),
      toggle,
      clearAll,
    };
  }, [ids, toggle, clearAll, user?.role]);

  return <ShortcutsContext.Provider value={value}>{children}</ShortcutsContext.Provider>;
}

export function useShortcuts(): ShortcutsContextValue {
  const ctx = useContext(ShortcutsContext);
  if (!ctx) throw new Error("useShortcuts debe usarse dentro de <ShortcutsProvider>");
  return ctx;
}