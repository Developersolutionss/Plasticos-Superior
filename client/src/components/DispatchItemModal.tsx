import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CheckCircle2, Circle, ScanLine } from "lucide-react";
import { api } from "../api/client";
import BarcodeScanner from "./BarcodeScanner";
import Modal from "./Modal";
import { splitScannedCode } from "../lib/rollQr";

interface Props {
  dispatch: any;
  item: any;
  /** Estantes del producto con stock (para elegir de cuál sale). */
  locations: { locationId: number; code: string; quantity: number }[];
  onClose: () => void;
  onDone: (message: string) => void;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Despachar un ítem a un cliente (rediseño de Despachos, reunión
 * 2026-10-06): se ven los rollos que pueden salir, se escanea cada uno, la
 * cantidad se llena sola con la suma de los escaneados y se puede despachar
 * menos de lo pedido (lo que falta queda pendiente). En la reserva de un
 * cliente escanear es obligatorio; en un despacho a mano, opcional.
 */
export default function DispatchItemModal({ dispatch, item, locations, onClose, onDone }: Props) {
  const queryClient = useQueryClient();
  const reservedDispatch = !!dispatch.productionOrder;
  const kg = item.product.unit === "kg";
  const requested = Number(item.quantityRequested);

  const { data, isLoading } = useQuery({
    queryKey: ["dispatchItemRolls", dispatch.id, item.id],
    queryFn: () => api.getDispatchItemRolls(dispatch.id, item.id),
  });
  const rolls = data?.rolls ?? [];

  /** Rollos ya escaneados: id → token del QR. */
  const [scanned, setScanned] = useState<Record<number, string>>({});
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [manualQty, setManualQty] = useState<string | null>(null);
  const [locationId, setLocationId] = useState(locations.length && !reservedDispatch ? String(locations[0].locationId) : "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scannedRolls = rolls.filter((r) => scanned[r.id] !== undefined);
  const scannedKg = round2(scannedRolls.reduce((acc, r) => acc + r.weightKg, 0));
  // Con rollos escaneados en un producto por kilo, la cantidad ES la suma de
  // sus kilos; si no, se precarga lo pedido y se puede cambiar.
  const autoQty = kg && scannedRolls.length > 0 ? scannedKg : null;
  const quantity = autoQty ?? (manualQty !== null ? Number(manualQty) : requested);
  const needsRolls = reservedDispatch && rolls.length > 0;

  function handleScan(raw: string) {
    setScanning(false);
    const { code, token } = splitScannedCode(raw.trim());
    const roll = rolls.find((r) => r.code === code);
    if (!roll) {
      setScanMessage(
        reservedDispatch
          ? `El rollo ${code} no es de ${dispatch.productionOrder.orderNumber}: este despacho solo lleva los rollos de esa OP`
          : `El rollo ${code} no está entre los que se pueden despachar a este cliente (puede ser de otro cliente o no estar aprobado en Calidad)`
      );
      return;
    }
    if (!token) {
      setScanMessage(`El código ${code} no trae el token — escaneá el QR de la etiqueta, o tipeá el código completo (${code}-TOKEN)`);
      return;
    }
    setScanMessage(null);
    setScanned((prev) => ({ ...prev, [roll.id]: token }));
    setManualQty(null);
  }

  async function confirm() {
    setError(null);
    if (!(quantity > 0)) return setError("La cantidad tiene que ser mayor a 0");
    if (quantity > requested + 0.005) return setError(`No se puede despachar más de lo pedido (${requested})`);
    if (needsRolls && scannedRolls.length === 0) return setError("Escaneá al menos un rollo: este despacho sale con los rollos fabricados para el cliente");
    setSending(true);
    try {
      const res = await api.markItemDispatched(dispatch.id, item.id, quantity, locationId ? Number(locationId) : undefined, scannedRolls.map((r) => ({ code: r.code, token: scanned[r.id] })));
      for (const key of ["dispatches", "inventory", "alerts", "warehouseStock", "clientReservations"]) queryClient.invalidateQueries({ queryKey: [key] });
      onDone(
        `${item.product.name}: se despacharon ${quantity} ${item.product.unit}` +
          (scannedRolls.length ? ` (${scannedRolls.map((r) => r.code).join(", ")})` : "") +
          (res?.partial ? `. Quedan ${res.partial.remaining} ${item.product.unit} pendientes en este despacho` : "")
      );
    } catch (err: any) {
      setError(err?.message || "No se pudo marcar el ítem como despachado");
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal title={`Despachar a ${dispatch.client.name}`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className="text-slate-700 dark:text-slate-200">
          {item.product.name} — pedido: <strong>{requested} {item.product.unit}</strong>
          {reservedDispatch && <span className="text-slate-500 dark:text-slate-400"> · fabricado en {dispatch.productionOrder.orderNumber}</span>}
        </p>

        {isLoading ? (
          <p className="text-slate-500">Cargando rollos...</p>
        ) : rolls.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {needsRolls ? "Escaneá cada rollo que sale" : "Rollos que se pueden despachar (opcional escanearlos)"}
            </p>
            <ul className="space-y-1" aria-label="Rollos disponibles">
              {rolls.map((r) => {
                const ok = scanned[r.id] !== undefined;
                return (
                  <li
                    key={r.id}
                    className={`flex items-center justify-between gap-2 rounded border px-2.5 py-1.5 ${
                      ok ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/30" : "border-slate-200 dark:border-slate-700"
                    }`}
                  >
                    <span className="inline-flex items-center gap-2">
                      {ok ? <CheckCircle2 size={15} className="text-emerald-600" aria-label="Escaneado" /> : <Circle size={15} className="text-slate-400" aria-label="Sin escanear" />}
                      <strong>{r.code}</strong>
                      <span className="text-slate-500 dark:text-slate-400">
                        {r.weightKg} kg{r.origin === "stock" ? " · stock" : ""}
                      </span>
                      {/* El despacho al cliente sale de la bodega principal: si el
                          rollo todavía está en otra bodega o en camino, se avisa
                          (no se bloquea). */}
                      <span className={`text-xs ${r.inMainWarehouse ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400 font-medium"}`}>
                        {r.inMainWarehouse ? "· en la bodega principal" : `· está en: ${r.location} (todavía no volvió a la principal)`}
                      </span>
                    </span>
                    {ok && (
                      <button type="button" className="text-xs text-slate-500 hover:text-red-600" onClick={() => setScanned(({ [r.id]: _x, ...rest }) => rest)}>
                        Quitar
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              onClick={() => setScanning(true)}
              className="inline-flex items-center gap-2 bg-slate-800 text-white px-3 py-2 rounded-lg"
            >
              <ScanLine size={16} aria-hidden="true" /> Escanear rollo
            </button>
            {scanMessage && <p className="text-red-600 dark:text-red-400">{scanMessage}</p>}
          </div>
        ) : (
          <p className="text-slate-500 dark:text-slate-400">No hay rollos registrados para este despacho: se despacha por cantidad.</p>
        )}

        <label className="block">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Cantidad a despachar ({item.product.unit}){autoQty !== null ? " — suma de los rollos escaneados" : ""}
          </span>
          <input
            className="mt-1 border rounded px-3 py-2 w-full dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 disabled:opacity-70"
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            value={autoQty !== null ? autoQty : manualQty ?? String(requested)}
            disabled={autoQty !== null}
            onChange={(e) => setManualQty(e.target.value)}
          />
        </label>
        {quantity > 0 && quantity < requested - 0.005 && (
          <p className="text-amber-700 dark:text-amber-400">
            Despacho parcial: salen {quantity} y quedan {round2(requested - quantity)} {item.product.unit} pendientes en este despacho
            {reservedDispatch ? " (siguen reservados para el cliente)" : ""}.
          </p>
        )}

        {locations.length > 0 && (
          <label className="block">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Estante de donde sale{reservedDispatch ? " (opcional: lo recién producido entra sin ubicar)" : ""}
            </span>
            <select
              className="mt-1 border rounded px-3 py-2 w-full dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              {reservedDispatch && <option value="">Sin estante (recién producido)</option>}
              {locations.map((l) => (
                <option key={l.locationId} value={l.locationId}>
                  {l.code} ({l.quantity})
                </option>
              ))}
            </select>
          </label>
        )}

        {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded border dark:border-slate-600">
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={sending || (needsRolls && scannedRolls.length === 0)}
            className="bg-emerald-600 text-white px-4 py-2 rounded disabled:opacity-50"
          >
            {sending ? "Enviando..." : "Marcar despachado"}
          </button>
        </div>
      </div>
      {scanning && <BarcodeScanner title="Escanear rollo" onDetected={handleScan} onClose={() => setScanning(false)} />}
    </Modal>
  );
}
