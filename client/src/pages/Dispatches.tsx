import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { ScanLine } from "lucide-react";
import { api } from "../api/client";
import BarcodeScanner from "../components/BarcodeScanner";

interface ItemDraft {
  productId: string;
  quantity: string;
}

const emptyItem: ItemDraft = { productId: "", quantity: "" };

export default function Dispatches() {
  const [clientId, setClientId] = useState<string>("");
  const [status, setStatus] = useState<string>("pendiente");
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  const [newClientId, setNewClientId] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([{ ...emptyItem }]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const queryClient = useQueryClient();

  // La pantalla de Despachos ya está restringida al rol Almacén (ver App.tsx)
  // así que cualquiera que llegue acá puede leer el listado de clientes
  // (GET /clients ahora acepta Ventas o Almacén, ver clients.ts).
  const { data: clients } = useQuery({ queryKey: ["clients"], queryFn: api.getClients });
  const { data: products } = useQuery({ queryKey: ["products"], queryFn: api.getProducts });
  const { data: dispatches, isLoading } = useQuery({
    queryKey: ["dispatches", clientId, status],
    queryFn: () => api.getDispatches({ clientId: clientId ? Number(clientId) : undefined, status: status || undefined }),
  });

  async function markDispatched(dispatchId: number, itemId: number, quantityRequested: number) {
    await api.markItemDispatched(dispatchId, itemId, quantityRequested);
    queryClient.invalidateQueries({ queryKey: ["dispatches"] });
    queryClient.invalidateQueries({ queryKey: ["inventory"] });
    queryClient.invalidateQueries({ queryKey: ["alerts"] });
  }

  async function handleScanned(sku: string) {
    setScanning(false);
    const match = dispatches
      ?.flatMap((d: any) => d.items.map((item: any) => ({ dispatch: d, item })))
      .find(({ item }: any) => item.quantityDispatched == null && item.product.sku === sku);

    if (!match) {
      setScanMessage(`No se encontró ningún ítem pendiente con SKU "${sku}".`);
      return;
    }
    setScanMessage(null);
    await markDispatched(match.dispatch.id, match.item.id, Number(match.item.quantityRequested));
  }

  function updateItem(i: number, patch: Partial<ItemDraft>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  async function handleCreateDispatch(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreateMessage(null);
    const validItems = items.filter((it) => it.productId && it.quantity);
    if (!newClientId || validItems.length === 0) {
      setCreateError("Elegí un cliente y al menos un ítem");
      return;
    }
    setCreating(true);
    try {
      await api.createDispatch(
        Number(newClientId),
        validItems.map((it) => ({ productId: Number(it.productId), quantityRequested: Number(it.quantity) }))
      );
      setNewClientId("");
      setItems([{ ...emptyItem }]);
      setCreateMessage("Despacho creado.");
      queryClient.invalidateQueries({ queryKey: ["dispatches"] });
    } catch {
      setCreateError("No se pudo crear el despacho");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleCreateDispatch} className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 space-y-2 max-w-xl">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Nuevo despacho</p>
        {createError && <p className="text-red-600 dark:text-red-400 text-sm">{createError}</p>}
        {createMessage && <p className="text-emerald-700 dark:text-emerald-400 text-sm">{createMessage}</p>}

        <select
          className="border rounded px-3 py-2 text-sm w-full dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          value={newClientId}
          onChange={(e) => setNewClientId(e.target.value)}
        >
          <option value="">Cliente...</option>
          {clients?.map((c: any) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={i} className="border rounded p-2 space-y-2 dark:border-slate-600">
              <select
                className="border rounded px-2 py-2 text-sm w-full dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                value={item.productId}
                onChange={(e) => updateItem(i, { productId: e.target.value })}
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
                  className="border rounded px-2 py-2 text-sm min-w-0 flex-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  placeholder="Cantidad"
                  type="number"
                  step="0.01"
                  value={item.quantity}
                  onChange={(e) => updateItem(i, { quantity: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => setItems(items.filter((_, idx) => idx !== i))}
                  className="text-red-600 dark:text-red-400 text-xs shrink-0"
                  disabled={items.length === 1}
                >
                  Quitar
                </button>
              </div>
            </div>
          ))}
          <button type="button" onClick={() => setItems([...items, { ...emptyItem }])} className="text-sm text-sky-700 dark:text-sky-400 hover:underline">
            + Agregar ítem
          </button>
        </div>

        <button className="bg-slate-800 text-white text-sm px-4 py-2 rounded disabled:opacity-50" type="submit" disabled={creating}>
          {creating ? "Creando..." : "Crear despacho"}
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="bg-slate-800 text-white text-sm px-3 py-2 rounded inline-flex items-center gap-1.5 hover:bg-slate-700"
          onClick={() => {
            setScanMessage(null);
            setScanning(true);
          }}
        >
          <ScanLine size={16} strokeWidth={2} aria-hidden="true" /> Escanear
        </button>
        <select className="border rounded px-3 py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">Todos los clientes</option>
          {clients?.map((c: any) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className="border rounded px-3 py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="pendiente">Pendiente</option>
          <option value="en_proceso">En proceso</option>
          <option value="despachado">Despachado</option>
        </select>
      </div>

      {scanMessage && <p className="text-red-600 dark:text-red-400 text-sm">{scanMessage}</p>}
      {isLoading && <p className="text-slate-500 dark:text-slate-400">Cargando...</p>}

      <div className="space-y-3">
        {dispatches?.map((d: any) => (
          <div key={d.id} className="bg-white dark:bg-slate-900 rounded-lg shadow p-4">
            <div className="flex flex-wrap justify-between items-center gap-1 mb-2">
              <span className="font-medium">
                Pedido #{d.id} - {d.client.name}
              </span>
              <span className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{d.status}</span>
            </div>
            <ul className="space-y-2">
              {d.items.map((item: any) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm border-t pt-2"
                >
                  <span>
                    {item.product.name} — solicitado: {item.quantityRequested} {item.product.unit}
                    {item.quantityDispatched != null && ` · despachado: ${item.quantityDispatched}`}
                  </span>
                  {item.quantityDispatched == null && (
                    <button
                      className="bg-emerald-600 text-white text-xs px-3 py-1.5 rounded"
                      onClick={() => markDispatched(d.id, item.id, Number(item.quantityRequested))}
                    >
                      Marcar despachado
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {dispatches?.length === 0 && <p className="text-slate-500 dark:text-slate-400">No hay despachos para este filtro.</p>}
      </div>

      {scanning && (
        <BarcodeScanner title="Escanear producto" onDetected={handleScanned} onClose={() => setScanning(false)} />
      )}
    </div>
  );
}
