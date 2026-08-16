import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api/client";
import ClientePicker from "../components/ClientePicker";

const STATUS_LABELS: Record<string, string> = {
  borrador: "Borrador",
  enviada: "Enviada",
  aceptada: "Aceptada",
  rechazada: "Rechazada",
  expirada: "Expirada",
};

interface ItemDraft {
  productId: string;
  quantity: string;
  unitPrice: string;
}

const emptyItem: ItemDraft = { productId: "", quantity: "", unitPrice: "" };

export default function Cotizaciones() {
  const location = useLocation();
  const [clientId, setClientId] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([{ ...emptyItem }]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Preselecciona el cliente al llegar con el botón "Cotizar" (state del router).
  const navClientId = (location.state as { clientId?: number })?.clientId;
  useEffect(() => {
    if (navClientId != null) setClientId(String(navClientId));
  }, [navClientId]);

  const { data: clients } = useQuery({ queryKey: ["clients"], queryFn: api.getClients });
  const { data: products } = useQuery({ queryKey: ["products"], queryFn: api.getProducts });
  const { data: cotizaciones, isLoading } = useQuery({ queryKey: ["cotizaciones"], queryFn: () => api.getCotizaciones() });

  function productPrice(productId: string) {
    return products?.find((p: any) => p.id === Number(productId))?.unitPrice ?? "";
  }

  function updateItem(index: number, patch: Partial<ItemDraft>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  function addItemRow() {
    setItems((prev) => [...prev, { ...emptyItem }]);
  }

  function removeItemRow(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const validItems = items.filter((it) => it.productId && it.quantity);
    if (!clientId || validItems.length === 0) {
      setError("Elegí un cliente y al menos un ítem");
      return;
    }
    try {
      await api.createCotizacion({
        clientId: Number(clientId),
        validUntil: validUntil || undefined,
        notes: notes || undefined,
        items: validItems.map((it) => ({
          productId: Number(it.productId),
          quantity: Number(it.quantity),
          unitPrice: it.unitPrice ? Number(it.unitPrice) : undefined,
        })),
      });
      setClientId("");
      setValidUntil("");
      setNotes("");
      setItems([{ ...emptyItem }]);
      queryClient.invalidateQueries({ queryKey: ["cotizaciones"] });
    } catch {
      setError("No se pudo crear la cotización");
    }
  }

  async function handleStatusChange(id: number, status: string) {
    await api.updateCotizacionStatus(id, status);
    queryClient.invalidateQueries({ queryKey: ["cotizaciones"] });
  }

  async function handleConvert(id: number) {
    setMessage(null);
    try {
      const pedido = await api.convertCotizacionToPedido(id);
      setMessage(`Convertida en el pedido ${pedido.orderNumber}.`);
      queryClient.invalidateQueries({ queryKey: ["pedidos"] });
    } catch {
      setError("No se pudo convertir la cotización en pedido");
    }
  }

  function total(cotizacion: any) {
    return cotizacion.items.reduce((sum: number, it: any) => sum + Number(it.quantity) * Number(it.unitPrice), 0);
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleCreate} className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 space-y-3">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Nueva cotización</p>
        {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}
        {message && <p className="text-emerald-700 dark:text-emerald-400 text-sm">{message}</p>}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-center">
          <ClientePicker
            clients={clients ?? []}
            value={clientId ? Number(clientId) : null}
            onChange={(id) => setClientId(id ? String(id) : "")}
            placeholder="Buscar cliente por nombre..."
          />
          <input
            className="border rounded px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            type="date"
            placeholder="Válida hasta"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
          />
          <input
            className="border rounded px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            placeholder="Notas"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Ítems</p>
          {items.map((item, i) => (
            <div key={i} className="border rounded p-2 space-y-2 dark:border-slate-700">
              <select
                className="border rounded px-3 py-2 text-sm w-full dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                value={item.productId}
                onChange={(e) => updateItem(i, { productId: e.target.value, unitPrice: String(productPrice(e.target.value)) })}
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
                  className="border rounded px-3 py-2 text-sm min-w-0 flex-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  placeholder="Cantidad"
                  type="number"
                  step="0.01"
                  value={item.quantity}
                  onChange={(e) => updateItem(i, { quantity: e.target.value })}
                />
                <input
                  className="border rounded px-3 py-2 text-sm min-w-0 flex-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  placeholder="Precio unitario"
                  type="number"
                  step="0.01"
                  value={item.unitPrice}
                  onChange={(e) => updateItem(i, { unitPrice: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => removeItemRow(i)}
                  className="text-red-600 dark:text-red-400 text-xs px-2 shrink-0"
                  disabled={items.length === 1}
                >
                  Quitar
                </button>
              </div>
            </div>
          ))}
          <button type="button" onClick={addItemRow} className="text-sm text-sky-700 dark:text-sky-400 hover:underline">
            + Agregar ítem
          </button>
        </div>

        <button className="bg-slate-800 text-white text-sm px-4 py-2 rounded" type="submit">
          Crear cotización
        </button>
      </form>

      {isLoading && <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 text-center text-slate-500 dark:text-slate-400 text-sm">Cargando...</div>}
      {!isLoading && cotizaciones?.length === 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 text-center text-slate-500 dark:text-slate-400 text-sm">Todavía no hay cotizaciones.</div>
      )}

      {!isLoading && cotizaciones && cotizaciones.length > 0 && (
        <>
          <div className="hidden md:block bg-white dark:bg-slate-900 rounded-lg shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 dark:bg-slate-800 text-left">
                <tr>
                  <th className="p-3">Cotización</th>
                  <th className="p-3">Cliente</th>
                  <th className="p-3">Total</th>
                  <th className="p-3">Válida hasta</th>
                  <th className="p-3">Estado</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {cotizaciones.map((c: any) => (
                  <tr key={c.id} className="border-t">
                    <td className="p-3 font-medium">{c.quoteNumber}</td>
                    <td className="p-3">{c.client.name}</td>
                    <td className="p-3">${total(c).toLocaleString("es-CO")}</td>
                    <td className="p-3">{c.validUntil ? new Date(c.validUntil).toLocaleDateString() : "-"}</td>
                    <td className="p-3">
                      <select
                        className="text-xs rounded-full px-2 py-1 border bg-slate-50 dark:bg-slate-800"
                        value={c.status}
                        onChange={(e) => handleStatusChange(c.id, e.target.value)}
                      >
                        {Object.entries(STATUS_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        <button onClick={() => handleConvert(c.id)} className="text-sky-700 dark:text-sky-400 text-xs hover:underline">
                          Convertir en pedido
                        </button>
                        <button
                          onClick={() => api.downloadCotizacionPdf(c.id, c.quoteNumber)}
                          className="text-slate-600 dark:text-slate-300 text-xs hover:underline"
                        >
                          PDF
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden bg-white dark:bg-slate-900 rounded-lg shadow divide-y divide-slate-100 dark:divide-slate-700">
            {cotizaciones.map((c: any) => (
              <div key={c.id} className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-slate-800 dark:text-slate-100">{c.quoteNumber}</p>
                  <p className="font-medium text-slate-800 dark:text-slate-100">${total(c).toLocaleString("es-CO")}</p>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-300">{c.client.name}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Válida hasta: {c.validUntil ? new Date(c.validUntil).toLocaleDateString() : "-"}
                </p>
                <select
                  className="w-full text-xs rounded-full px-2 py-1.5 border bg-slate-50 dark:bg-slate-800"
                  value={c.status}
                  onChange={(e) => handleStatusChange(c.id, e.target.value)}
                >
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-4">
                  <button onClick={() => handleConvert(c.id)} className="text-sky-700 dark:text-sky-400 text-sm hover:underline">
                    Convertir en pedido
                  </button>
                  <button onClick={() => api.downloadCotizacionPdf(c.id, c.quoteNumber)} className="text-slate-600 dark:text-slate-300 text-sm hover:underline">
                    Descargar PDF
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
