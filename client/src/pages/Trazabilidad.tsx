import { useQuery } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { CircleCheck, CircleX, CircleDashed, Factory, FlaskConical, Package, ScanLine, Warehouse, Truck } from "lucide-react";
import { api } from "../api/client";
import AsyncState from "../components/AsyncState";
import BarcodeScanner from "../components/BarcodeScanner";
import { SkeletonCard } from "../components/Skeleton";
import { splitScannedCode } from "../lib/rollQr";
import { ROLL_CODE_PREFIX, type OpStation } from "../opTemplates";

/** El código que está impreso en la etiqueta física del rollo (EXT-3,
 * SELL-12...), no el id interno de la base — antes esta pantalla mostraba
 * "Rollo" o "#91", que no coincide con nada de lo que ve el operario. */
function rollCode(r: { station: string; stationSequence: number; label?: string | null }): string {
  const code = `${ROLL_CODE_PREFIX[r.station as OpStation] ?? r.station}-${r.stationSequence}`;
  return r.label && r.label !== code ? `${code} (${r.label})` : code;
}

const STATION_LABELS: Record<string, string> = {
  extrusion: "Extrusión",
  impresion: "Impresión",
  sellado: "Sellado",
  precorte: "Precorte",
};

const STATUS_LABELS: Record<string, string> = {
  borrador: "Borrador",
  pendiente: "Pendiente",
  en_proceso: "En proceso",
  pendiente_calidad: "Pendiente de calidad",
  detenida: "Detenida",
  finalizada: "Terminada",
  cancelada: "Cancelada",
};

/** Arma la cadena completa (todas las etapas comparten orderNumber, ver
 * GET /production-orders/:id) como filas con profundidad, para dibujarla
 * de una sola vez en vez de ir clickeando padre por padre. */
function buildChainRows(chain: any[]) {
  const byId = new Map(chain.map((c) => [c.id, c]));
  const childrenOf = new Map<number, any[]>();
  for (const c of chain) {
    if (c.parentOrderId != null) {
      if (!childrenOf.has(c.parentOrderId)) childrenOf.set(c.parentOrderId, []);
      childrenOf.get(c.parentOrderId)!.push(c);
    }
  }
  const roots = chain.filter((c) => c.parentOrderId == null || !byId.has(c.parentOrderId));
  const rows: { node: any; depth: number }[] = [];
  function walk(node: any, depth: number) {
    rows.push({ node, depth });
    for (const child of childrenOf.get(node.id) ?? []) walk(child, depth + 1);
  }
  for (const r of roots) walk(r, 0);
  return rows;
}

function kgOf(node: any) {
  // Precorte carga 2 rollos de insumo por fila (ver opTemplates.ts) — el
  // segundo peso queda en details.pesoR2 y cuenta igual que el primero.
  return (node.rolls ?? []).reduce((acc: number, r: any) => {
    const r2 = node.station === "precorte" ? Number(r.details?.pesoR2 ?? 0) : 0;
    return acc + Number(r.weightKg) + (Number.isFinite(r2) ? r2 : 0);
  }, 0);
}

