import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useRef, useState } from "react";
import { api } from "../api/client";

const STATUS_LABELS: Record<string, string> = {
  borrador: "Borrador",
  pendiente: "Pendiente",
  aprobado: "Aprobado",
  en_produccion: "En producción",
  despachado: "Despachado",
  cancelado: "Cancelado",
};

interface ItemDraft {
  productId: string;
  quantity: string;
  unitPrice: string;
}

const emptyItem: ItemDraft = { productId: "", quantity: "", unitPrice: "" };

function total(items: any[]) {
  return items.reduce((sum, it) => sum + Number(it.quantity) * Number(it.unitPrice), 0);
}

export default function Pedidos() {
  const [selectedPedidoId, setSelectedPedidoId] = useState<number | null>(null);
  const [tab, setTab] = useState<"actual" | "versiones" | "adjuntos">("actual");

  const [clientId, setClientId] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([{ ...emptyItem }]);

  const [editStatus, setEditStatus] = useState("borrador");
  const [editNotes, setEditNotes] = useState("");
  const [editItems, setEditItems] = useState<ItemDraft[]>([{ ...emptyItem }]);
  const [editing, setEditing] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: clients } = useQuery({ queryKey: ["clients"], queryFn: api.getClients });
  const { data: products } = useQuery({ queryKey: ["products"], queryFn: api.getProducts });
  const { data: pedidos, isLoading } = useQuery({ queryKey: ["pedidos"], queryFn: () => api.getPedidos() });
  const { data: versions } = useQuery({
    queryKey: ["pedidoVersions", selectedPedidoId],
    queryFn: () => api.getPedidoVersions(selectedPedidoId!),
    enabled: selectedPedidoId != null,
  });
  const { data: attachments } = useQuery({
    queryKey: ["pedidoAttachments", selectedPedidoId],
    queryFn: () => api.getPedidoAttachments(selectedPedidoId!),
    enabled: selectedPedidoId != null,
  });

  const selectedPedido = pedidos?.find((p: any) => p.id === selectedPedidoId);
  const latestVersion = versions?.[versions.length - 1];

  function productPrice(productId: string) {
    return products?.find((p: any) => p.id === Number(productId))?.unitPrice ?? "";
  }

  function itemRows(list: ItemDraft[], setList: (v: ItemDraft[]) => void) {
    function update(i: number, patch: Partial<ItemDraft>) {
      setList(list.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
    }
    return (
      <div className="space-y-2">
        {list.map((item, i) => (
          <div key={i} className="border rounded p-2 space-y-2">
            <select
              className="border rounded px-3 py-2 text-sm w-full"
              value={item.productId}
              onChange={(e) => update(i, { productId: e.target.value, unitPrice: String(productPrice(e.target.value)) })}
            >
              <option value="">Producto...</option>
              {products?.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <input
                className="border rounded px-3 py-2 text-sm min-w-0 flex-1"
                placeholder="Cantidad"
                type="number"
                step="0.01"
                value={item.quantity}
                onChange={(e) => update(i, { quantity: e.target.value })}
              />
              <input
                className="border rounded px-3 py-2 text-sm min-w-0 flex-1"
                placeholder="Precio unitario"
                type="number"
                step="0.01"
                value={item.unitPrice}
                onChange={(e) => update(i, { unitPrice: e.target.value })}
              />
              <button
                type="button"
                onClick={() => setList(list.filter((_, idx) => idx !== i))}
                className="text-red-600 text-xs px-2 shrink-0"
                disabled={list.length === 1}
              >
                Quitar
              </button>
            </div>
          </div>
        ))}
        <button type="button" onClick={() => setList([...list, { ...emptyItem }])} className="text-sm text-sky-700 hover:underline">
          + Agregar ítem
        </button>
      </div>
    );
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const validItems = items.filter((it) => it.productId && it.quantity);
    if (!clientId || validItems.length === 0) {
      setError("Elegí un cliente y al menos un ítem");
      return;
    }
    try {
      const pedido = await api.createPedido({
        clientId: Number(clientId),
        notes: notes || undefined,
        items: validItems.map((it) => ({
          productId: Number(it.productId),
          quantity: Number(it.quantity),
          unitPrice: it.unitPrice ? Number(it.unitPrice) : undefined,
        })),
      });
      setClientId("");
      setNotes("");
      setItems([{ ...emptyItem }]);
      queryClient.invalidateQueries({ queryKey: ["pedidos"] });
      setSelectedPedidoId(pedido.id);
    } catch {
      setError("No se pudo crear el pedido");
    }
  }

  function startEditing() {
    if (!latestVersion) return;
    setEditStatus(latestVersion.status);
    setEditNotes(latestVersion.notes ?? "");
    setEditItems(
      latestVersion.items.map((it: any) => ({
        productId: String(it.productId),
        quantity: String(it.quantity),
        unitPrice: String(it.unitPrice),
      }))
    );
    setEditing(true);
  }

  async function handleSaveVersion(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!selectedPedidoId) return;
    const validItems = editItems.filter((it) => it.productId && it.quantity);
    if (validItems.length === 0) {
      setError("Agregá al menos un ítem");
      return;
    }
    try {
      await api.updatePedido(selectedPedidoId, {
        status: editStatus,
        notes: editNotes || undefined,
        items: validItems.map((it) => ({
          productId: Number(it.productId),
          quantity: Number(it.quantity),
          unitPrice: it.unitPrice ? Number(it.unitPrice) : undefined,
        })),
      });
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ["pedidos"] });
      queryClient.invalidateQueries({ queryKey: ["pedidoVersions", selectedPedidoId] });
      setMessage("Se guardó una nueva versión del pedido.");
    } catch {
      setError("No se pudo guardar la nueva versión");
    }
  }

  async function handleFacturar(pedidoId: number) {
    setMessage(null);
    setError(null);
    try {
      const factura = await api.createFacturaFromPedido(pedidoId);
      setMessage(`Se generó la factura ${factura.invoiceNumber}. Buscala en el módulo Facturas.`);
      queryClient.invalidateQueries({ queryKey: ["facturas"] });
    } catch {
      setError("No se pudo generar la factura");
    }
  }

  async function handleDuplicate(pedidoId: number) {
    setMessage(null);
    try {
      const duplicated = await api.duplicatePedido(pedidoId);
      setMessage(`Se creó el pedido ${duplicated.orderNumber} como copia.`);
      queryClient.invalidateQueries({ queryKey: ["pedidos"] });
      setSelectedPedidoId(duplicated.id);
    } catch {
      setError("No se pudo duplicar el pedido");
    }
  }

  async function handleUploadAttachment() {
    const file = fileInputRef.current?.files?.[0];
    if (!file || !selectedPedidoId) return;
    setError(null);
    try {
      await api.uploadPedidoAttachment(selectedPedidoId, file);
      if (fileInputRef.current) fileInputRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["pedidoAttachments", selectedPedidoId] });
    } catch {
      setError("No se pudo subir el archivo");
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4">
      <div className="space-y-4">
        <form onSubmit={handleCreate} className="bg-white rounded-lg shadow p-4 space-y-2">
          <p className="text-sm font-medium text-slate-700">Nuevo pedido</p>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <select className="border rounded px-3 py-2 text-sm w-full" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Cliente...</option>
            {clients?.map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {itemRows(items, setItems)}
          <input
            className="border rounded px-3 py-2 text-sm w-full"
            placeholder="Notas (opcional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <button className="bg-slate-800 text-white text-sm px-4 py-2 rounded" type="submit">
            Crear pedido
          </button>
        </form>

        <div className="bg-white rounded-lg shadow divide-y">
          {isLoading && <p className="p-4 text-slate-500 text-sm">Cargando...</p>}
          {pedidos?.map((p: any) => {
            const v = p.versions[0];
            return (
              <button
                key={p.id}
                onClick={() => {
                  setSelectedPedidoId(p.id);
                  setTab("actual");
                  setEditing(false);
                }}
                className={`w-full text-left px-4 py-3 text-sm hover:bg-slate-50 ${
                  selectedPedidoId === p.id ? "bg-slate-100 font-medium" : ""
                }`}
              >
                <div className="flex justify-between">
                  <span>{p.orderNumber}</span>
                  <span className="text-xs text-slate-500">v{p.currentVersion}</span>
                </div>
                <div className="text-slate-500">{p.client.name}</div>
                <div className="text-xs text-slate-500">
                  {STATUS_LABELS[p.status]} · ${v ? total(v.items).toLocaleString("es-CO") : 0}
                </div>
              </button>
            );
          })}
          {pedidos?.length === 0 && <p className="p-4 text-slate-500 text-sm">Todavía no hay pedidos.</p>}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-4">
        {!selectedPedido && <p className="text-slate-500">Seleccioná un pedido para ver el detalle.</p>}

        {selectedPedido && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">
                {selectedPedido.orderNumber} — {selectedPedido.client.name}
              </h2>
              <div className="flex gap-3">
                <button onClick={() => handleFacturar(selectedPedido.id)} className="text-emerald-700 text-xs hover:underline">
                  Facturar pedido
                </button>
                <button onClick={() => handleDuplicate(selectedPedido.id)} className="text-sky-700 text-xs hover:underline">
                  Duplicar pedido
                </button>
              </div>
            </div>

            {error && <p className="text-red-600 text-sm">{error}</p>}
            {message && <p className="text-emerald-700 text-sm">{message}</p>}

            <div className="flex gap-1 border-b overflow-x-auto">
              {[
                { key: "actual", label: "Versión actual" },
                { key: "versiones", label: "Historial de versiones" },
                { key: "adjuntos", label: "Adjuntos" },
              ].map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key as any)}
                  className={`px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap ${
                    tab === t.key ? "border-slate-800 font-medium text-slate-800" : "border-transparent text-slate-500"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === "actual" && latestVersion && !editing && (
              <div className="space-y-3">
                <p className="text-sm">
                  Versión <strong>v{latestVersion.versionNumber}</strong> · Estado:{" "}
                  <strong>{STATUS_LABELS[latestVersion.status]}</strong>
                </p>
                <table className="hidden sm:table w-full text-sm">
                  <thead className="bg-slate-100 text-left">
                    <tr>
                      <th className="p-2">Producto</th>
                      <th className="p-2">Cantidad</th>
                      <th className="p-2">Precio unit.</th>
                      <th className="p-2">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latestVersion.items.map((it: any) => (
                      <tr key={it.id} className="border-t">
                        <td className="p-2">{it.product.name}</td>
                        <td className="p-2">{it.quantity}</td>
                        <td className="p-2">${Number(it.unitPrice).toLocaleString("es-CO")}</td>
                        <td className="p-2">${(Number(it.quantity) * Number(it.unitPrice)).toLocaleString("es-CO")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="sm:hidden divide-y border rounded">
                  {latestVersion.items.map((it: any) => (
                    <div key={it.id} className="p-2.5 text-sm space-y-0.5">
                      <p className="font-medium">{it.product.name}</p>
                      <p className="text-slate-500">
                        {it.quantity} × ${Number(it.unitPrice).toLocaleString("es-CO")} = $
                        {(Number(it.quantity) * Number(it.unitPrice)).toLocaleString("es-CO")}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="text-right font-medium">Total: ${total(latestVersion.items).toLocaleString("es-CO")}</p>
                {latestVersion.notes && <p className="text-sm text-slate-600">Notas: {latestVersion.notes}</p>}
                <button onClick={startEditing} className="bg-slate-800 text-white text-sm px-4 py-2 rounded">
                  Editar (crea nueva versión)
                </button>
              </div>
            )}

            {tab === "actual" && editing && (
              <form onSubmit={handleSaveVersion} className="space-y-2">
                <select className="border rounded px-3 py-2 text-sm w-full" value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                {itemRows(editItems, setEditItems)}
                <input
                  className="border rounded px-3 py-2 text-sm w-full"
                  placeholder="Notas (opcional)"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                />
                <div className="flex gap-2">
                  <button className="bg-slate-800 text-white text-sm px-4 py-2 rounded" type="submit">
                    Guardar como v{(selectedPedido.currentVersion ?? 1) + 1}
                  </button>
                  <button type="button" onClick={() => setEditing(false)} className="text-sm px-4 py-2 rounded border">
                    Cancelar
                  </button>
                </div>
              </form>
            )}

            {tab === "versiones" && (
              <ul className="divide-y">
                {versions
                  ?.slice()
                  .reverse()
                  .map((v: any) => (
                    <li key={v.id} className="py-3 text-sm">
                      <p className="font-medium">
                        v{v.versionNumber} — {STATUS_LABELS[v.status]}{" "}
                        <span className="text-xs text-slate-500">{new Date(v.createdAt).toLocaleString()}</span>
                      </p>
                      <ul className="text-slate-600 ml-4 list-disc">
                        {v.items.map((it: any) => (
                          <li key={it.id}>
                            {it.product.name} × {it.quantity} — ${Number(it.unitPrice).toLocaleString("es-CO")}
                          </li>
                        ))}
                      </ul>
                      {v.notes && <p className="text-slate-500 mt-1">Notas: {v.notes}</p>}
                    </li>
                  ))}
              </ul>
            )}

            {tab === "adjuntos" && (
              <div className="space-y-3">
                <ul className="divide-y">
                  {attachments?.map((a: any) => (
                    <li key={a.id} className="py-2 flex items-center justify-between text-sm">
                      <span>
                        {a.originalName} <span className="text-xs text-slate-500">({Math.round(a.sizeBytes / 1024)} KB)</span>
                      </span>
                      <button
                        onClick={() => api.downloadPedidoAttachment(selectedPedido.id, a.id, a.originalName)}
                        className="text-sky-700 text-xs hover:underline"
                      >
                        Descargar
                      </button>
                    </li>
                  ))}
                  {attachments?.length === 0 && <p className="text-slate-500 text-sm py-2">Sin adjuntos todavía.</p>}
                </ul>
                <div className="flex gap-2 items-center border-t pt-3">
                  <input ref={fileInputRef} type="file" className="text-sm" />
                  <button onClick={handleUploadAttachment} className="bg-slate-800 text-white text-sm px-4 py-2 rounded">
                    Subir
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
