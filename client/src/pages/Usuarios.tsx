import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { api } from "../api/client";
import Modal from "../components/Modal";
import UsuarioForm from "../components/UsuarioForm";

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  gerente_produccion: "Gerente de Producción",
  planeacion: "Planeación",
  ventas_pedidos: "Ventas / Pedidos",
  operario_extrusion: "Operario Extrusión",
  operario_impresion: "Operario Impresión",
  operario_sellado_precorte: "Operario Sellado/Precorte",
  calidad: "Calidad",
  almacen_despachos: "Almacén / Despachos",
  auditor: "Auditor",
};

export default function Usuarios() {
  const [creating, setCreating] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [deactivatingId, setDeactivatingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: users, isLoading } = useQuery({ queryKey: ["users"], queryFn: api.getUsers });

  async function handleDeactivate(id: number) {
    setError(null);
    try {
      await api.deactivateUser(id);
      queryClient.invalidateQueries({ queryKey: ["users"] });
    } catch (err: any) {
      setError(err?.message?.includes("propio") ? "No podés desactivar tu propio usuario." : "No se pudo desactivar el usuario.");
    } finally {
      setDeactivatingId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Usuarios y permisos</h1>
          <p className="text-sm text-slate-500">Usuarios del sistema y su rol asignado</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="bg-slate-800 text-white text-sm px-4 py-2 rounded inline-flex items-center gap-1.5 hover:bg-slate-700"
        >
          <Plus size={16} strokeWidth={2} aria-hidden="true" /> Nuevo usuario
        </button>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading && <p className="p-4 text-center text-slate-500 text-sm">Cargando...</p>}
        {!isLoading && users?.length === 0 && <p className="p-4 text-center text-slate-500 text-sm">No hay usuarios.</p>}

        {!isLoading && users && users.length > 0 && (
          <>
            <table className="hidden md:table w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="p-3">Nombre</th>
                  <th className="p-3">Email</th>
                  <th className="p-3">Rol</th>
                  <th className="p-3">Estado</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u: any) => (
                  <tr key={u.id} className="border-t border-slate-100">
                    <td className="p-3 font-medium text-slate-800">{u.name}</td>
                    <td className="p-3 text-slate-600">{u.email}</td>
                    <td className="p-3 text-slate-600">{ROLE_LABELS[u.role] ?? u.role}</td>
                    <td className="p-3">
                      {u.active ? (
                        <span className="text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full">Activo</span>
                      ) : (
                        <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">Inactivo</span>
                      )}
                    </td>
                    <td className="p-3">
                      {u.active && (
                        <div className="flex items-center gap-2">
                          <button
                            className="p-1.5 rounded hover:bg-slate-100 text-slate-500"
                            title="Editar"
                            onClick={() => setEditingUser(u)}
                          >
                            <Pencil size={14} strokeWidth={2} />
                          </button>
                          {deactivatingId === u.id ? (
                            <div className="flex items-center gap-1.5">
                              <button
                                className="text-red-600 text-xs font-medium hover:underline"
                                onClick={() => handleDeactivate(u.id)}
                              >
                                Confirmar
                              </button>
                              <button className="text-slate-500 text-xs hover:underline" onClick={() => setDeactivatingId(null)}>
                                Cancelar
                              </button>
                            </div>
                          ) : (
                            <button className="text-red-600 text-xs hover:underline" onClick={() => setDeactivatingId(u.id)}>
                              Desactivar
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="md:hidden divide-y divide-slate-100">
              {users.map((u: any) => (
                <div key={u.id} className="p-4 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-slate-800">{u.name}</p>
                    {u.active ? (
                      <span className="text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full shrink-0">Activo</span>
                    ) : (
                      <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full shrink-0">Inactivo</span>
                    )}
                  </div>
                  <p className="text-sm text-slate-500">{u.email}</p>
                  <p className="text-sm text-slate-600">{ROLE_LABELS[u.role] ?? u.role}</p>
                  {u.active && (
                    <div className="flex items-center gap-3 pt-1">
                      <button className="text-slate-600 text-xs hover:underline inline-flex items-center gap-1" onClick={() => setEditingUser(u)}>
                        <Pencil size={12} strokeWidth={2} /> Editar
                      </button>
                      {deactivatingId === u.id ? (
                        <>
                          <button className="text-red-600 text-xs font-medium hover:underline" onClick={() => handleDeactivate(u.id)}>
                            Confirmar
                          </button>
                          <button className="text-slate-500 text-xs hover:underline" onClick={() => setDeactivatingId(null)}>
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <button className="text-red-600 text-xs hover:underline" onClick={() => setDeactivatingId(u.id)}>
                          Desactivar
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {creating && (
        <Modal title="Nuevo usuario" onClose={() => setCreating(false)}>
          <UsuarioForm
            onSaved={() => {
              queryClient.invalidateQueries({ queryKey: ["users"] });
              setCreating(false);
            }}
            onCancel={() => setCreating(false)}
          />
        </Modal>
      )}

      {editingUser && (
        <Modal title={`Editar: ${editingUser.name}`} onClose={() => setEditingUser(null)}>
          <UsuarioForm
            user={editingUser}
            onSaved={() => {
              queryClient.invalidateQueries({ queryKey: ["users"] });
              setEditingUser(null);
            }}
            onCancel={() => setEditingUser(null)}
          />
        </Modal>
      )}
    </div>
  );
}
