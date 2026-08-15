import { FormEvent, useState } from "react";
import { api } from "../api/client";

interface UsuarioFormProps {
  /** Usuario a editar. Si viene `null`/`undefined`, el formulario crea uno nuevo. */
  user?: any;
  onSaved: (user: any) => void;
  onCancel?: () => void;
}

const ROLES: { value: string; label: string }[] = [
  { value: "super_admin", label: "Super Admin" },
  { value: "admin", label: "Admin" },
  { value: "gerente_produccion", label: "Gerente de Producción" },
  { value: "planeacion", label: "Planeación" },
  { value: "ventas_pedidos", label: "Ventas / Pedidos" },
  { value: "operario_extrusion", label: "Operario Extrusión" },
  { value: "operario_impresion", label: "Operario Impresión" },
  { value: "operario_sellado_precorte", label: "Operario Sellado/Precorte" },
  { value: "calidad", label: "Calidad" },
  { value: "almacen_despachos", label: "Almacén / Despachos" },
  { value: "auditor", label: "Auditor" },
];

/** Formulario único para crear y editar usuarios. Se usa como modal desde
 * Configuración → Usuarios y permisos. */
export default function UsuarioForm({ user, onSaved, onCancel }: UsuarioFormProps) {
  const isEdit = Boolean(user);

  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState(user?.role ?? ROLES[0].value);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !email.trim()) {
      setError("El nombre y el email son obligatorios.");
      return;
    }
    if (!isEdit && password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (isEdit && password && password.length < 8) {
      setError("La nueva contraseña debe tener al menos 8 caracteres.");
      return;
    }
    setSaving(true);
    try {
      const saved = isEdit
        ? await api.updateUser(user.id, { name: name.trim(), email: email.trim(), role, ...(password ? { password } : {}) })
        : await api.createUser({ name: name.trim(), email: email.trim(), role, password });
      onSaved(saved);
    } catch (err: any) {
      setError(err?.message?.includes("email") ? "Ya existe un usuario con ese email." : "No se pudo guardar el usuario. Revisá los datos e intentá de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm dark:bg-slate-800 dark:text-slate-100";
  const labelClass = "block text-xs text-slate-500 dark:text-slate-400 mb-1";

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}

      <div>
        <label className={labelClass}>Nombre</label>
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre completo" />
      </div>

      <div>
        <label className={labelClass}>Email</label>
        <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="usuario@empresa.com" />
      </div>

      <div>
        <label className={labelClass}>Rol</label>
        <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelClass}>{isEdit ? "Nueva contraseña (opcional)" : "Contraseña"}</label>
        <input
          className={inputClass}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={isEdit ? "Dejar en blanco para no cambiarla" : "Mínimo 8 caracteres"}
        />
      </div>

      <div className="flex gap-2 pt-1">
        <button
          className="bg-slate-800 text-white text-sm px-4 py-2 rounded disabled:opacity-50"
          type="submit"
          disabled={saving}
        >
          {saving ? "Guardando..." : isEdit ? "Guardar cambios" : "Crear usuario"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-sm px-4 py-2 rounded border">
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
