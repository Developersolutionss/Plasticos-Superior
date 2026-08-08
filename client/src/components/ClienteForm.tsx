import { FormEvent, useRef, useState } from "react";
import { api } from "../api/client";
import ClienteAvatar from "./ClienteAvatar";

interface ClienteFormProps {
  /** Cliente a editar. Si viene `null`/`undefined`, el formulario crea uno nuevo. */
  client?: any;
  onSaved: (client: any) => void;
  onCancel?: () => void;
}

function contactInfoValue(client: any, key: string) {
  return (client?.contactInfo as Record<string, string> | null | undefined)?.[key] ?? "";
}

/** Formulario único para crear y editar clientes (incluye la foto de perfil).
 * Se usa como página dedicada en /clientes/nuevo y como modal al editar. */
export default function ClienteForm({ client, onSaved, onCancel }: ClienteFormProps) {
  const isEdit = Boolean(client);

  const [name, setName] = useState(client?.name ?? "");
  const [contactInfo, setContactInfo] = useState({
    email: contactInfoValue(client, "email"),
    phone: contactInfoValue(client, "phone"),
    notes: contactInfoValue(client, "notes"),
  });
  const [creditLimit, setCreditLimit] = useState(client?.creditLimit != null ? String(client.creditLimit) : "");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(client?.avatarUrl ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleAvatarChange(file: File | undefined) {
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("El nombre del cliente es obligatorio.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        contactInfo: {
          email: contactInfo.email.trim() || undefined,
          phone: contactInfo.phone.trim() || undefined,
          notes: contactInfo.notes.trim() || undefined,
        },
        creditLimit: creditLimit !== "" ? Number(creditLimit) : undefined,
      };

      let savedClient: any;
      if (isEdit) {
        savedClient = await api.updateClient(client.id, payload);
      } else {
        savedClient = await api.createClient(payload.name);
        await api.updateClient(savedClient.id, { contactInfo: payload.contactInfo, creditLimit: payload.creditLimit });
      }

      if (avatarFile) {
        savedClient = await api.uploadClientAvatar(savedClient.id, avatarFile);
      }

      onSaved(savedClient);
    } catch {
      setError("No se pudo guardar el cliente. Revisá los datos e intentá de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  const inputClass = "w-full border rounded px-3 py-2 text-sm";
  const labelClass = "block text-xs text-slate-500 mb-1";

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="flex items-center gap-4">
        <ClienteAvatar name={name || client?.name || "?"} avatarUrl={avatarPreview} size={64} />
        <div className="space-y-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="text-xs"
            onChange={(e) => handleAvatarChange(e.target.files?.[0])}
          />
          <p className="text-xs text-slate-400">JPG, PNG o WEBP · máx 2 MB</p>
        </div>
      </div>

      <div>
        <label className={labelClass}>Nombre</label>
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Razón social o nombre del cliente" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Email</label>
          <input
            className={inputClass}
            type="email"
            value={contactInfo.email}
            onChange={(e) => setContactInfo({ ...contactInfo, email: e.target.value })}
            placeholder="contacto@empresa.com"
          />
        </div>
        <div>
          <label className={labelClass}>Teléfono</label>
          <input
            className={inputClass}
            value={contactInfo.phone}
            onChange={(e) => setContactInfo({ ...contactInfo, phone: e.target.value })}
            placeholder="+57 ..."
          />
        </div>
      </div>

      <div>
        <label className={labelClass}>Límite de crédito (COP)</label>
        <input
          className={inputClass}
          type="number"
          min={0}
          value={creditLimit}
          onChange={(e) => setCreditLimit(e.target.value)}
          placeholder="0"
        />
      </div>

      <div>
        <label className={labelClass}>Notas</label>
        <textarea
          className={inputClass}
          rows={2}
          value={contactInfo.notes}
          onChange={(e) => setContactInfo({ ...contactInfo, notes: e.target.value })}
          placeholder="Observaciones internas"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <button
          className="bg-slate-800 text-white text-sm px-4 py-2 rounded disabled:opacity-50"
          type="submit"
          disabled={saving}
        >
          {saving ? "Guardando..." : isEdit ? "Guardar cambios" : "Crear cliente"}
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