export default function Trazabilidad() {
  const [selectedId, setSelectedId] = useState("");
  const [highlightRollId, setHighlightRollId] = useState<number | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  /** Rastrea desde un código físico: el QR de un rollo (con o sin token de
   * posesión), una etiqueta de bulto o el número de OP. */
  async function traceCode(raw: string) {
    setSearchError(null);
    const { code } = splitScannedCode(raw.trim());
    if (!code) return;
    try {
      const found = await api.traceByCode(code);
      setSelectedId(String(found.orderId));
      setHighlightRollId(found.rollId);
      setCodeInput("");
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "No se encontró ese código");
    }
  }

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    traceCode(codeInput);
  }

  const { data: orders } = useQuery({ queryKey: ["productionOrders"], queryFn: () => api.getProductionOrders() });
  const orderQuery = useQuery({
    queryKey: ["productionOrder", selectedId],
    queryFn: () => api.getProductionOrder(Number(selectedId)),
    enabled: !!selectedId,
  });

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Trazabilidad</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Historial completo de una orden de producción: estaciones, rollos, materia prima, movimientos entre bodegas, calidad y despacho. Buscá por OP o escaneá un rollo.
        </p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5 space-y-3">
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            className="flex-1 border border-slate-300 dark:border-slate-600 rounded-md px-3 py-2 text-sm text-slate-800 dark:text-slate-100 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300"
            placeholder="Código de rollo (EXT-3), etiqueta de bulto (EXT-00012) u OP (OP-00031)"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
          />
          <button type="submit" className="bg-slate-800 text-white text-sm px-3 py-2 rounded-md">
            Buscar
          </button>
          <button
            type="button"
            onClick={() => setScanning(true)}
            title="Escanear el QR del rollo o de la etiqueta de bulto"
            className="inline-flex items-center gap-1.5 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-sm px-3 py-2 rounded-md"
          >
            <ScanLine size={16} aria-hidden="true" /> Escanear
          </button>
        </form>
        {searchError && <p className="text-sm text-red-600 dark:text-red-400">{searchError}</p>}
        <select
          className="w-full border border-slate-300 dark:border-slate-600 rounded-md px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-500"
          value={selectedId}
          onChange={(e) => {
            setSelectedId(e.target.value);
            setHighlightRollId(null);
          }}
        >
          <option value="">Orden de producción (OP)...</option>
          {orders?.map((o: any) => (
            <option key={o.id} value={o.id}>
              {o.orderNumber} ({STATION_LABELS[o.station] ?? o.station ?? "Sin proceso"}) — {o.product.name}
            </option>
          ))}
        </select>
      </div>

      {selectedId && (
        <AsyncState
          query={orderQuery}
          skeleton={<SkeletonCard />}
          errorMessage="No se pudo cargar la trazabilidad de esta orden."
        >
          {(order) => {
            const origin = order.pedidoVersionItem?.pedidoVersion?.pedido;
            return (
        <>
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100 dark:border-slate-700">
              <Package size={16} strokeWidth={2} className="text-slate-500 dark:text-slate-400" aria-hidden="true" />
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{order.orderNumber}</p>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">Producto</span>
                <span className="text-slate-800 dark:text-slate-100">
                  {order.product.name} ({order.product.sku})
                </span>
              </div>
              <div>
                <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">Cantidad planificada</span>
                <span className="text-slate-800 dark:text-slate-100">
                  {order.quantityPlanned} {order.product.unit}
                </span>
              </div>
              <div>
                <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">Proceso</span>
                <span className="text-slate-800 dark:text-slate-100">{STATION_LABELS[order.station] ?? order.station ?? "Sin proceso"}</span>
              </div>
              <div>
                <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">Cliente</span>
                <span className="text-slate-800 dark:text-slate-100">{order.client?.name ?? "—"}</span>
              </div>
              <div className="sm:col-span-2">
                <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">Origen</span>
                <span className="text-slate-800 dark:text-slate-100">
                  {origin ? `Pedido ${origin.orderNumber} — ${origin.client.name}` : "Producción a stock (sin pedido de origen)"}
                </span>
              </div>
              {order.chain?.length > 1 && (
                <div className="sm:col-span-2">
                  <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Cadena de derivación completa</span>
                  <ul className="space-y-1">
                    {buildChainRows(order.chain).map(({ node, depth }) => (
                      <li
                        key={node.id}
                        style={{ paddingLeft: depth * 16 }}
                        className={`flex items-center gap-2 text-slate-800 dark:text-slate-100 ${node.id === order.id ? "font-semibold" : ""}`}
                      >
                        {depth > 0 && <span className="text-slate-400 dark:text-slate-500">↳</span>}
                        <span>{STATION_LABELS[node.station] ?? node.station ?? "Sin proceso"}</span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          ({STATUS_LABELS[node.status] ?? node.status}, {Math.round(kgOf(node) * 100) / 100} kg)
                        </span>
                        {node.id === order.id && <span className="text-xs text-sky-600 dark:text-sky-400">← esta</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {(() => {
            // Lotes de materia prima de Extrusión (la etapa que funde la
            // resina) de toda la cadena: es lo que hace falta para rastrear
            // un problema de material hasta el lote del proveedor.
            const lotes = (order.chain ?? [])
              .filter((n: any) => n.station === "extrusion")
              .flatMap((n: any) => (Array.isArray(n.specs?.materiaPrima) ? n.specs.materiaPrima : []))
              .filter((row: any) => Number(row.pct) > 0 || row.lote);
            if (lotes.length === 0) return null;
            return (
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100 dark:border-slate-700">
                  <FlaskConical size={16} strokeWidth={2} className="text-slate-500 dark:text-slate-400" aria-hidden="true" />
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Materia prima (Extrusión)</p>
                </div>
                <ul className="divide-y divide-slate-100 dark:divide-slate-700 text-sm">
                  {lotes.map((row: any, i: number) => (
                    <li key={i} className="px-5 py-2 flex items-center justify-between">
                      <span className="text-slate-800 dark:text-slate-100">
                        {row.ref} {row.pct ? <span className="text-slate-500 dark:text-slate-400">· {row.pct}%</span> : null}
                      </span>
                      <span className="text-slate-500 dark:text-slate-400">{row.lote ? `Lote ${row.lote}` : "sin lote cargado"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}

          {order.dispatches?.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100 dark:border-slate-700">
                <Truck size={16} strokeWidth={2} className="text-slate-500 dark:text-slate-400" aria-hidden="true" />
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Despacho a cliente de esta OP</p>
              </div>
              <ul className="divide-y divide-slate-100 dark:divide-slate-700 text-sm">
                {order.dispatches.map((d: any) => {
                  const kg = d.items.reduce((acc: number, it: any) => acc + Number(it.quantityDispatched ?? it.quantityRequested), 0);
                  return (
                    <li key={d.id} className="px-5 py-3 flex items-center justify-between">
                      <span className="text-slate-800 dark:text-slate-100">
                        Despacho #{d.id} · {d.client.name} · {Math.round(kg * 100) / 100} {order.product.unit}
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {d.status === "despachado" && d.dispatchedDate ? `despachado ${new Date(d.dispatchedDate).toLocaleDateString()}` : d.status}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100 dark:border-slate-700">
              <Warehouse size={16} strokeWidth={2} className="text-slate-500 dark:text-slate-400" aria-hidden="true" />
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Ubicación actual en almacén</p>
            </div>
            <div className="p-5 text-sm">
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                Stock actual de {order.product.name} por estantería — el inventario no distingue de qué OP vino cada kilo, así que esto es la
                foto general del producto, no específicamente el lote de esta OP.
              </p>
              {order.warehouseLocations?.length > 0 ? (
                <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                  {order.warehouseLocations.map((wl: any, i: number) => (
                    <li key={i} className="py-2 flex items-center justify-between">
                      <span className="text-slate-800 dark:text-slate-100">
                        {wl.location.code} — {wl.location.label}
                      </span>
                      <span className="text-slate-500 dark:text-slate-400">{Number(wl.quantity)} {order.product.unit}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-slate-500 dark:text-slate-400">Este producto todavía no tiene stock ubicado en ninguna estantería.</p>
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100 dark:border-slate-700">
              <Truck size={16} strokeWidth={2} className="text-slate-500 dark:text-slate-400" aria-hidden="true" />
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Despachos recientes de este producto</p>
            </div>
            <ul className="divide-y divide-slate-100 dark:divide-slate-700 text-sm">
              {order.recentDispatchItems?.map((it: any) => (
                <li key={it.id} className="px-5 py-3 flex items-center justify-between">
                  <span className="text-slate-800 dark:text-slate-100">
                    {it.dispatch.client.name} · {Number(it.quantityDispatched ?? it.quantityRequested)} {order.product.unit}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {it.dispatch.status === "despachado" && it.dispatch.dispatchedDate
                      ? new Date(it.dispatch.dispatchedDate).toLocaleDateString()
                      : "pendiente"}
                  </span>
                </li>
              ))}
              {(!order.recentDispatchItems || order.recentDispatchItems.length === 0) && (
                <li className="px-5 py-4 text-slate-500 dark:text-slate-400">Este producto todavía no tiene despachos.</li>
              )}
            </ul>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100 dark:border-slate-700">
              <Factory size={16} strokeWidth={2} className="text-slate-500 dark:text-slate-400" aria-hidden="true" />
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Registro de rollos</p>
            </div>
            <ul className="divide-y divide-slate-100 dark:divide-slate-700 text-sm">
              {order.rolls?.map((r: any) => (
                <li
                  key={r.id}
                  className={`px-5 py-3 ${r.id === highlightRollId ? "bg-amber-50 dark:bg-amber-950/40 ring-1 ring-inset ring-amber-300" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-800 dark:text-slate-100">
                      {rollCode(r)} · {Number(r.weightKg)} kg
                      {r.bultoLabel && <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">· bulto {r.bultoLabel.code}</span>}
                    </span>
                    <span className="text-slate-500 dark:text-slate-400">{new Date(r.date).toLocaleDateString()}</span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-300 mt-0.5">
                    {[r.shift, r.operatorName, r.machine].filter(Boolean).join(" · ")}
                    {Number(r.wasteKg) > 0 && ` · desperdicio ${Number(r.wasteKg)} kg`}
                  </p>
                  {r.createdBy?.name && r.createdBy.name !== r.operatorName && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                      Cargado desde la cuenta de {r.createdBy.name}
                    </p>
                  )}
                  {r.consumptions?.length > 0 ? (
                    // Todos los rollos madre con los kg que salieron de cada
                    // uno (un rollo chico de Sellado/Precorte puede venir de
                    // dos madres si el primero se agotó a mitad).
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Salió de:{" "}
                      {r.consumptions.map((c: any) => `${rollCode(c.sourceRoll)} (${Number(c.quantityKg)} kg)`).join(" + ")} — escaneado por{" "}
                      {r.createdBy?.name ?? r.operatorName}
                    </p>
                  ) : (
                    r.sourceRoll && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Insumo: rollo {rollCode(r.sourceRoll)} ({Number(r.sourceRoll.weightKg)} kg)
                        {r.sourceRoll.createdBy?.name && <> · producido por {r.sourceRoll.createdBy.name}</>} — escaneado por {r.createdBy?.name ?? r.operatorName}
                      </p>
                    )
                  )}
                  {r.transfers?.map((t: any) => (
                    <p key={t.id} className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Despachado {STATION_LABELS[t.fromStation]} → {STATION_LABELS[t.toStation]}
                      {t.dispatchedKg != null && ` con ${Number(t.dispatchedKg)} kg`} · lo llevó {t.carrierName} · {new Date(t.createdAt).toLocaleString()}
                      {t.status === "recibido"
                        ? ` · recibió ${t.receivedBy?.name ?? "—"}${t.receivedKg != null ? ` (${Number(t.receivedKg)} kg)` : ""}`
                        : " · en camino"}
                    </p>
                  ))}
                </li>
              ))}
              {(!order.rolls || order.rolls.length === 0) && (
                <li className="px-5 py-4 text-slate-500 dark:text-slate-400">Todavía no tiene rollos registrados.</li>
              )}
            </ul>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100 dark:border-slate-700">
              <CircleCheck size={16} strokeWidth={2} className="text-slate-500 dark:text-slate-400" aria-hidden="true" />
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Control de calidad</p>
            </div>
            <div className="p-5 text-sm">
              {order.qualityCheck ? (
                <div className="flex items-start gap-2">
                  {order.qualityCheck.result === "aprobado" ? (
                    <CircleCheck size={18} strokeWidth={2} className="text-emerald-600 dark:text-emerald-400 mt-0.5" aria-hidden="true" />
                  ) : (
                    <CircleX size={18} strokeWidth={2} className="text-red-600 dark:text-red-400 mt-0.5" aria-hidden="true" />
                  )}
                  <div>
                    <p className="font-medium text-slate-800 dark:text-slate-100">
                      {order.qualityCheck.result === "aprobado" ? "Aprobado" : "Rechazado"}
                    </p>
                    {order.qualityCheck.observations && (
                      <p className="text-slate-600 dark:text-slate-300 mt-0.5">{order.qualityCheck.observations}</p>
                    )}
                    <p className="text-slate-500 dark:text-slate-400 mt-1">
                      {order.qualityCheck.createdBy?.name ?? "—"} ·{" "}
                      {new Date(order.qualityCheck.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                  <CircleDashed size={18} strokeWidth={2} aria-hidden="true" />
                  {order.status === "pendiente_calidad" ? "Pendiente de revisión" : "Todavía no llega a control de calidad"}
                </div>
              )}
            </div>
          </div>
        </>
            );
          }}
        </AsyncState>
      )}

      {scanning && (
        <BarcodeScanner
          title="Escanear rollo o etiqueta de bulto"
          onDetected={(text) => {
            setScanning(false);
            traceCode(text);
          }}
          onClose={() => setScanning(false)}
        />
      )}
    </div>
  );
}
