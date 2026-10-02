import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, Clock, Scale, ScanLine, Send, Warehouse } from "lucide-react";
import { api, type WarehouseInventory, type WarehouseRoll } from "../api/client";
import { useAuth, type UserRole } from "../auth/AuthContext";
import AsyncState from "../components/AsyncState";
import BarcodeScanner from "../components/BarcodeScanner";
import { SkeletonRows } from "../components/Skeleton";
import { PRODUCCION_GESTION } from "../components/navConfig";
import { splitScannedCode } from "../lib/rollQr";
import { STATION_LABELS, type OpStation } from "../opTemplates";

/** Bodega de cada rol de operario (espejo de OPERARIO_STATIONS del server):
 * un operario abre directo en la suya — en el celular, ver todas las bodegas
 * juntas es una lista larguísima que no le sirve. */
const OPERARIO_STATION: Partial<Record<UserRole, OpStation>> = {
  operario_extrusion: "extrusion",
  operario_impresion: "impresion",
  operario_sellado: "sellado",
  operario_precorte: "precorte",
};

function stationLabel(station: string): string {
  return STATION_LABELS[station as OpStation] ?? station;
}

function antiguedad(days: number): string {
  if (days === 0) return "hoy";
  return days === 1 ? "hace 1 día" : `hace ${days} días`;
}

function horas(hours: number): string {
  if (hours < 1) return "hace menos de 1 hora";
  if (hours < 48) return `hace ${hours} h`;
  return `hace ${Math.floor(hours / 24)} días`;
}

/** Ajuste por conteo físico de un rollo (solo Gestión): el saldo pasa a ser
 * lo que se pesó, con el motivo obligatorio — queda en Trazabilidad y en
 * Auditoría. */
