import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Lock, Printer, ScanLine } from "lucide-react";
import { api } from "../api/client";
import BarcodeScanner from "../components/BarcodeScanner";
import Modal from "../components/Modal";
import DispatchItemModal from "../components/DispatchItemModal";
import { useConfirm } from "../components/ConfirmDialog";
import { useAuth } from "../auth/AuthContext";
import { ALMACEN } from "../components/navConfig";
import { splitScannedCode } from "../lib/rollQr";
import { printRemision } from "../lib/printRemision";

interface ItemDraft {
  productId: string;
  quantity: string;
}

const emptyItem: ItemDraft = { productId: "", quantity: "" };

/** Cuántos despachos se traen por tanda ("Cargar más" pide otra). */
const PAGE = 30;

export const DISPATCH_STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  en_proceso: "En proceso (parcial)",
  despachado: "Despachado",
  cancelada: "Cancelado",
};
const STATUS_COLORS: Record<string, string> = {
  pendiente: "bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300",
  en_proceso: "bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-300",
  despachado: "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300",
  cancelada: "bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400",
};

function StatusBadge({ status }: { status: string }) {
  return <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${STATUS_COLORS[status] ?? ""}`}>{DISPATCH_STATUS_LABELS[status] ?? status}</span>;
}

const fecha = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("es-CO", { dateStyle: "medium" }) : "—");
// Código de rollo (EXT-12, SELL-3, o el viejo RL-40). Una etiqueta de bulto
// tiene la forma EXT- + 5 cifras (EXT-00001): no es un rollo.
const ROLL_CODE = /^((EXT|IMP|SELL|PRE)-\d+|RL-\d+)$/;
const BULTO_LABEL = /^EXT-\d{5}$/;

type RollTarget = { dispatchId: number; itemId: number; clientName: string; reserved: boolean; quantityRequested: number };

export default function Dispatches() {
  const [clientId, setClientId] = useState<string>("");
  // "abiertos" = pendiente + en proceso: un despacho parcial pasa a "en
  // proceso" y no tiene que desaparecer de la lista por defecto (falta lo que
  // no salió). El servidor lo entiende como filtro.
  const [status, setStatus] = useState<string>("abiertos");
  const [limit, setLimit] = useState(PAGE);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Ítem que se está despachando en el modal (rollos, cantidad, estante).
  const [dispatchTarget, setDispatchTarget] = useState<{ dispatch: any; item: any; initialScan?: { code: string; token: string } } | null>(null);
  // Un rollo escaneado que puede ir a más de un despacho: el usuario elige.
  const [rollChoice, setRollChoice] = useState<{ code: string; token: string; targets: RollTarget[] } | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  const [newClientId, setNewClientId] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([{ ...emptyItem }]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { user } = useAuth();
  // Ventas también entra a esta pantalla (ver App.tsx, DESPACHOS_LECTURA) pero
  // solo para consultar -- crear despacho, marcar ítems y cancelar siguen
  // siendo de Almacén, las mutaciones no aparecen para otro rol.
  const canManage = !!user && (ALMACEN as string[]).includes(user.role);

  const { data: clients } = useQuery({ queryKey: ["clients"], queryFn: api.getClients });
  const { data: products } = useQuery({ queryKey: ["products"], queryFn: api.getProducts });
  const { data: dispatches, isLoading } = useQuery({
    queryKey: ["dispatches", clientId, status, limit],
    queryFn: () => api.getDispatches({ clientId: clientId ? Number(clientId) : undefined, status: status || undefined, limit }),
  });
  // Estantes con stock de cada producto (para el despacho) — Ventas no tiene
  // acceso y la pantalla funciona igual sin esto.
  const { data: warehouseStock } = useQuery({ queryKey: ["warehouseStock"], queryFn: api.getWarehouseStock, enabled: canManage });
  // Cuánto está libre de cada producto (el resto está reservado para un
  // cliente y el servidor no deja llevárselo en otro despacho).
  const { data: inventory } = useQuery({ queryKey: ["inventory", ""], queryFn: () => api.getInventory() });
  const stockOf = (productId: string | number) => inventory?.find((p: any) => String(p.id) === String(productId));
  // Lo que ya está fabricado para el cliente que se eligió: se despacha desde
  // su despacho reservado (con sus rollos), no armando uno nuevo a mano.
  const { data: reservations } = useQuery({ queryKey: ["clientReservations"], queryFn: api.getClientReservations });
  const clientReserved = newClientId ? (reservations ?? []).filter((r) => String(r.client.id) === newClientId) : [];
  const detailQuery = useQuery({
    queryKey: ["dispatch", selectedId],
    queryFn: () => api.getDispatch(selectedId!),
    enabled: selectedId != null,
  });

  const locationsOf = (productId: number) =>
    (warehouseStock?.find((p: any) => p.productId === productId)?.locations ?? []).filter((l: any) => l.quantity > 0);

  async function handleCancelDispatch(dispatchId: number, reserved = false) {
    const reservedNote = reserved ? " Lo reservado para este cliente pasa a stock libre y se puede despachar a otro." : "";
    const ok = await confirm(`Si ya tenía ítems despachados, se revierte ese stock (y la ubicación de origen, si se había elegido una).${reservedNote}`, {
      title: `¿Cancelar el despacho #${dispatchId}?`,
      confirmLabel: "Cancelar despacho",
      tone: "danger",
    });
    if (!ok) return;
    setCancellingId(dispatchId);
    try {
      await api.cancelDispatch(dispatchId);
      for (const key of ["dispatches", "dispatch", "inventory", "alerts", "warehouseStock", "clientReservations"]) queryClient.invalidateQueries({ queryKey: [key] });
      setSelectedId(null);
    } catch (err: any) {
      setScanMessage(err?.message || "No se pudo cancelar el despacho");
    } finally {
      setCancellingId(null);
    }
  }

  /** Abre el despacho de un ítem con el rollo escaneado ya marcado. */
  async function openTarget(t: RollTarget, code: string, token: string) {
    setRollChoice(null);
    try {
      const d = await api.getDispatch(t.dispatchId);
      const item = d.items.find((i: any) => i.id === t.itemId);
      if (!item) throw new Error("No se encontró el ítem del despacho");
      setDispatchTarget({ dispatch: d, item, initialScan: { code, token } });
    } catch (err: any) {
      setScanMessage(err?.message || "No se pudo abrir el despacho");
    }
  }

  async function handleScanned(raw: string) {
    setScanning(false);
    setScanMessage(null);
    setDoneMessage(null);
    const { code, token } = splitScannedCode(raw.trim());

    if (BULTO_LABEL.test(code) && !token) {
      setScanMessage(`${code} es una etiqueta de bulto, no el QR de un rollo — escaneá la etiqueta del rollo (código y token)`);
      return;
    }
    // QR de un rollo: se busca a qué despacho abierto puede ir.
    if (ROLL_CODE.test(code)) {
      if (!token) {
        setScanMessage(`El código ${code} no trae el token — escaneá el QR de la etiqueta del rollo, o tipeá el código completo (${code}-TOKEN)`);
        return;
      }
      try {
        const res = await api.getDispatchTargetsForRoll(code, token);
        if (res.targets.length === 0) setScanMessage(res.reason ?? `El rollo ${code} no tiene un despacho abierto donde salir`);
        else if (res.targets.length === 1) await openTarget(res.targets[0], res.code, token);
        else setRollChoice({ code: res.code, token, targets: res.targets });
      } catch (err: any) {
        setScanMessage(err?.message || "No se pudo buscar el rollo");
      }
      return;
    }

    // Código de producto (SKU): ubica el primer ítem pendiente de ese producto.
    const match = (dispatches ?? [])
      .flatMap((d: any) => d.items.map((item: any) => ({ dispatch: d, item })))
      .find(({ dispatch, item }: any) => item.quantityDispatched == null && dispatch.status !== "cancelada" && item.product.sku === code);
    if (!match) {
      setScanMessage(`No se encontró ningún ítem pendiente con el código "${code}".`);
      return;
    }
    setDispatchTarget({ dispatch: match.dispatch, item: match.item });
  }

  function updateItem(i: number, patch: Partial<ItemDraft>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  /** Al elegir el producto se precarga lo que hay libre (editable). */
  function chooseProduct(i: number, productId: string) {
    const free = productId ? Number(stockOf(productId)?.availableStock ?? 0) : 0;
    setItems((prev) =>
      prev.map((it, idx) => (idx === i ? { productId, quantity: it.quantity || (free > 0 ? String(Math.round(free * 100) / 100) : "") } : it))
    );
  }

  async function handleCreateDispatch(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreateMessage(null);
    const validItems = items.filter((it) => it.productId && Number(it.quantity) > 0);
    if (!newClientId || validItems.length === 0) {
      setCreateError("Elegí un cliente y al menos un producto con su cantidad");
      return;
    }
    // El mismo producto en dos líneas se une en una (se suman las cantidades).
    const merged = new Map<number, number>();
    for (const it of validItems) merged.set(Number(it.productId), (merged.get(Number(it.productId)) ?? 0) + Number(it.quantity));
    setCreating(true);
    try {
      const created = await api.createDispatch(
        Number(newClientId),
        [...merged.entries()].map(([productId, quantityRequested]) => ({ productId, quantityRequested: Math.round(quantityRequested * 100) / 100 }))
      );
      setNewClientId("");
      setItems([{ ...emptyItem }]);
      setCreateMessage(`Despacho #${created.id} creado.`);
      queryClient.invalidateQueries({ queryKey: ["dispatches"] });
    } catch (err: any) {
      setCreateError(err?.message || "No se pudo crear el despacho");
    } finally {
      setCreating(false);
    }
  }

  const detail = detailQuery.data;
  const hasMore = (dispatches?.length ?? 0) >= limit;

  return (
    <div className="space-y-4">
      {canManage && (
        <form onSubmit={handleCreateDispatch} className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 space-y-2 max-w-xl">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Nuevo despacho</p>
          {createError && <p className="text-red-600 dark:text-red-400 text-sm">{createError}</p>}
          {createMessage && <p className="text-emerald-700 dark:text-emerald-400 text-sm">{createMessage}</p>}

          <select
            aria-label="Cliente del despacho"
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
              <p className="font-medium">Ya hay fabricado para este cliente (se despacha desde su despacho de abajo, con sus rollos):</p>
              {clientReserved.map((r) => (
                <p key={r.dispatchId}>
                  Despacho #{r.dispatchId} · {r.items[0]?.product.name} · {r.reservedQuantity} {r.items[0]?.product.unit} ({r.productionOrder.orderNumber}
                  {r.rolls.length > 0 ? `: ${r.rolls.map((x) => x.code).join(", ")}` : ""})
                </p>
              ))}
            </div>
          )}

          <div className="space-y-2">
            {items.map((item, i) => {
              const stock = item.productId ? stockOf(item.productId) : null;
              const free = stock ? Number(stock.availableStock) : null;
              const qty = Number(item.quantity);
              const duplicated = !!item.productId && items.some((o, j) => j !== i && o.productId === item.productId);
              return (
                <div key={i} className="border rounded p-2 space-y-2 dark:border-slate-600">
                  <select
                    aria-label={`Producto ${i + 1}`}
                    className="border rounded px-2 py-2 text-sm w-full dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    value={item.productId}
                    onChange={(e) => chooseProduct(i, e.target.value)}
                  >
                    <option value="">Producto...</option>
                    {products?.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {stock && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Libres: {stock.availableStock} {stock.unit}
                      {stock.reservedStock > 0 && ` (hay ${stock.reservedStock} ${stock.unit} más reservados para clientes)`}
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      aria-label={`Cantidad ${i + 1}`}
                      className="border rounded px-2 py-2 text-sm min-w-0 flex-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      placeholder="Cantidad"
                      type="number"
                      step="0.01"
                      min="0"
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
                  {free != null && qty > free + 0.005 && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Solo hay {Math.max(0, free)} {stock.unit} libres: el despacho se crea, pero no se va a poder marcar hasta que haya stock.
                    </p>
                  )}
                  {duplicated && <p className="text-xs text-amber-700 dark:text-amber-400">Este producto está en otra línea: al crear se suman en una sola.</p>}
                </div>
              );
            })}
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
            title="Escaneá el QR de un rollo (abre su despacho con el rollo ya marcado) o el código de un producto"
          >
            <ScanLine size={16} strokeWidth={2} aria-hidden="true" /> Escanear rollo o producto
          </button>
        )}
        <select
          aria-label="Filtrar por cliente"
          className="border rounded px-3 py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value);
            setLimit(PAGE);
          }}
        >
          <option value="">Todos los clientes</option>
          {clients?.map((c: any) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filtrar por estado"
          className="border rounded px-3 py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setLimit(PAGE);
          }}
        >
          <option value="abiertos">Abiertos (pendientes y parciales)</option>
          <option value="">Todos los estados</option>
          <option value="pendiente">Pendiente</option>
          <option value="en_proceso">En proceso (parcial)</option>
          <option value="despachado">Despachado</option>
          <option value="cancelada">Cancelado</option>
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
            onClick={() => setSelectedId(d.id)}
          >
            <div className="flex flex-wrap justify-between items-start gap-2 mb-2">
              <div>
                <p className="font-medium">
                  Despacho #{d.id} — {d.client.name}
                  {d.productionOrder && (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal rounded-full px-2 py-0.5 bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-300">
                      <Lock size={11} aria-hidden="true" />
                      Reservado de{" "}
                      <Link to={`/produccion/ordenes/${d.productionOrder.id}`} onClick={(e) => e.stopPropagation()} className="underline">
                        {d.productionOrder.orderNumber}
                      </Link>
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Creado {fecha(d.requestedDate)}
                  {d.dispatchedDate && ` · despachado ${fecha(d.dispatchedDate)}`}
                </p>
              </div>
              <span className="flex items-center gap-2">
                <StatusBadge status={d.status} />
                {canManage && d.status !== "cancelada" && d.status !== "despachado" && (
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
                const pendingItem = item.quantityDispatched == null && d.status !== "cancelada";
                const stock = stockOf(item.product.id);
                // Un despacho armado a mano solo se lleva lo libre: si no
                // alcanza para todo, se avisa acá (puede salir parcial con lo
                // libre); solo se bloquea si no hay nada libre.
                const free = stock ? Number(stock.availableStock) : null;
                const short = pendingItem && !d.productionOrder && free != null && free < Number(item.quantityRequested) - 0.005;
                const nothingFree = short && free! <= 0.005;
                return (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 text-sm border-t pt-2">
                    <span>
                      {item.product.name} — solicitado: {Number(item.quantityRequested)} {item.product.unit}
                      {item.quantityDispatched != null && ` · despachado: ${Number(item.quantityDispatched)} ${item.product.unit}`}
                      {item.rolls?.length > 0 && (
                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                          Rollos: {item.rolls.map((r: any) => `${r.code} (${Number(r.weightKg)} kg)`).join(", ")}
                        </span>
                      )}
                      {short && (
                        <span className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                          <AlertTriangle size={12} aria-hidden="true" />
                          {nothingFree ? "Esperando stock" : "Stock libre no alcanza para todo"}: hay {Math.max(0, free!)} {item.product.unit} libres
                          {Number(stock.reservedStock) > 0 && ` (${stock.reservedStock} ${item.product.unit} están reservados para clientes)`}
                          {!nothingFree && " — se puede despachar parcial"}
                        </span>
                      )}
                    </span>
                    {canManage && pendingItem && (
                      <span className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="bg-emerald-600 text-white text-xs px-3 py-1.5 rounded disabled:opacity-50"
                          disabled={!!nothingFree}
                          title={nothingFree ? "No hay stock libre de este producto" : undefined}
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
        {hasMore && (
          <button type="button" className="text-sm text-sky-700 dark:text-sky-400 hover:underline" onClick={() => setLimit((l) => l + PAGE)}>
            Cargar más despachos
          </button>
        )}
      </div>

      {scanning && <BarcodeScanner title="Escanear rollo o producto" onDetected={handleScanned} onClose={() => setScanning(false)} />}

      {rollChoice && (
        <Modal title={`¿En qué despacho sale ${rollChoice.code}?`} onClose={() => setRollChoice(null)}>
          <div className="space-y-2 text-sm">
            <p className="text-slate-600 dark:text-slate-300">Este rollo puede salir en más de un despacho abierto:</p>
            {rollChoice.targets.map((t) => (
              <button
                key={`${t.dispatchId}-${t.itemId}`}
                type="button"
                onClick={() => openTarget(t, rollChoice.code, rollChoice.token)}
                className="w-full text-left border rounded-lg px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 dark:border-slate-600"
              >
                <strong>Despacho #{t.dispatchId}</strong> — {t.clientName} · pedido {t.quantityRequested}
                {t.reserved ? " · reservado" : ""}
              </button>
            ))}
          </div>
        </Modal>
      )}

      {dispatchTarget && (
        <DispatchItemModal
          dispatch={dispatchTarget.dispatch}
          item={dispatchTarget.item}
          initialScan={dispatchTarget.initialScan}
          locations={locationsOf(dispatchTarget.item.product.id)}
          onClose={() => setDispatchTarget(null)}
          onDone={(message) => {
            setDispatchTarget(null);
            setScanMessage(null);
            setDoneMessage(message);
            queryClient.invalidateQueries({ queryKey: ["dispatch"] });
          }}
        />
      )}

      {selectedId != null && (
        <Modal title={detail ? `Despacho #${detail.id} — ${detail.client.name}` : `Despacho #${selectedId}`} onClose={() => setSelectedId(null)}>
          {!detail ? (
            <p className="text-sm text-slate-500">{detailQuery.isError ? "No se pudo cargar el despacho." : "Cargando..."}</p>
          ) : (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Estado</p>
                  <StatusBadge status={detail.status} />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Creado</p>
                  <p className="text-slate-800 dark:text-slate-100">{new Date(detail.requestedDate).toLocaleString()}</p>
                </div>
                {detail.dispatchedDate && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Despachado</p>
                    <p className="text-slate-800 dark:text-slate-100">{new Date(detail.dispatchedDate).toLocaleString()}</p>
                  </div>
                )}
                {detail.createdBy?.name && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Registrado por</p>
                    <p className="text-slate-800 dark:text-slate-100">{detail.createdBy.name}</p>
                  </div>
                )}
                {detail.productionOrder && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Reservado de</p>
                    <Link to={`/produccion/ordenes/${detail.productionOrder.id}`} className="text-sky-700 dark:text-sky-400 hover:underline">
                      {detail.productionOrder.orderNumber}
                    </Link>
                  </div>
                )}
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Entrega</p>
                  <p className="text-slate-800 dark:text-slate-100">
                    {detail.client.addresses?.[0] ? `${detail.client.addresses[0].addressLine}${detail.client.addresses[0].city ? `, ${detail.client.addresses[0].city}` : ""}` : "Sin dirección cargada"}
                  </p>
                </div>
              </div>

              {detail.dispatchedDate && (
                <p className="text-xs">
                  {detail.notifiedAt ? (
                    <span className="text-emerald-700 dark:text-emerald-400">✓ Se avisó al cliente por WhatsApp</span>
                  ) : (
                    <span className="text-amber-700 dark:text-amber-400">
                      ⚠ No se le avisó al cliente por WhatsApp{detail.notifyError ? ` — ${detail.notifyError}` : ""}
                    </span>
                  )}
                </p>
              )}

              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1.5">Productos</p>
                <ul className="divide-y">
                  {detail.items.map((item: any) => (
                    <li key={item.id} className="py-2 space-y-0.5">
                      <p className="font-medium text-slate-800 dark:text-slate-100">{item.product.name}</p>
                      <p className="text-slate-600 dark:text-slate-300">
                        Solicitado: {Number(item.quantityRequested)} {item.product.unit}
                        {item.quantityDispatched != null ? ` · Despachado: ${Number(item.quantityDispatched)} ${item.product.unit}` : " · Pendiente"}
                        {item.location?.code && ` · salió del estante ${item.location.code}`}
                      </p>
                      {item.rolls?.length > 0 && (
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Rollos: {item.rolls.map((r: any) => `${r.code} (${Number(r.weightKg)} kg${r.scannedBy?.name ? `, escaneó ${r.scannedBy.name}` : ""})`).join(", ")}
                        </p>
                      )}
                      {item.labelCode && <p className="text-slate-500 dark:text-slate-400 text-xs">Etiqueta escaneada: {item.labelCode}</p>}
                      {item.notes && <p className="text-slate-500 dark:text-slate-400 text-xs">Notas: {item.notes}</p>}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                {detail.items.some((i: any) => i.quantityDispatched != null) && detail.status !== "cancelada" ? (
                  <button
                    type="button"
                    onClick={() => printRemision(detail)}
                    className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded px-3 py-1.5"
                  >
                    <Printer size={14} aria-hidden="true" /> Imprimir remisión
                  </button>
                ) : (
                  <span />
                )}
                {canManage && detail.status !== "cancelada" && (
                  <button
                    type="button"
                    className="text-red-600 dark:text-red-400 text-sm hover:underline disabled:opacity-50"
                    disabled={cancellingId === detail.id}
                    onClick={() => handleCancelDispatch(detail.id, !!detail.productionOrder)}
                  >
                    {cancellingId === detail.id ? "Cancelando..." : "Cancelar despacho"}
                  </button>
                )}
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
