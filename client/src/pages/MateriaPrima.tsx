import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "../api/client";
import Modal from "../components/Modal";

const inputClass =
  "w-full border border-slate-300 dark:border-slate-600 rounded-md px-3 py-2 text-sm text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-500";

function RawMaterialForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: { code: string; name: string; minStock: string };
  onSubmit: (data: { code: string; name?: string; minStock: number }) => Promise<void>;
  onCancel: () => void;
}) {
  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [minStock, setMinStock] = useState(initial?.minStock ?? "0");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!code.trim()) {
      setError("El código es obligatorio (ej. ALTA, BAJA, PIGMENTO)");
      return;
    }
    setSaving(true);
    try {
      await onSubmit({ code: code.trim().toUpperCase(), name: name.trim() || undefined, minStock: Number(minStock) || 0 });
    } catch (err: any) {
      setError(err?.message?.includes("409") ? "Ya existe una materia prima con ese código" : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}
      <label className="block">
        <span className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Código</span>
        <input className={inputClass} placeholder="Ej. ALTA" value={code} onChange={(e) => setCode(e.target.value)} disabled={!!initial} />
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Nombre (opcional)</span>
        <input className={inputClass} placeholder="Descripción" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Stock mínimo (kg)</span>
        <input className={inputClass} type="number" step="0.01" value={minStock} onChange={(e) => setMinStock(e.target.value)} />
      </label>
      <div className="flex gap-2 justify-end pt-2">
        <button type="button" onClick={onCancel} className="text-sm px-4 py-2 rounded border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200">
          Cancelar
        </button>
        <button type="submit" disabled={saving} className="bg-slate-800 hover:bg-slate-700 text-white text-sm px-4 py-2 rounded disabled:opacity-50">
          {saving ? "Guardando..." : "Guardar"}
        </button>
      </div>
    </form>
  );
}

