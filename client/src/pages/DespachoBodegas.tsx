import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { ArrowRight, PackageCheck, ScanLine, Trash2, Truck } from "lucide-react";
import { api, RollTransfer, RollTransferScan } from "../api/client";
import { useAuth, type UserRole } from "../auth/AuthContext";
import AsyncState from "../components/AsyncState";
import BarcodeScanner from "../components/BarcodeScanner";
import { SkeletonRows } from "../components/Skeleton";
import { PRODUCCION_GESTION } from "../components/navConfig";
import { splitScannedCode } from "../lib/rollQr";
import { STATION_LABELS, OpStation } from "../opTemplates";

/** Estación que le toca a cada rol de operario — espejo de
 * OPERARIO_STATIONS en server/src/middleware/auth.ts: un operario solo
 * recibe rollos en la bodega de SU estación. */
const OPERARIO_STATION: Partial<Record<UserRole, OpStation>> = {
  operario_extrusion: "extrusion",
  operario_impresion: "impresion",
  operario_sellado: "sellado",
  operario_precorte: "precorte",
};

/** Zona horaria del celular: el servidor pone la hora (no se confía en el
 * reloj del teléfono), esto es para mostrarla como la vio el operario. */
function clientClock() {
  return {
    clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    clientUtcOffsetMinutes: -new Date().getTimezoneOffset(),
  };
}

