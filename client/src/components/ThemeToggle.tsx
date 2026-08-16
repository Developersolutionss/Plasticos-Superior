import { Moon, Sun } from "lucide-react";
import { useTheme } from "../theme/ThemeContext";

/** Toggle rápido de un clic (claro/oscuro) para el header. El control con
 * las 3 opciones (Claro/Oscuro/Sistema) vive en la pantalla de
 * Configuración → Apariencia. Muestra el ícono del modo al que cambiaría. */
export default function ThemeToggle() {
  const { resolved, setPreference } = useTheme();
  const isDark = resolved === "dark";

  return (
    <button
      type="button"
      onClick={() => setPreference(isDark ? "light" : "dark")}
      className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 dark:text-slate-400 dark:hover:text-slate-200 p-1"
      title={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
    >
      {isDark ? <Sun size={18} strokeWidth={2} aria-hidden="true" /> : <Moon size={18} strokeWidth={2} aria-hidden="true" />}
    </button>
  );
}
