import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";

export type ThemePreference = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

/** La preferencia se guarda por usuario (no una sola key global) — en un
 * dispositivo compartido de planta, cada quien puede tener su propio modo
 * sin pisar al anterior que usó la sesión. "anon" es la key antes de
 * loguearse (pantalla de login). Mismo criterio que ps_shortcuts. */
function storageKey(userId: number | undefined) {
  return `ps_theme:${userId ?? "anon"}`;
}

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function loadPreference(userId: number | undefined): ThemePreference {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
  } catch {
    return "system";
  }
}

function resolve(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? (systemPrefersDark() ? "dark" : "light") : preference;
}

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (p: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [preference, setPreferenceState] = useState<ThemePreference>(() => loadPreference(user?.id));
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(preference));

  // Al loguearse/desloguearse (cambia el usuario), recarga la preferencia
  // de ESE usuario en vez de seguir con la del anterior.
  useEffect(() => {
    setPreferenceState(loadPreference(user?.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(user?.id), preference);
    } catch {
      /* almacenamiento no disponible: no rompe la UI */
    }
    setResolved(resolve(preference));
  }, [preference, user?.id]);

  // Si la preferencia es "system", reacciona en vivo a cambios del SO
  // (sin esto, alguien que dejó la preferencia en "system" y cambia el modo
  // de su sistema operativo tendría que recargar la página para verlo).
  useEffect(() => {
    if (preference !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolved(systemPrefersDark() ? "dark" : "light");
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [preference]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [resolved]);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, setPreference: setPreferenceState }),
    [preference, resolved]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme debe usarse dentro de <ThemeProvider>");
  return ctx;
}