function formatOffset(minutes: number | null): string {
  if (minutes === null) return "";
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

/** Fecha y hora en la zona horaria del celular que registró ese paso. */
function formatInZone(iso: string, timeZone: string | null, offset: number | null): string {
  let text: string;
  try {
    text = new Date(iso).toLocaleString("es-CO", { timeZone: timeZone ?? undefined, dateStyle: "short", timeStyle: "short" });
  } catch {
    text = new Date(iso).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" });
  }
  return offset === null ? text : `${text} (${formatOffset(offset)})`;
}

function stationLabel(station: string): string {
  return STATION_LABELS[station as OpStation] ?? station;
}

const STATUS_LABELS: Record<RollTransfer["status"], string> = { en_transito: "En tránsito", recibido: "Recibido" };
const STATUS_COLORS: Record<RollTransfer["status"], string> = {
  en_transito: "bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400",
  recibido: "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400",
};

const inputClass = "border rounded px-3 py-2 text-sm w-full dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";

export default function DespachoBodegas() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canGestion = !!user && (PRODUCCION_GESTION as UserRole[]).includes(user.role);
  const ownStation = user ? OPERARIO_STATION[user.role] : undefined;

  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState<{ code: string; token: string; info: RollTransferScan } | null>(null);
  const [toStation, setToStation] = useState<OpStation | "">("");
  const [mode, setMode] = useState<"entrega" | "retiro">("entrega");
  const [carrierName, setCarrierName] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState("");
  const [toStationFilter, setToStationFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");

  const transfersQuery = useQuery({
    queryKey: ["rollTransfers", statusFilter, toStationFilter, dateFilter],
    queryFn: () =>
      api.getRollTransfers({
        status: statusFilter || undefined,
        toStation: toStationFilter || undefined,
        from: dateFilter || undefined,
        to: dateFilter || undefined,
      }),
  });

  function resetForm() {
    setScanned(null);
    setToStation("");
    setMode("entrega");
    setCarrierName("");
    setNotes("");
  }

  async function handleScan(raw: string) {
    setScanning(false);
    setError(null);
    setSuccess(null);
    resetForm();
    const { code, token } = splitScannedCode(raw.trim());
    if (!token) {
      setError(`El código ${code} no trae el token de posesión — escaneá el QR impreso en la etiqueta del rollo`);
      return;
    }
    try {
      const info = await api.scanRollForTransfer(code, token);
      setScanned({ code, token, info });
      if (info.destinations.length === 1) setToStation(info.destinations[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer el rollo");
    }
  }

  async function handleDispatch(e: FormEvent) {
    e.preventDefault();
    if (!scanned || !toStation) return;
    setError(null);
    setSubmitting(true);
    try {
      const transfer = await api.createRollTransfer({
        code: scanned.code,
        token: scanned.token,
        toStation,
        mode,
        carrierName: mode === "entrega" ? carrierName.trim() : undefined,
        notes: notes.trim() || undefined,
        ...clientClock(),
      });
      setSuccess(`Rollo ${transfer.rollCode} despachado a ${stationLabel(transfer.toStation)} — lo lleva ${transfer.carrierName}`);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["rollTransfers"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar el despacho");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReceive() {
    const open = scanned?.info.openTransfer;
    if (!scanned || !open) return;
    setError(null);
    setSubmitting(true);
    try {
      const transfer = await api.receiveRollTransfer(open.id, {
        code: scanned.code,
        token: scanned.token,
        notes: notes.trim() || undefined,
        ...clientClock(),
      });
      setSuccess(`Rollo ${transfer.rollCode} recibido en la bodega de ${stationLabel(transfer.toStation)}`);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["rollTransfers"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar la recepción");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: number) {
    setError(null);
    try {
      await api.deleteRollTransfer(id);
      queryClient.invalidateQueries({ queryKey: ["rollTransfers"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo anular el despacho");
    }
  }

  const info = scanned?.info;
  const open = info?.openTransfer ?? null;
  const canReceiveOpen = !!open && (!ownStation || ownStation === open.toStation);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Despacho a bodegas</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Escaneá el QR del rollo. Si sale de tu estación, elegí a qué bodega va y quién se lo lleva. Si te llegó a tu bodega, confirmá la
          recepción. Cada paso queda registrado con tu cuenta, la fecha, la hora y la zona horaria de tu celular.
        </p>
      </div>

      <button
        type="button"
        onClick={() => setScanning(true)}
        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-slate-800 text-white text-base px-6 py-3 rounded-lg shadow"
      >
        <ScanLine size={20} aria-hidden="true" /> Escanear rollo
      </button>

      {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}
      {success && (
        <p className="text-emerald-700 dark:text-emerald-400 text-sm bg-emerald-50 dark:bg-emerald-950 rounded px-3 py-2">{success}</p>
      )}

      {info && (
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-lg font-semibold text-slate-800 dark:text-slate-100">{info.roll.code}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {info.roll.productionOrder.product.name} · OP {info.roll.productionOrder.orderNumber}
              </p>
            </div>
            <div className="text-right text-sm">
              <p className="text-slate-800 dark:text-slate-100">{Number(info.roll.weightKg)} kg</p>
              <p className="text-slate-500 dark:text-slate-400">Saldo: {info.roll.remainingKg} kg</p>
            </div>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Salió de {stationLabel(info.roll.station)} · operario {info.roll.operatorName}
          </p>

          {open ? (
            <div className="space-y-3">
              <div className="rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 p-3 text-sm text-amber-800 dark:text-amber-300">
                En tránsito hacia <strong>{stationLabel(open.toStation)}</strong> — lo lleva <strong>{open.carrierName}</strong>, salió el{" "}
                {formatInZone(open.createdAt, open.clientTimezone, open.clientUtcOffsetMinutes)}.
              </div>
              {canReceiveOpen ? (
                <>
                  <input className={inputClass} placeholder="Observaciones (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
                  <button
                    type="button"
                    onClick={handleReceive}
                    disabled={submitting}
                    className="w-full inline-flex items-center justify-center gap-2 bg-emerald-600 text-white px-4 py-3 rounded-lg disabled:opacity-50"
                  >
                    <PackageCheck size={18} aria-hidden="true" />
                    {submitting ? "Registrando..." : `Confirmar recepción en ${stationLabel(open.toStation)}`}
                  </button>
                </>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">Lo tiene que recibir un operario de {stationLabel(open.toStation)}.</p>
              )}
            </div>
          ) : info.destinations.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Los rollos de {stationLabel(info.roll.station)} no se despachan a otra bodega.</p>
          ) : (
            <form onSubmit={handleDispatch} className="space-y-4">
              {info.lastTransfer && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Último despacho: a {stationLabel(info.lastTransfer.toStation)}, recibido por {info.lastTransfer.receivedBy?.name ?? "—"}.
                </p>
              )}
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">¿A qué bodega va?</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {info.destinations.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setToStation(s)}
                      aria-pressed={toStation === s}
                      className={`px-4 py-3 rounded-lg border text-sm font-medium ${
                        toStation === s
                          ? "bg-slate-800 text-white border-slate-800"
                          : "border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200"
                      }`}
                    >
                      {stationLabel(s)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">¿Quién se lo lleva?</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="flex items-center gap-2 border rounded-lg px-3 py-2 text-sm dark:border-slate-600 dark:text-slate-200">
                    <input type="radio" name="mode" checked={mode === "entrega"} onChange={() => setMode("entrega")} />
                    Se lo entrego a alguien
                  </label>
                  <label className="flex items-center gap-2 border rounded-lg px-3 py-2 text-sm dark:border-slate-600 dark:text-slate-200">
                    <input type="radio" name="mode" checked={mode === "retiro"} onChange={() => setMode("retiro")} />
                    Me lo llevo yo
                  </label>
                </div>
                {mode === "entrega" ? (
                  <input
                    className={`${inputClass} mt-2`}
                    placeholder="Nombre de quien se lo lleva"
                    value={carrierName}
                    onChange={(e) => setCarrierName(e.target.value)}
                    maxLength={100}
                    required
                    minLength={2}
                  />
                ) : (
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                    Queda a nombre de tu cuenta: <strong className="text-slate-700 dark:text-slate-200">{user?.name}</strong>
                  </p>
                )}
              </div>

              <input className={inputClass} placeholder="Observaciones (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />

              <button
                type="submit"
                disabled={submitting || !toStation}
                className="w-full inline-flex items-center justify-center gap-2 bg-slate-800 text-white px-4 py-3 rounded-lg disabled:opacity-50"
              >
                <Truck size={18} aria-hidden="true" />
                {submitting ? "Registrando..." : toStation ? `Registrar salida a ${stationLabel(toStation)}` : "Elegí la bodega"}
              </button>
            </form>
          )}
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 flex flex-wrap gap-2">
        <select className="border rounded px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="en_transito">En tránsito</option>
          <option value="recibido">Recibidos</option>
        </select>
        <select className="border rounded px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" value={toStationFilter} onChange={(e) => setToStationFilter(e.target.value)}>
          <option value="">Todas las bodegas</option>
          <option value="impresion">Impresión</option>
          <option value="sellado">Sellado</option>
          <option value="precorte">Precorte</option>
        </select>
        <input
          type="date"
          aria-label="Fecha de salida"
          className="border rounded px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
        />
      </div>

      <AsyncState
        query={transfersQuery}
        skeleton={<SkeletonRows rows={5} cols={6} />}
        isEmpty={(rows) => rows.length === 0}
        emptyMessage="No hay despachos registrados con estos filtros."
        errorMessage="No se pudieron cargar los despachos."
      >
        {(transfers) => (
          <>
            <div className="hidden md:block bg-white dark:bg-slate-900 rounded-lg shadow overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 dark:bg-slate-800 text-left">
                  <tr>
                    <th className="p-3">Rollo</th>
                    <th className="p-3">Ruta</th>
                    <th className="p-3">Lo lleva</th>
                    <th className="p-3">Salida</th>
                    <th className="p-3">Estado</th>
                    <th className="p-3">Recepción</th>
                    {canGestion && <th className="p-3" />}
                  </tr>
                </thead>
                <tbody>
                  {transfers.map((t) => (
                    <tr key={t.id} className="border-t align-top">
                      <td className="p-3">
                        <p className="font-medium">{t.rollCode}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          OP {t.roll.productionOrder.orderNumber} · {Number(t.roll.weightKg)} kg
                        </p>
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        {stationLabel(t.fromStation)} <ArrowRight size={12} className="inline" aria-hidden="true" /> {stationLabel(t.toStation)}
                      </td>
                      <td className="p-3">
                        <p>{t.carrierName}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {t.mode === "retiro" ? "Lo escaneó con su cuenta" : `Entregado por ${t.registeredBy.name}`}
                        </p>
                      </td>
                      <td className="p-3">
                        <p>{formatInZone(t.createdAt, t.clientTimezone, t.clientUtcOffsetMinutes)}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{t.clientTimezone}</p>
                      </td>
                      <td className="p-3">
                        <span className={`text-xs rounded-full px-2 py-1 ${STATUS_COLORS[t.status]}`}>{STATUS_LABELS[t.status]}</span>
                      </td>
                      <td className="p-3">
                        {t.receivedAt ? (
                          <>
                            <p>{t.receivedBy?.name ?? "—"}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {formatInZone(t.receivedAt, t.receivedTimezone, t.receivedUtcOffsetMinutes)}
                            </p>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      {canGestion && (
                        <td className="p-3">
                          <DeleteTransferButton onConfirm={() => handleDelete(t.id)} />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="md:hidden bg-white dark:bg-slate-900 rounded-lg shadow divide-y divide-slate-100 dark:divide-slate-700">
              {transfers.map((t) => (
                <div key={t.id} className="p-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-slate-800 dark:text-slate-100">
                      {t.rollCode} · {stationLabel(t.fromStation)} → {stationLabel(t.toStation)}
                    </p>
                    <span className={`text-xs rounded-full px-2 py-1 shrink-0 ${STATUS_COLORS[t.status]}`}>{STATUS_LABELS[t.status]}</span>
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Lo lleva {t.carrierName}
                    {t.mode === "entrega" ? ` (entregado por ${t.registeredBy.name})` : ""} ·{" "}
                    {formatInZone(t.createdAt, t.clientTimezone, t.clientUtcOffsetMinutes)}
                  </p>
                  {t.receivedAt && (
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      Recibió {t.receivedBy?.name ?? "—"} · {formatInZone(t.receivedAt, t.receivedTimezone, t.receivedUtcOffsetMinutes)}
                    </p>
                  )}
                  {canGestion && <DeleteTransferButton onConfirm={() => handleDelete(t.id)} />}
                </div>
              ))}
            </div>
          </>
        )}
      </AsyncState>

      {scanning && <BarcodeScanner title="Escanear rollo" onDetected={handleScan} onClose={() => setScanning(false)} />}
    </div>
  );
}

/** Anular pide un segundo toque (confirmación en línea) en vez de borrar al primero. */
function DeleteTransferButton({ onConfirm }: { onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <span className="inline-flex gap-2 text-xs">
        <button type="button" className="text-red-600 dark:text-red-400 font-medium" onClick={onConfirm}>
          Sí, anular
        </button>
        <button type="button" className="text-slate-500" onClick={() => setConfirming(false)}>
          Cancelar
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-red-600"
      aria-label="Anular despacho"
    >
      <Trash2 size={13} aria-hidden="true" /> Anular
    </button>
  );
}
