import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, KeyboardEvent, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { PackagePlus, Plus, Printer, Trash2, X } from "lucide-react";
import { api, type OpeningStockResult } from "../api/client";
import { nameWithMeasure } from "../lib/productMeasure";
import { matchesProductSearch } from "../lib/productSearch";
import { printRollLabels } from "../lib/rollLabels";
import { WAREHOUSE_LABELS, warehousePhrase, type RollWarehouse } from "../opTemplates";

interface Row {
  weight: string;
  ticket: string;
}

const emptyRow = (): Row => ({ weight: "", ticket: "" });
const input = "border rounded px-3 py-2 text-sm w-full dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";
const WAREHOUSES = Object.keys(WAREHOUSE_LABELS) as RollWarehouse[];

/**
 * Ingreso de inventario inicial (pedido del cliente 2026-11-20): rollos de
 * Extrusión que ya están en una bodega, cada uno con su tiquete, se cargan
 * sin QR — producto, bodega y una fila por rollo (peso y número de tiquete).
 * Quedan en esa bodega como una OP de Extrusión "Inventario inicial"; desde
 * ahí se derivan a Sellado/Impresión/... como cualquier otra OP. Al guardar
 * se imprimen las etiquetas con QR para pegarlas en los rollos: el operario
 * las escanea para consumirlos.
 */
