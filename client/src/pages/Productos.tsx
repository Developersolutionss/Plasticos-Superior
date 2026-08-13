import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { api } from "../api/client";
import Modal from "../components/Modal";
import ProductoForm from "../components/ProductoForm";

const CATEGORY_LABELS: Record<string, string> = {
  bultos: "Bultos",
  rollos_prec_lam: "Rollos Precintado/Laminado",
  rollos_fuelle: "Rollos Fuelle",
  mangueta: "Mangueta",
  tiras: "Tiras",
  control_impresion: "Control Impresión",
};

function formatCOP(n: number) {
  return `$${Math.round(n).toLocaleString("es-CO")}`;
}

export default function Productos() {
  const [creating, setCreating] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [deactivatingId, setDeactivatingId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const { data: products, isLoading } = useQuery({ queryKey: ["allProducts"], queryFn: api.getAllProducts });

  async function handleDeactivate(id: number) {
    await api.deactivateProduct(id);
    queryClient.invalidateQueries({ queryKey: ["allProducts"] });
    setDeactivatingId(null);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Productos</h1>
          <p className="text-sm text-slate-500">Catálogo de productos del inventario</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="bg-slate-800 text-white text-sm px-4 py-2 rounded inline-flex items-center gap-1.5 hover:bg-slate-700"
        >
          <Plus size={16} strokeWidth={2} aria-hidden="true" /> Nuevo producto
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading && <p className="p-4 text-center text-slate-500 text-sm">Cargando...</p>}
        {!isLoading && products?.length === 0 && <p className="p-4 text-center text-slate-500 text-sm">No hay productos.</p>}

        {!isLoading && products && products.length > 0 && (
          <>
            <table className="hidden md:table w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="p-3">SKU</th>
                  <th className="p-3">Nombre</th>
                  <th className="p-3">Categoría</th>
                  <th className="p-3">Unidad</th>
                  <th className="p-3">Stock mínimo</th>
                  <th className="p-3">Precio</th>
                  <th className="p-3">Estado</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {products.map((p: any) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="p-3 text-slate-500">{p.sku}</td>
                    <td className="p-3 font-medium text-slate-800">{p.name}</td>
                    <td className="p-3 text-slate-600">{CATEGORY_LABELS[p.category] ?? p.category}</td>
                    <td className="p-3 text-slate-600">{p.unit}</td>
                    <td className="p-3 text-slate-600">{p.minStock}</td>
                    <td className="p-3 text-slate-600">{formatCOP(Number(p.unitPrice))}</td>
                    <td className="p-3">
                      {p.active ? (
                        <span className="text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full">Activo</span>
                      ) : (
                        <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">Inactivo</span>
                      )}
                    </td>
                    <td className="p-3">
                      {p.active && (
                        <div className="flex items-center gap-2">
                          <button
                            className="p-1.5 rounded hover:bg-slate-100 text-slate-500"
                            title="Editar"
                            onClick={() => setEditingProduct(p)}
                          >
                            <Pencil size={14} strokeWidth={2} />
                          </button>
                          {deactivatingId === p.id ? (
                            <div className="flex items-center gap-1.5">
                              <button
                                className="text-red-600 text-xs font-medium hover:underline"
                                onClick={() => handleDeactivate(p.id)}
                              >
                                Confirmar
                              </button>
                              <button className="text-slate-500 text-xs hover:underline" onClick={() => setDeactivatingId(null)}>
                                Cancelar
                              </button>
                            </div>
                          ) : (
                            <button className="text-red-600 text-xs hover:underline" onClick={() => setDeactivatingId(p.id)}>
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
              {products.map((p: any) => (
                <div key={p.id} className="p-4 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-slate-800">
                      {p.name} <span className="text-slate-400 font-normal">({p.sku})</span>
                    </p>
                    {p.active ? (
                      <span className="text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full shrink-0">Activo</span>
                    ) : (
                      <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full shrink-0">Inactivo</span>
                    )}
                  </div>
                  <p className="text-sm text-slate-500">{CATEGORY_LABELS[p.category] ?? p.category}</p>
                  <div className="flex items-center gap-4 text-sm text-slate-600">
                    <span>
                      Mín: {p.minStock} {p.unit}
                    </span>
                    <span>{formatCOP(Number(p.unitPrice))}</span>
                  </div>
                  {p.active && (
                    <div className="flex items-center gap-3 pt-1">
                      <button className="text-slate-600 text-xs hover:underline inline-flex items-center gap-1" onClick={() => setEditingProduct(p)}>
                        <Pencil size={12} strokeWidth={2} /> Editar
                      </button>
                      {deactivatingId === p.id ? (
                        <>
                          <button className="text-red-600 text-xs font-medium hover:underline" onClick={() => handleDeactivate(p.id)}>
                            Confirmar
                          </button>
                          <button className="text-slate-500 text-xs hover:underline" onClick={() => setDeactivatingId(null)}>
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <button className="text-red-600 text-xs hover:underline" onClick={() => setDeactivatingId(p.id)}>
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
        <Modal title="Nuevo producto" onClose={() => setCreating(false)}>
          <ProductoForm
            onSaved={() => {
              queryClient.invalidateQueries({ queryKey: ["allProducts"] });
              setCreating(false);
            }}
            onCancel={() => setCreating(false)}
          />
        </Modal>
      )}

      {editingProduct && (
        <Modal title={`Editar: ${editingProduct.name}`} onClose={() => setEditingProduct(null)}>
          <ProductoForm
            product={editingProduct}
            onSaved={() => {
              queryClient.invalidateQueries({ queryKey: ["allProducts"] });
              setEditingProduct(null);
            }}
            onCancel={() => setEditingProduct(null)}
          />
        </Modal>
      )}
    </div>
  );
}
