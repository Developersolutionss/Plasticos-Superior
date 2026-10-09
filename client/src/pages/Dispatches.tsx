import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { Lock, ScanLine } from "lucide-react";
import { api } from "../api/client";
import BarcodeScanner from "../components/BarcodeScanner";
import Modal from "../components/Modal";
import DispatchItemModal from "../components/DispatchItemModal";
import { useAuth } from "../auth/AuthContext";
import { ALMACEN } from "../components/navConfig";

interface ItemDraft {
  productId: string;
  quantity: string;
}

const emptyItem: ItemDraft = { productId: "", quantity: "" };

export default function Dispatches() {
  const [clientId, setClientId] = useState<string>("");
  // "abiertos" = pendiente + en proceso: un despacho parcial pasa a "en
  // proceso" y no tiene que desaparecer de la lista por defecto (falta lo que
  // no salió). Es un filtro de la pantalla, el servidor recibe un estado real.
  const [status, setStatus] = useState<string>("abiertos");
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);
  const [selectedDispatch, setSelectedDispatch] = useState<any>(null);
  // Ítem que se está marcando despachado ahora mismo — deshabilita SU botón
  // mientras la request está en vuelo. Antes no había ningún estado de
  // "enviando", así que un doble clic o un reintento por señal lenta en
  // bodega mandaba dos requests y descontaba el stock dos veces.
  const [dispatchingItemId, setDispatchingItemId] = useState<number | null>(null);
  // Ítem que se está despachando en el modal (rollos, cantidad, estante).
  const [dispatchTarget, setDispatchTarget] = useState<{ dispatch: any; item: any } | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  const [newClientId, setNewClientId] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([{ ...emptyItem }]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const queryClient = useQueryClient();
  const { user } = useAuth();
  // Ventas también entra a esta pantalla (ver App.tsx, DESPACHOS_LECTURA) pero
  // solo para consultar -- crear despacho, marcar ítems y cancelar siguen
  // siendo de Almacén, las mutaciones no aparecen para otro rol.
  const canManage = !!user && (ALMACEN as string[]).includes(user.role);

  // La pantalla de Despachos ya está restringida al rol Almacén/Ventas (ver App.tsx)
  // así que cualquiera que llegue acá puede leer el listado de clientes
  // (GET /clients ahora acepta Ventas o Almacén, ver clients.ts).
  const { data: clients } = useQuery({ queryKey: ["clients"], queryFn: api.getClients });
  const { data: products } = useQuery({ queryKey: ["products"], queryFn: api.getProducts });
  const { data: allDispatches, isLoading } = useQuery({
    queryKey: ["dispatches", clientId, status === "abiertos" ? "" : status],
    queryFn: () =>
      api.getDispatches({ clientId: clientId ? Number(clientId) : undefined, status: status && status !== "abiertos" ? status : undefined }),
  });
  const dispatches = status === "abiertos" ? allDispatches?.filter((d: any) => d.status === "pendiente" || d.status === "en_proceso") : allDispatches;
  // Para el selector opcional de ubicación al marcar despachado — de qué
  // estante puntual sale el producto (ver auditoría de inventario: antes
  // despachar nunca tocaba las ubicaciones, así que el QR de cada estante
  // quedaba desincronizado del stock real apenas salía la primera mercadería).
  const { data: warehouseStock } = useQuery({ queryKey: ["warehouseStock"], queryFn: api.getWarehouseStock });
  // Cuánto está libre de cada producto (el resto está reservado para un
  // cliente y el servidor no deja llevárselo en otro despacho).
  const { data: inventory } = useQuery({ queryKey: ["inventory", ""], queryFn: () => api.getInventory() });
  const stockOf = (productId: string) => inventory?.find((p: any) => String(p.id) === productId);
  // Lo que ya está fabricado para el cliente que se eligió: se despacha desde
  // su pedido (con sus rollos), no armando uno nuevo a mano.
  const { data: reservations } = useQuery({ queryKey: ["clientReservations"], queryFn: api.getClientReservations });
  const clientReserved = newClientId ? (reservations ?? []).filter((r) => String(r.client.id) === newClientId) : [];

  async function handleCancelDispatch(dispatchId: number, reserved = false) {
    const reservedNote = reserved ? " Lo reservado para este cliente pasa a stock libre y se puede despachar a otro." : "";
    if (!confirm(`¿Cancelar este despacho? Si ya tenía ítems despachados, se revierte ese stock (y la ubicación de origen, si se había elegido una).${reservedNote}`)) return;
    setCancellingId(dispatchId);
    try {
      await api.cancelDispatch(dispatchId);
      queryClient.invalidateQueries({ queryKey: ["dispatches"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      queryClient.invalidateQueries({ queryKey: ["warehouseStock"] });
      setSelectedDispatch(null);
    } catch (err: any) {
      setScanMessage(err?.message || "No se pudo cancelar el despacho");
    } finally {
      setCancellingId(null);
    }
  }

  async function handleScanned(sku: string) {
    setScanning(false);
    if (dispatchingItemId != null) return; // ya hay un ítem enviándose, evita duplicar
    const match = dispatches
      ?.flatMap((d: any) => d.items.map((item: any) => ({ dispatch: d, item })))
      .find(({ item }: any) => item.quantityDispatched == null && item.product.sku === sku);

    if (!match) {
      setScanMessage(`No se encontró ningún ítem pendiente con SKU "${sku}".`);
      return;
    }
    // Si el producto ya tiene stock ubicado en algún estante, el escaneo
    // rápido no alcanza — hay que elegir de cuál sale (mismo motivo que
    // `locationRequired` más abajo, para que la ubicación no quede
    // desincronizada). Se pide usar el botón manual, que sí tiene el
    // selector.
    const locations = (warehouseStock?.find((p: any) => p.productId === match.item.product.id)?.locations ?? []).filter(
      (l: any) => l.quantity > 0
    );
    // Lo reservado para un cliente se despacha sin elegir estante (ver abajo).
    if (locations.length > 0 && !match.dispatch.productionOrder) {
      setScanMessage(`${match.item.product.name} tiene stock ubicado en estantes — marcalo despachado a mano abajo para elegir de cuál sale.`);
      return;
    }
    setScanMessage(null);
    // Despachar ahora pide los rollos y la cantidad (puede ser parcial): el
    // escaneo del producto solo ubica el ítem y abre ese paso.
    setDispatchTarget({ dispatch: match.dispatch, item: match.item });
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
      {canManage && (
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
        {clientReserved.length > 0 && (
          <div className="rounded border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/40 px-3 py-2 text-xs text-sky-900 dark:text-sky-200 space-y-0.5">
            <p className="font-medium">Ya hay fabricado para este cliente (se despacha desde su pedido de abajo, con sus rollos):</p>
            {clientReserved.map((r) => (
              <p key={r.dispatchId}>
                Pedido #{r.dispatchId} · {r.items[0]?.product.name} · {r.reservedQuantity} {r.items[0]?.product.unit} ({r.productionOrder.orderNumber}
                {r.rolls.length > 0 ? `: ${r.rolls.map((x) => x.code).join(", ")}` : ""})
              </p>
            ))}
          </div>
        )}

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
              {item.productId && stockOf(item.productId) && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Libres: {stockOf(item.productId).availableStock} {stockOf(item.productId).unit}
                  {stockOf(item.productId).reservedStock > 0 &&
                    ` (hay ${stockOf(item.productId).reservedStock} ${stockOf(item.productId).unit} más reservados para clientes)`}
                </p>
              )}
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
      )}

      <div className="flex flex-wrap items-center gap-3">
        {canManage && (
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
        )}
        <select className="border rounded px-3 py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">Todos los clientes</option>
          {clients?.map((c: any) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className="border rounded px-3 py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="abiertos">Abiertos (pendiente y en proceso)</option>
          <option value="">Todos los estados</option>
          <option value="pendiente">Pendiente</option>
          <option value="en_proceso">En proceso</option>
          <option value="despachado">Despachado</option>
          <option value="cancelada">Cancelada</option>
        </select>
      </div>

      {scanMessage && <p className="text-red-600 dark:text-red-400 text-sm">{scanMessage}</p>}
      {doneMessage && <p className="text-emerald-700 dark:text-emerald-400 text-sm bg-emerald-50 dark:bg-emerald-950 rounded px-3 py-2">{doneMessage}</p>}
      {isLoading && <p className="text-slate-500 dark:text-slate-400">Cargando...</p>}

      <div className="space-y-3">
        {dispatches?.map((d: any) => (
          <div
            key={d.id}
            className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800"
            onClick={() => setSelectedDispatch(d)}
          >
            <div className="flex flex-wrap justify-between items-center gap-1 mb-2">
              <span className="font-medium">
                Pedido #{d.id} - {d.client.name}
                {d.productionOrder && (
                  <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal rounded-full px-2 py-0.5 bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-300">
                    <Lock size={11} aria-hidden="true" />
                    Reservado de{" "}
                    <Link to={`/produccion/ordenes/${d.productionOrder.id}`} onClick={(e) => e.stopPropagation()} className="underline">
                      {d.productionOrder.orderNumber}
                    </Link>
                  </span>
                )}
              </span>
              <span className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{d.status}</span>
                {canManage && d.status !== "cancelada" && (
                  <button
                    type="button"
                    className="text-red-600 dark:text-red-400 text-xs hover:underline disabled:opacity-50"
                    disabled={cancellingId === d.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCancelDispatch(d.id, !!d.productionOrder);
                    }}
                  >
                    {cancellingId === d.id ? "Cancelando..." : "Cancelar"}
                  </button>
                )}
              </span>
            </div>
            <ul className="space-y-2">
              {d.items.map((item: any) => {
                const locations = (warehouseStock?.find((p: any) => p.productId === item.product.id)?.locations ?? []).filter(
                  (l: any) => l.quantity > 0
                );
                return (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 text-sm border-t pt-2">
                    <span>
                      {item.product.name} — solicitado: {item.quantityRequested} {item.product.unit}
                      {item.quantityDispatched != null && ` · despachado: ${item.quantityDispatched}`}
                      {item.rolls?.length > 0 && (
                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                          Rollos: {item.rolls.map((r: any) => `${r.code} (${Number(r.weightKg)} kg)`).join(", ")}
                        </span>
                      )}
                    </span>
                    {canManage && item.quantityDispatched == null && d.status !== "cancelada" && (
                      <span className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="bg-emerald-600 text-white text-xs px-3 py-1.5 rounded disabled:opacity-50"
                          onClick={() => setDispatchTarget({ dispatch: d, item })}
                        >
                          Despachar
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {dispatches?.length === 0 && <p className="text-slate-500 dark:text-slate-400">No hay despachos para este filtro.</p>}
      </div>

      {scanning && (
        <BarcodeScanner title="Escanear producto" onDetected={handleScanned} onClose={() => setScanning(false)} />
      )}

      {dispatchTarget && (
        <DispatchItemModal
          dispatch={dispatchTarget.dispatch}
          item={dispatchTarget.item}
          locations={(warehouseStock?.find((p: any) => p.productId === dispatchTarget.item.product.id)?.locations ?? []).filter((l: any) => l.quantity > 0)}
          onClose={() => setDispatchTarget(null)}
          onDone={(message) => {
            setDispatchTarget(null);
            setScanMessage(null);
            setDoneMessage(message);
          }}
        />
      )}

      {selectedDispatch && (
        <Modal title={`Pedido #${selectedDispatch.id} - ${selectedDispatch.client.name}`} onClose={() => setSelectedDispatch(null)}>
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Estado</p>
                <p className="text-slate-800 dark:text-slate-100">{selectedDispatch.status}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Solicitado</p>
                <p className="text-slate-800 dark:text-slate-100">{new Date(selectedDispatch.requestedDate).toLocaleString()}</p>
              </div>
              {selectedDispatch.dispatchedDate && (
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Despachado</p>
                  <p className="text-slate-800 dark:text-slate-100">{new Date(selectedDispatch.dispatchedDate).toLocaleString()}</p>
                </div>
              )}
              {selectedDispatch.createdBy?.name && (
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Registrado por</p>
                  <p className="text-slate-800 dark:text-slate-100">{selectedDispatch.createdBy.name}</p>
                </div>
              )}
            </div>

            {selectedDispatch.dispatchedDate && (
              <p className="text-xs">
                {selectedDispatch.notifiedAt ? (
                  <span className="text-emerald-700 dark:text-emerald-400">✓ Se avisó al cliente por WhatsApp</span>
                ) : (
                  <span className="text-amber-700 dark:text-amber-400">
                    ⚠ No se le avisó al cliente por WhatsApp{selectedDispatch.notifyError ? ` — ${selectedDispatch.notifyError}` : ""}
                  </span>
                )}
              </p>
            )}

            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1.5">Productos</p>
              <ul className="divide-y">
                {selectedDispatch.items.map((item: any) => (
                  <li key={item.id} className="py-2 space-y-0.5">
                    <p className="font-medium text-slate-800 dark:text-slate-100">{item.product.name}</p>
                    <p className="text-slate-600 dark:text-slate-300">
                      Solicitado: {item.quantityRequested} {item.product.unit}
                      {item.quantityDispatched != null && ` · Despachado: ${item.quantityDispatched} ${item.product.unit}`}
                    </p>
                    {item.labelCode && <p className="text-slate-500 dark:text-slate-400 text-xs">Etiqueta escaneada: {item.labelCode}</p>}
                    {item.notes && <p className="text-slate-500 dark:text-slate-400 text-xs">Notas: {item.notes}</p>}
                  </li>
                ))}
              </ul>
            </div>

            {canManage && selectedDispatch.status !== "cancelada" && (
              <button
                type="button"
                className="text-red-600 dark:text-red-400 text-sm hover:underline disabled:opacity-50"
                disabled={cancellingId === selectedDispatch.id}
                onClick={() => handleCancelDispatch(selectedDispatch.id, !!selectedDispatch.productionOrder)}
              >
                {cancellingId === selectedDispatch.id ? "Cancelando..." : "Cancelar despacho"}
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