export default function IngresoInventarioInicial({ defaultWarehouse, onClose }: { defaultWarehouse?: RollWarehouse; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: products } = useQuery({ queryKey: ["products"], queryFn: api.getProducts });
  const { data: clients } = useQuery({ queryKey: ["clients"], queryFn: api.getClients });
  const [search, setSearch] = useState("");
  const [productId, setProductId] = useState("");
  const [clientId, setClientId] = useState("");
  const [warehouse, setWarehouse] = useState<RollWarehouse>(defaultWarehouse ?? "sellado");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<OpeningStockResult | null>(null);
  const weightRefs = useRef<(HTMLInputElement | null)[]>([]);

  const visibleProducts = useMemo(() => {
    const list = (products ?? []).filter((p: any) => matchesProductSearch(p, search));
    // El elegido sigue en la lista aunque el buscador ya no lo muestre.
    const chosen = (products ?? []).find((p: any) => String(p.id) === productId);
    return chosen && !list.includes(chosen) ? [chosen, ...list] : list;
  }, [products, search, productId]);

  const filled = rows.filter((r) => r.weight.trim() !== "" || r.ticket.trim() !== "");
  const totalKg = Math.round(filled.reduce((acc, r) => acc + (Number(r.weight) || 0), 0) * 100) / 100;

  function setRow(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
    // Enfoca el peso de la fila nueva cuando ya está en pantalla.
    setTimeout(() => weightRefs.current[rows.length]?.focus(), 0);
  }

  /** Enter en la última fila agrega otra (cargar 10 tiquetes seguidos sin el mouse). */
  function handleRowKey(e: KeyboardEvent<HTMLInputElement>, i: number) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (i === rows.length - 1) addRow();
    else weightRefs.current[i + 1]?.focus();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!productId) return setError("Elegí el producto");
    if (filled.length === 0) return setError("Agregá al menos un rollo con su peso");
    const bad = filled.findIndex((r) => !(Number(r.weight) > 0));
    if (bad >= 0) return setError(`Falta el peso (kg) del rollo ${rows.indexOf(filled[bad]) + 1}`);
    setError(null);
    setSaving(true);
    try {
      const res = await api.createOpeningStock({
        productId: Number(productId),
        clientId: clientId ? Number(clientId) : undefined,
        warehouse,
        rolls: filled.map((r) => ({ weightKg: Number(r.weight), ticket: r.ticket.trim() || undefined })),
        notes: notes.trim() || undefined,
      });
      setResult(res);
      queryClient.invalidateQueries({ queryKey: ["warehouseInventory"] });
      queryClient.invalidateQueries({ queryKey: ["extrusionRolls"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el ingreso");
    } finally {
      setSaving(false);
    }
  }

  function print() {
    if (!result) return;
    printRollLabels(
      result.rolls.map((r) => ({
        code: r.code,
        orderNumber: result.order.orderNumber,
        productName: result.productName,
        weightKg: r.weightKg,
        qrDataUrl: r.qrDataUrl,
        ticket: r.ticket,
      }))
    );
  }

  function reset() {
    setResult(null);
    setRows([emptyRow()]);
    setNotes("");
  }

  return (
    <section className="bg-white dark:bg-slate-900 rounded-xl border border-sky-200 dark:border-sky-800 p-4 space-y-4" aria-label="Ingresar rollos que ya están en bodega">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <PackagePlus size={18} aria-hidden="true" /> Ingresar rollos que ya están en bodega
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Para los rollos de Extrusión que ya tienen en bodega con su tiquete. No hace falta QR: elegí el producto, la bodega y escribí el
            peso y el tiquete de cada rollo.
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
          <X size={18} />
        </button>
      </div>

      {result ? (
        <div className="space-y-3">
          <p role="status" className="text-sm rounded px-3 py-2 text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950">
            Listo: {result.rolls.length} {result.rolls.length === 1 ? "rollo" : "rollos"} ({result.totalKg} kg) de {result.productName} quedaron en{" "}
            {warehousePhrase(result.warehouse)} como <strong>{result.order.orderNumber}</strong>.
          </p>
          <ul className="text-sm divide-y divide-slate-100 dark:divide-slate-700 border border-slate-200 dark:border-slate-700 rounded">
            {result.rolls.map((r) => (
              <li key={r.id} className="px-3 py-1.5 flex justify-between gap-2">
                <span className="font-medium text-slate-800 dark:text-slate-100">
                  {r.code}
                  {r.ticket && <span className="ml-1 font-normal text-slate-500">· tiquete {r.ticket}</span>}
                </span>
                <span className="text-slate-600 dark:text-slate-300">{r.weightKg} kg</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950 rounded px-3 py-2">
            Imprimí las etiquetas ahora y pegá cada una en el rollo de su tiquete: el operario la escanea para consumir el rollo. Si alguna se
            pierde, se reemite desde la OP. Para usarlos en Sellado (u otra estación), abrí la OP y tocá <strong>Derivar a Sellado</strong>.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={print} className="inline-flex items-center gap-1.5 text-sm bg-emerald-700 hover:bg-emerald-600 text-white rounded px-3 py-2">
              <Printer size={14} aria-hidden="true" /> Imprimir etiquetas ({result.rolls.length})
            </button>
            <Link
              to={`/produccion/ordenes/${result.order.id}`}
              className="inline-flex items-center gap-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Abrir {result.order.orderNumber}
            </Link>
            <button type="button" onClick={reset} className="text-sm text-sky-700 dark:text-sky-400 hover:underline px-2">
              Ingresar otro lote
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-sm sm:col-span-2">
              <span className="text-slate-600 dark:text-slate-300">Producto</span>
              <input
                type="search"
                className={`${input} mt-1`}
                placeholder="Buscar: nombre, medida, calibre, color… (ej. 24 07)"
                aria-label="Buscar producto"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select className={`${input} mt-2`} aria-label="Producto" value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">{visibleProducts.length ? "Elegí el producto…" : "Ningún producto coincide"}</option>
                {visibleProducts.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {nameWithMeasure(p)} ({p.sku})
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-slate-600 dark:text-slate-300">Bodega donde están</span>
              <select className={`${input} mt-1`} value={warehouse} onChange={(e) => setWarehouse(e.target.value as RollWarehouse)}>
                {WAREHOUSES.map((w) => (
                  <option key={w} value={w}>
                    {w === "principal" ? WAREHOUSE_LABELS[w] : `Bodega de ${WAREHOUSE_LABELS[w]}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-slate-600 dark:text-slate-300">Para un cliente (opcional)</span>
              <select className={`${input} mt-1`} value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">Material general</option>
                {(clients ?? []).map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="space-y-2">
            <p className="text-sm text-slate-600 dark:text-slate-300">Rollos (uno por tiquete)</p>
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-slate-400 w-5 text-right">{i + 1}</span>
                <input
                  ref={(el) => {
                    weightRefs.current[i] = el;
                  }}
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  className={`${input} w-32`}
                  placeholder="Peso kg"
                  aria-label={`Peso del rollo ${i + 1} (kg)`}
                  value={r.weight}
                  onChange={(e) => setRow(i, { weight: e.target.value })}
                  onKeyDown={(e) => handleRowKey(e, i)}
                />
                <input
                  className={`${input} flex-1`}
                  placeholder="N° de tiquete"
                  aria-label={`Tiquete del rollo ${i + 1}`}
                  maxLength={60}
                  value={r.ticket}
                  onChange={(e) => setRow(i, { ticket: e.target.value })}
                  onKeyDown={(e) => handleRowKey(e, i)}
                />
                <button
                  type="button"
                  onClick={() => setRows((prev) => (prev.length === 1 ? [emptyRow()] : prev.filter((_, j) => j !== i)))}
                  aria-label={`Quitar rollo ${i + 1}`}
                  className="text-slate-400 hover:text-red-600"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button type="button" onClick={addRow} className="inline-flex items-center gap-1 text-sm text-sky-700 dark:text-sky-400 hover:underline">
                <Plus size={14} aria-hidden="true" /> Agregar rollo
              </button>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {filled.length} {filled.length === 1 ? "rollo" : "rollos"} · <strong>{totalKg} kg</strong>
              </p>
            </div>
          </div>

          <input className={input} placeholder="Notas (opcional)" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 bg-slate-800 text-white text-sm px-4 py-2 rounded disabled:opacity-50"
          >
            {saving ? "Guardando..." : `Ingresar ${filled.length || ""} ${filled.length === 1 ? "rollo" : "rollos"}`.replace("  ", " ")}
          </button>
        </form>
      )}
    </section>
  );
}
