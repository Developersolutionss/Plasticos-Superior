import { Laptop, Moon, Sun } from "lucide-react";
import { useTheme, type ThemePreference } from "../theme/ThemeContext";

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Oscuro", icon: Moon },
  { value: "system", label: "Sistema", icon: Laptop },
];

export default function Apariencia() {
  const { preference, setPreference } = useTheme();

  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Apariencia</h1>

      <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 space-y-3">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Tema de la interfaz</p>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          "Sistema" sigue el modo claro/oscuro configurado en tu computadora o celular, y cambia solo si vos lo
          cambiás ahí.
        </p>
        <div className="grid grid-cols-3 gap-2">
          {OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setPreference(value)}
              className={`flex flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-sm transition-colors ${
                preference === value
                  ? "border-sky-500 bg-sky-50 text-sky-700 dark:border-sky-500 dark:bg-sky-950 dark:text-sky-400"
                  : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              <Icon size={18} strokeWidth={2} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