function CountForm({ roll, onDone }: { roll: WarehouseRoll; onDone: (msg: string) => void }) {
  const queryClient = useQueryClient();
  const [counted, setCounted] = useState(String(roll.remainingKg));
  // El motivo de casi todos los conteos; editable si fue otra cosa.
  const [notes, setNotes] = useState("Pesaje de inventario");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const countedKg = Number(counted);
    if (counted.trim() === "" || !(countedKg >= 0)) {
      setError("El peso contado tiene que ser 0 o más");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await api.countRoll(roll.rollId, { countedKg, notes: notes.trim() });
      queryClient.invalidateQueries({ queryKey: ["warehouseInventory"] });
      onDone(
        `${res.code}: saldo ${res.previousKg} → ${res.newKg} kg` +
          (res.deltaKg !== 0 ? ` (${res.deltaKg > 0 ? "+" : ""}${res.deltaKg} kg)` : " (sin diferencia)")
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar el conteo");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-2 flex flex-wrap items-start gap-2 text-sm">
      <input
        className="w-28 border rounded px-2 py-1.5 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        type="number"
        step="0.01"
        min="0"
        inputMode="decimal"
        aria-label={`Peso contado de ${roll.code}`}
        value={counted}
        // Se abre para pesar: el foco ya en el peso, todo seleccionado
        // para tipear encima sin borrar el saldo precargado.
        autoFocus
        onFocus={(e) => e.target.select()}
        onChange={(e) => setCounted(e.target.value)}
      />
      <input
        className="flex-1 min-w-48 border rounded px-2 py-1.5 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        placeholder="Motivo (ej. pesaje de inventario)"
        aria-label={`Motivo del ajuste de ${roll.code}`}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={500}
        required
        minLength={3}
      />
      <button type="submit" disabled={saving} className="bg-slate-800 text-white px-3 py-1.5 rounded disabled:opacity-50">
        {saving ? "Guardando..." : "Guardar conteo"}
      </button>
      {error && <p className="w-full text-red-600 dark:text-red-400">{error}</p>}
    </form>
  );
}

function RollRow({
  roll,
  canCount,
  staleDays,
  located,
}: {
  roll: WarehouseRoll;
  canCount: boolean;
  staleDays: number;
  /** El rollo que se acaba de escanear, si es este (objeto nuevo en cada escaneo). */
  located: object | null;
}) {
  const [counting, setCounting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const ref = useRef<HTMLLIElement>(null);
  const consumed = Math.round((roll.weightKg - roll.remainingKg) * 100) / 100;

  // Lo acaban de escanear: se trae a la vista y, si es Gestión, ya queda
  // abierto el conteo (es para lo que se escanea un rollo en el inventario).
  useEffect(() => {
    if (!located) return;
    ref.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    if (canCount) setCounting(true);
  }, [located, canCount]);

  return (
    <li
      ref={ref}
      className={`px-4 py-3 ${located ? "ring-2 ring-inset ring-sky-500" : ""} ${roll.stale ? "bg-amber-50 dark:bg-amber-950/30" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-slate-800 dark:text-slate-100">
            {roll.code}
            {roll.label && roll.label !== roll.code && <span className="ml-1 text-xs font-normal text-slate-500">({roll.label})</span>}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            <Link to={`/produccion/ordenes/${roll.productionOrder.id}`} className="hover:underline">
              {roll.productionOrder.orderNumber}
            </Link>{" "}
            · {roll.productionOrder.product.name}
          </p>
        </div>
        <div className="text-right">
          <p className="font-semibold text-slate-800 dark:text-slate-100">{roll.remainingKg} kg</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {consumed > 0 ? `de ${roll.weightKg} kg` : "rollo completo"}
          </p>
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className={`inline-flex items-center gap-1 ${roll.stale ? "text-amber-700 dark:text-amber-400 font-medium" : "text-slate-500 dark:text-slate-400"}`}>
          {roll.stale ? <AlertTriangle size={12} aria-hidden="true" /> : <Clock size={12} aria-hidden="true" />}
          Está acá {antiguedad(roll.days)}
          {roll.stale && ` (más de ${staleDays} días sin usarse)`}
        </span>
        {roll.pendingTo.length > 0 && (
          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium">
            <Send size={12} aria-hidden="true" />
            Pendiente de despachar a {roll.pendingTo.map(stationLabel).join(" / ")}
          </span>
        )}
        {roll.lastCount && (
          <span className="text-slate-500 dark:text-slate-400">
            Último conteo: {Number(roll.lastCount.newKg)} kg · {roll.lastCount.createdBy.name} ·{" "}
            {new Date(roll.lastCount.createdAt).toLocaleDateString()}
          </span>
        )}
        {canCount && !counting && (
          <button type="button" onClick={() => setCounting(true)} className="inline-flex items-center gap-1 text-sky-700 dark:text-sky-400 hover:underline">
            <Scale size={12} aria-hidden="true" /> Ajustar por conteo
          </button>
        )}
      </div>
      {message && <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">{message}</p>}
      {counting && (
        <CountForm
          roll={roll}
          onDone={(msg) => {
            setMessage(msg);
            setCounting(false);
          }}
        />
      )}
    </li>
  );
}

export default function InventarioBodegas() {
  const { user } = useAuth();
  const canCount = !!user && (PRODUCCION_GESTION as UserRole[]).includes(user.role);
  const [filter, setFilter] = useState<string>((user && OPERARIO_STATION[user.role]) || "");
  const query = useQuery({ queryKey: ["warehouseInventory"], queryFn: api.getWarehouseInventory });
  const [scanning, setScanning] = useState(false);
  const [located, setLocated] = useState<{ code: string } | null>(null);
  const [scanMessage, setScanMessage] = useState<{ ok: boolean; text: string } | null>(null);

  /** Escanear un rollo lo ubica: filtra a su bodega y lo resalta. Solo usa
   * el código (no el token) — es para encontrarlo, no mueve nada. */
  function handleScan(raw: string) {
    setScanning(false);
    const code = splitScannedCode(raw.trim()).code.toUpperCase();
    const data = query.data;
    if (!data) return;
    const transit = data.inTransit.find((t) => t.code === code);
    if (transit) {
      setFilter(transit.toStation);
      setLocated({ code });
      setScanMessage({
        ok: true,
        text: `${code} está en camino a ${stationLabel(transit.toStation)} (lo lleva ${transit.carrierName}) — todavía no lo recibieron`,
      });
      return;
    }
    const warehouse = data.warehouses.find((w) => w.items.some((r) => r.code === code));
    if (warehouse) {
      setFilter(warehouse.station);
      setLocated({ code });
      setScanMessage({ ok: true, text: `${code} está en la bodega de ${warehouse.label}` });
      return;
    }
    setLocated(null);
    setScanMessage({
      ok: false,
      text: `${code} no está en ninguna bodega con saldo — ya se consumió entero, o no es un rollo de Extrusión/Impresión`,
    });
  }

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Inventario de bodegas</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Rollos con saldo en cada bodega de planta y los que están en camino. Tocá una bodega para ver solo esa (tocala de nuevo para ver
          todas). Lo que sale de Sellado y Precorte es producto terminado y se ve en Inventario.
        </p>
      </div>

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setScanning(true)}
          disabled={!query.data}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-slate-800 text-white px-5 py-2.5 rounded-lg shadow disabled:opacity-50"
        >
          <ScanLine size={18} aria-hidden="true" /> {canCount ? "Escanear rollo para ubicarlo o contarlo" : "Escanear rollo para ubicarlo"}
        </button>
        {scanMessage && (
          <p
            role="status"
            className={`text-sm rounded px-3 py-2 ${
              scanMessage.ok
                ? "text-sky-800 dark:text-sky-300 bg-sky-50 dark:bg-sky-950"
                : "text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950"
            }`}
          >
            {scanMessage.text}
          </p>
        )}
      </div>

      <AsyncState query={query} skeleton={<SkeletonRows />} errorMessage="No se pudo cargar el inventario de bodegas.">
        {(data: WarehouseInventory) => {
          const visibles = data.warehouses.filter((w) => !filter || w.station === filter);
          return (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {data.warehouses.map((w) => (
                  <button
                    key={w.station}
                    type="button"
                    onClick={() => setFilter(filter === w.station ? "" : w.station)}
                    aria-pressed={filter === w.station}
                    className={`text-left rounded-xl border p-4 ${
                      filter === w.station
                        ? "border-slate-800 dark:border-slate-200 ring-1 ring-slate-800 dark:ring-slate-200"
                        : "border-slate-200 dark:border-slate-700"
                    } bg-white dark:bg-slate-900`}
                  >
                    <p className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">
                      <Warehouse size={14} aria-hidden="true" /> {w.label}
                    </p>
                    <p className="mt-1 text-2xl font-semibold text-slate-800 dark:text-slate-100">{w.totalKg} kg</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {w.rollCount} {w.rollCount === 1 ? "rollo" : "rollos"}
                      {w.inTransitCount > 0 && ` · ${w.inTransitCount} en camino (${w.inTransitKg} kg)`}
                    </p>
                    {w.staleTransitCount > 0 && (
                      <p className="mt-1 text-xs font-medium text-red-700 dark:text-red-400">
                        {w.staleTransitCount} sin recibir hace más de {data.staleTransitHours} h
                      </p>
                    )}
                    {w.staleCount > 0 && (
                      <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                        {w.staleCount} parado{w.staleCount === 1 ? "" : "s"} más de {data.staleDays} días
                      </p>
                    )}
                  </button>
                ))}
              </div>

              {data.inTransit.filter((t) => !filter || t.toStation === filter).length > 0 && (
                <section className="bg-white dark:bg-slate-900 rounded-xl border border-amber-200 dark:border-amber-800 overflow-hidden">
                  <p className="px-4 py-3 border-b border-amber-100 dark:border-amber-900 text-sm font-medium text-amber-800 dark:text-amber-300">
                    En camino
                  </p>
                  <ul className="divide-y divide-slate-100 dark:divide-slate-700 text-sm">
                    {data.inTransit
                      .filter((t) => !filter || t.toStation === filter)
                      .map((t) => (
                        <li
                          key={t.transferId}
                          className={`px-4 py-3 flex flex-wrap items-center justify-between gap-2 ${
                            located?.code === t.code ? "ring-2 ring-inset ring-sky-500" : ""
                          } ${t.stale ? "bg-red-50 dark:bg-red-950/30" : ""}`}
                        >
                          <span className="text-slate-800 dark:text-slate-100">
                            <strong>{t.code}</strong> · {stationLabel(t.fromStation)} <ArrowRight size={12} className="inline" aria-hidden="true" />{" "}
                            {stationLabel(t.toStation)} · lo lleva {t.carrierName}
                          </span>
                          <span
                            className={`text-xs inline-flex items-center gap-1 ${
                              t.stale ? "text-red-700 dark:text-red-400 font-medium" : "text-slate-500 dark:text-slate-400"
                            }`}
                          >
                            {t.stale && <AlertTriangle size={12} aria-hidden="true" />}
                            {t.remainingKg} kg · salió {horas(t.hours)}
                            {t.stale && " — nadie confirmó que llegó"}
                          </span>
                        </li>
                      ))}
                  </ul>
                </section>
              )}

              {visibles.map((w) => (
                <section key={w.station} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Bodega de {w.label}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {w.rollCount} {w.rollCount === 1 ? "rollo" : "rollos"} · {w.totalKg} kg
                    </p>
                  </div>
                  {w.items.length > 0 ? (
                    <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                      {w.items.map((r) => (
                        <RollRow
                          key={r.rollId}
                          roll={r}
                          canCount={canCount}
                          staleDays={data.staleDays}
                          located={located?.code === r.code ? located : null}
                        />
                      ))}
                    </ul>
                  ) : (
                    <p className="px-4 py-4 text-sm text-slate-500 dark:text-slate-400">No hay rollos con saldo en esta bodega.</p>
                  )}
                </section>
              ))}
            </>
          );
        }}
      </AsyncState>

      {scanning && <BarcodeScanner title="Escanear rollo" onDetected={handleScan} onClose={() => setScanning(false)} />}
    </div>
  );
}
