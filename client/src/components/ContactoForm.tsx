import { FormEvent, useState } from "react";

export interface ContactoFormValues {
  name: string;
  position?: string;
  phone?: string;
  email?: string;
  isPrimary?: boolean;
}

/** Formulario de contacto reutilizable para crear/editar (ficha y modal). */
export default function ContactoForm({
  initial,
  submitLabel = "Guardar",
  cancelLabel = "Cancelar",
  onCancel,
  onSubmit,
}: {
  initial?: Partial<ContactoFormValues>;
  submitLabel?: string;
  cancelLabel?: string;
  onCancel?: () => void;
  onSubmit: (data: ContactoFormValues) => void | Promise<void>;
}) {
  const [form, setForm] = useState<ContactoFormValues>({
    name: initial?.name ?? "",
    position: initial?.position ?? "",
    phone: initial?.phone ?? "",
    email: initial?.email ?? "",
    isPrimary: initial?.isPrimary ?? false,
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSubmit({
      name: form.name.trim(),
      position: form.position?.trim() ? form.position.trim() : undefined,
      phone: form.phone?.trim() ? form.phone.trim() : undefined,
      email: form.email?.trim() ? form.email.trim() : undefined,
      isPrimary: form.isPrimary,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input
          className="border rounded px-3 py-2 text-sm"
          placeholder="Nombre"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          className="border rounded px-3 py-2 text-sm"
          placeholder="Cargo"
          value={form.position}
          onChange={(e) => setForm({ ...form, position: e.target.value })}
        />
        <input
          className="border rounded px-3 py-2 text-sm"
          placeholder="Teléfono"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
        />
        <input
          className="border rounded px-3 py-2 text-sm"
          placeholder="Email"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={form.isPrimary}
          onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })}
        />
        Marcar como contacto principal
      </label>
      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-slate-600 text-sm px-3 py-2 rounded hover:bg-slate-100">
            {cancelLabel}
          </button>
        )}
        <button className="bg-slate-800 text-white text-sm px-4 py-2 rounded" type="submit">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}