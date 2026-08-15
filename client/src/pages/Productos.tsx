import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pencil, Plus, Tag } from "lucide-react";
import { api } from "../api/client";
import Modal from "../components/Modal";
import ProductoForm from "../components/ProductoForm";

/** El nombre/SKU del producto se interpolan en un HTML servido por
 * `document.write` en una ventana con el mismo origen — sin escapar, un
 * nombre de producto malicioso (creado por alguien con rol
 * PRODUCCION_GESTION) podría correr JS con acceso al localStorage de la
 * app principal (token de sesión) vía window.opener. */
function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Arma un HTML autocontenido (con su propio @media print) en una ventana
 * nueva e imprime — evita tocar el layout/CSS de la app principal, patrón
 * estándar para "imprimir solo esto" en una SPA. */
function printLabels(labels: { sku: string; name: string; qrDataUrl: string }[]) {
  const win = window.open("", "_blank");
  if (!win) return;

  const cards = labels
    .map((l) => {
      const sku = escapeHtml(l.sku);
      const name = escapeHtml(l.name);
      return `
        <div class="label">
          <img src="${l.qrDataUrl}" alt="QR ${sku}" />
          <div class="text">
            <p class="sku">${sku}</p>
            <p class="name">${name}</p>
          </div>
        </div>`;
    })
    .join("");

  win.document.write(`<!DOCTYPE html>
    <html>
      <head>
        <title>Etiquetas</title>
        <style>
          * { box-sizing: border-box; }
          body { font-family: sans-serif; margin: 0; padding: 8mm; }
          .grid { display: flex; flex-wrap: wrap; gap: 4mm; }
          .label {
            width: 6cm; min-height: 4cm; height: auto;
            border: 1px dashed #999; border-radius: 3mm;
            padding: 3mm; display: flex; align-items: center; gap: 3mm;
            page-break-inside: avoid;
          }
          .label img { width: 2.6cm; height: 2.6cm; flex-shrink: 0; }
          .label .text { overflow: hidden; min-width: 0; }
          .label .sku { font-weight: bold; font-size: 12pt; margin: 0 0 2mm; overflow-wrap: anywhere; word-break: break-word; }
          .label .name {
            font-size: 9pt; margin: 0; color: #333;
            display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3;
            overflow: hidden; text-overflow: ellipsis;
          }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="grid">${cards}</div>
      </body>
    </html>`);
  win.document.close();

  // Los QR son <img> con data: URI — el navegador todavía puede estar
  // decodificándolos cuando este código sigue ejecutando (document.write es
  // síncrono, pero el decode de la imagen no). Si se llama win.print() de
  // una, la primera impresión sale con el recuadro del QR vacío y recién la
  // segunda (con la imagen ya en caché/decodificada) sale bien. Se espera a
  // que la ventana nueva termine de cargar (eso incluye decodificar las
  // imágenes) antes de imprimir, con un fallback por si el evento load ya
  // pasó o no llega a disparar en algún navegador.
  let printed = false;
  const doPrint = () => {
    if (printed) return;
    printed = true;
    win.focus();
    win.print();
  };
  win.onload = doPrint;
  setTimeout(doPrint, 400);
}

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
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [printing, setPrinting] = useState(false);
  const queryClient = useQueryClient();

  const { data: products, isLoading } = useQuery({ queryKey: ["allProducts"], queryFn: api.getAllProducts });

  async function handleDeactivate(id: number) {
    await api.deactivateProduct(id);
    queryClient.invalidateQueries({ queryKey: ["allProducts"] });
    setDeactivatingId(null);
  }

  async function handleReactivate(id: number) {
    await api.reactivateProduct(id);
    queryClient.invalidateQueries({ queryKey: ["allProducts"] });
  }

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!products) return;
    setSelectedIds((prev) => (prev.size === products.length ? new Set() : new Set(products.map((p: any) => p.id))));
  }

  async function handlePrintLabels() {
    setPrinting(true);
    try {
      const labels = await Promise.all([...selectedIds].map((id) => api.getProductLabel(id)));
      printLabels(labels);
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Productos</h1>
          <p className="text-sm text-slate-500">Catálogo de productos del inventario</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <button
              onClick={handlePrintLabels}
              disabled={printing}
              className="border border-slate-300 text-slate-700 text-sm px-4 py-2 rounded inline-flex items-center gap-1.5 hover:bg-slate-50 disabled:opacity-50"
            >
              <Tag size={16} strokeWidth={2} aria-hidden="true" />
              {printing ? "Generando..." : `Imprimir etiquetas (${selectedIds.size})`}
            </button>
          )}
          <button
            onClick={() => setCreating(true)}
            className="bg-slate-800 text-white text-sm px-4 py-2 rounded inline-flex items-center gap-1.5 hover:bg-slate-700"
          >
            <Plus size={16} strokeWidth={2} aria-hidden="true" /> Nuevo producto
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading && <p className="p-4 text-center text-slate-500 text-sm">Cargando...</p>}
        {!isLoading && products?.length === 0 && <p className="p-4 text-center text-slate-500 text-sm">No hay productos.</p>}

        {!isLoading && products && products.length > 0 && (
          <>
            <table className="hidden md:table w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="p-3 w-8">
                    <input
                      type="checkbox"
                      checked={products.length > 0 && selectedIds.size === products.length}
                      onChange={toggleSelectAll}
                    />
                  </th>
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
                    <td className="p-3">
                      <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelected(p.id)} />
                    </td>
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
                      {p.active ? (
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
                      ) : (
                        <button className="text-emerald-600 text-xs hover:underline" onClick={() => handleReactivate(p.id)}>
                          Reactivar
                        </button>
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
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelected(p.id)} />
                      <p className="font-medium text-slate-800">
                        {p.name} <span className="text-slate-400 font-normal">({p.sku})</span>
                      </p>
                    </label>
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
                  {p.active ? (
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
                  ) : (
                    <div className="pt-1">
                      <button className="text-emerald-600 text-xs hover:underline" onClick={() => handleReactivate(p.id)}>
                        Reactivar
                      </button>
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
