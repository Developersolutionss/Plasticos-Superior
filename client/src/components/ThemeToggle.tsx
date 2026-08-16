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
      className="relative w-8 h-8 flex items-center justify-center rounded-full text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800 transition-[color,background-color,transform] duration-200 active:scale-90"
      title={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
    >
      <Sun
        size={18}
        strokeWidth={2}
        aria-hidden="true"
        className={`absolute transition-all duration-500 ease-out ${
          isDark ? "rotate-0 scale-100 opacity-100" : "rotate-90 scale-0 opacity-0"
        }`}
      />
      <Moon
        size={18}
        strokeWidth={2}
        aria-hidden="true"
        className={`absolute transition-all duration-500 ease-out ${
          isDark ? "-rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100"
        }`}
      />
    </button>
  );
}