function AdjustStockForm({
  code,
  onSubmit,
  onCancel,
}: {
  code: string;
  onSubmit: (quantity: number, notes?: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const q = Number(quantity);
    if (!q) {
      setError("Ingresá una cantidad distinta de 0");
      return;
    }
    setSaving(true);
    try {
      await onSubmit(q, notes.trim() || undefined);
    } catch {
      setError("No se pudo registrar el movimiento");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Ajustar stock de <strong>{code}</strong> — positivo suma (compra), negativo resta (ajuste).
      </p>
      {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}
      <input
        className={inputClass}
        type="number"
        step="0.01"
        placeholder="Ej. 500 o -20"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        autoFocus
      />
      <input className={inputClass} placeholder="Motivo (opcional, ej. compra a proveedor X)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="flex gap-2 justify-end pt-2">
        <button type="button" onClick={onCancel} className="text-sm px-4 py-2 rounded border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200">
          Cancelar
        </button>
        <button type="submit" disabled={saving} className="bg-slate-800 hover:bg-slate-700 text-white text-sm px-4 py-2 rounded disabled:opacity-50">
          {saving ? "Guardando..." : "Registrar"}
        </button>
      </div>
    </form>
  );
}

export default function MateriaPrima() {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [adjusting, setAdjusting] = useState<any>(null);
  const queryClient = useQueryClient();

  const { data: catalog, isLoading } = useQuery({ queryKey: ["rawMaterials"], queryFn: api.getRawMaterials });
  const { data: stock } = useQuery({ queryKey: ["rawMaterialStock"], queryFn: api.getRawMaterialStock });

  const stockById = new Map((stock ?? []).map((s: any) => [s.id, s]));

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["rawMaterials"] });
    queryClient.invalidateQueries({ queryKey: ["rawMaterialStock"] });
    queryClient.invalidateQueries({ queryKey: ["rawMaterialMovements"] });
  }

  async function handleCreate(data: { code: string; name?: string; minStock: number }) {
    await api.createRawMaterial(data);
    invalidate();
    setCreating(false);
  }

  async function handleUpdate(data: { code: string; name?: string; minStock: number }) {
    await api.updateRawMaterial(editing.id, { name: data.name, minStock: data.minStock });
    invalidate();
    setEditing(null);
  }

  async function handleDeactivate(id: number) {
    await api.deactivateRawMaterial(id);
    invalidate();
  }

  async function handleReactivate(id: number) {
    await api.reactivateRawMaterial(id);
    invalidate();
  }

  async function handleAdjust(quantity: number, notes?: string) {
    await api.adjustRawMaterialStock(adjusting.id, quantity, notes);
    invalidate();
    setAdjusting(null);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Materia prima</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Catálogo e inventario de insumos de Extrusión — el stock se descuenta solo al cerrar una OP con esa materia prima cargada
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="bg-slate-800 text-white text-sm px-4 py-2 rounded inline-flex items-center gap-1.5 hover:bg-slate-700"
        >
          <Plus size={16} strokeWidth={2} aria-hidden="true" /> Nueva materia prima
        </button>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        {isLoading && <p className="p-4 text-center text-slate-500 dark:text-slate-400 text-sm">Cargando...</p>}
        {!isLoading && catalog?.length === 0 && <p className="p-4 text-center text-slate-500 dark:text-slate-400 text-sm">No hay materia prima cargada.</p>}

        {!isLoading && catalog && catalog.length > 0 && (
          <>
            <table className="hidden md:table w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800 text-left text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="p-3">Código</th>
                  <th className="p-3">Nombre</th>
                  <th className="p-3">Stock actual</th>
                  <th className="p-3">Mínimo</th>
                  <th className="p-3">Estado</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {catalog.map((m: any) => {
                  const s = stockById.get(m.id);
                  const below = s?.belowMinimum;
                  return (
                    <tr key={m.id} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="p-3 font-medium text-slate-800 dark:text-slate-100">{m.code}</td>
                      <td className="p-3 text-slate-600 dark:text-slate-300">{m.name ?? "—"}</td>
                      <td className={`p-3 ${below ? "text-red-600 dark:text-red-400 font-medium" : "text-slate-600 dark:text-slate-300"}`}>
                        {s ? `${s.currentStock} kg` : "—"}
                      </td>
                      <td className="p-3 text-slate-600 dark:text-slate-300">{Number(m.minStock)} kg</td>
                      <td className="p-3">
                        {!m.active ? (
                          <span className="text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">Inactivo</span>
                        ) : below ? (
                          <span className="text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950 px-2 py-0.5 rounded-full">Bajo mínimo</span>
                        ) : (
                          <span className="text-xs text-green-700 dark:text-emerald-400 bg-green-50 dark:bg-emerald-950 px-2 py-0.5 rounded-full">OK</span>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex gap-3 justify-end text-xs">
                          <button onClick={() => setAdjusting(m)} className="text-sky-700 dark:text-sky-400 hover:underline">
                            Ajustar stock
                          </button>
                          <button onClick={() => setEditing(m)} className="text-slate-600 dark:text-slate-300 hover:underline">
                            Editar
                          </button>
                          {m.active ? (
                            <button onClick={() => handleDeactivate(m.id)} className="text-red-600 dark:text-red-400 hover:underline">
                              Desactivar
                            </button>
                          ) : (
                            <button onClick={() => handleReactivate(m.id)} className="text-emerald-700 dark:text-emerald-400 hover:underline">
                              Reactivar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-700">
              {catalog.map((m: any) => {
                const s = stockById.get(m.id);
                const below = s?.belowMinimum;
                return (
                  <div key={m.id} className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-slate-800 dark:text-slate-100">{m.code}</p>
                      {!m.active ? (
                        <span className="text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">Inactivo</span>
                      ) : below ? (
                        <span className="text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950 px-2 py-0.5 rounded-full">Bajo mínimo</span>
                      ) : (
                        <span className="text-xs text-green-700 dark:text-emerald-400 bg-green-50 dark:bg-emerald-950 px-2 py-0.5 rounded-full">OK</span>
                      )}
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-300">{m.name ?? "—"}</p>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      Stock: {s ? `${s.currentStock} kg` : "—"} · Mínimo: {Number(m.minStock)} kg
                    </p>
                    <div className="flex gap-3 text-xs pt-1">
                      <button onClick={() => setAdjusting(m)} className="text-sky-700 dark:text-sky-400 hover:underline">
                        Ajustar stock
                      </button>
                      <button onClick={() => setEditing(m)} className="text-slate-600 dark:text-slate-300 hover:underline">
                        Editar
                      </button>
                      {m.active ? (
                        <button onClick={() => handleDeactivate(m.id)} className="text-red-600 dark:text-red-400 hover:underline">
                          Desactivar
                        </button>
                      ) : (
                        <button onClick={() => handleReactivate(m.id)} className="text-emerald-700 dark:text-emerald-400 hover:underline">
                          Reactivar
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {creating && (
        <Modal title="Nueva materia prima" onClose={() => setCreating(false)}>
          <RawMaterialForm onSubmit={handleCreate} onCancel={() => setCreating(false)} />
        </Modal>
      )}
      {editing && (
        <Modal title={`Editar ${editing.code}`} onClose={() => setEditing(null)}>
          <RawMaterialForm
            initial={{ code: editing.code, name: editing.name ?? "", minStock: String(Number(editing.minStock)) }}
            onSubmit={handleUpdate}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}
      {adjusting && (
        <Modal title="Ajustar stock" onClose={() => setAdjusting(null)}>
          <AdjustStockForm code={adjusting.code} onSubmit={handleAdjust} onCancel={() => setAdjusting(null)} />
        </Modal>
      )}
    </div>
  );
}
