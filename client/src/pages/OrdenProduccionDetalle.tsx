import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FileDown, GitBranch, Lock, Paperclip, Trash2 } from "lucide-react";
import { api } from "../api/client";
import { useAuth, type UserRole } from "../auth/AuthContext";
import { OP_EXTRUSION, OP_IMPRESION, OP_SELLADO, PRODUCCION_GESTION } from "../components/navConfig";
import {
  DERIVATIONS,
  FINAL_STATIONS,
  OPEN_STATUSES,
  OP_TEMPLATES,
  OpRollColumn,
  OpStation,
  STATION_LABELS,
} from "../opTemplates";

const STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  en_proceso: "En proceso",
  pendiente_calidad: "Pendiente de calidad",
  detenida: "Detenida",
  finalizada: "Terminada",
  cancelada: "Cancelada",
};

/** Qué roles pueden cargar rollos/cerrar en cada estación (espejo del guard
 * OPERARIO_STATIONS del backend — los grupos OP_* ya incluyen a gestión). */
const STATION_OPERATE: Record<OpStation, UserRole[]> = {
  extrusion: OP_EXTRUSION,
  impresion: OP_IMPRESION,
  sellado: OP_SELLADO,
  precorte: OP_SELLADO,
};

// Clases compartidas de la "hoja" estilo Excel
const cellBorder = "border border-slate-300 dark:border-slate-600";
const cellLabel = "block text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
const sheetInput =
  "w-full bg-transparent text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:bg-sky-50 dark:focus:bg-slate-800 disabled:text-slate-500 dark:disabled:text-slate-400";

function SheetBand({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5">
      {children}
    </div>
  );
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

interface MateriaPrimaRow {
  ref: string;
  pct: string;
  lote: string;
}

interface ColorRow {
  unidad: string;
  color: string;
  lote: string;
}

export default function OrdenProduccionDetalle() {
  const { id } = useParams<{ id: string }>();
  const orderId = Number(id);
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [specsDraft, setSpecsDraft] = useState<Record<string, any>>({});
  const [materiaPrima, setMateriaPrima] = useState<MateriaPrimaRow[]>([]);
  const [colores, setColores] = useState<{ cara1: ColorRow[]; cara2: ColorRow[] }>({ cara1: [], cara2: [] });
  const [headerDraft, setHeaderDraft] = useState({ quantityPlanned: "", measure: "" });
  const [dirty, setDirty] = useState(false);
  const [rollDraft, setRollDraft] = useState<Record<string, string>>({ date: todayISO() });
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const { data: order, isLoading } = useQuery({
    queryKey: ["productionOrder", orderId],
    queryFn: () => api.getProductionOrder(orderId),
    enabled: Number.isInteger(orderId),
  });

  // Sincroniza los borradores locales cuando llega/cambia la OP del server.
  useEffect(() => {
    if (!order) return;
    const specs = order.specs ?? {};
    setSpecsDraft(specs);
    setMateriaPrima(
      ((specs.materiaPrima as any[]) ?? []).map((r) => ({ ref: String(r.ref ?? ""), pct: String(r.pct ?? ""), lote: String(r.lote ?? "") }))
    );
    setColores({
      cara1: ((specs.coloresCara1 as any[]) ?? []).map((c) => ({ unidad: String(c.unidad ?? ""), color: String(c.color ?? ""), lote: String(c.lote ?? "") })),
      cara2: ((specs.coloresCara2 as any[]) ?? []).map((c) => ({ unidad: String(c.unidad ?? ""), color: String(c.color ?? ""), lote: String(c.lote ?? "") })),
    });
    setHeaderDraft({ quantityPlanned: String(Number(order.quantityPlanned)), measure: order.measure ?? "" });
    setDirty(false);
  }, [order]);

  if (!Number.isInteger(orderId)) return <p className="text-red-600 dark:text-red-400">OP inválida.</p>;
  if (isLoading || !order) return <p className="text-slate-500 dark:text-slate-400 text-sm">Cargando...</p>;

  const station = order.station as OpStation;
  const template = OP_TEMPLATES[station];
  const isOpen = OPEN_STATUSES.includes(order.status);
  const canGestion = !!user && (PRODUCCION_GESTION as UserRole[]).includes(user.role);
  const canOperate = !!user && STATION_OPERATE[station].includes(user.role);
  const canEditSpecs = canGestion && isOpen;
  const qty = Number(headerDraft.quantityPlanned) || Number(order.quantityPlanned);

  const totalKg = order.rolls.reduce((acc: number, r: any) => acc + Number(r.weightKg), 0);
  const totalWaste = order.rolls.reduce((acc: number, r: any) => acc + Number(r.wasteKg), 0);

  function markDirty() {
    setDirty(true);
    setMessage(null);
  }

  function setSpec(key: string, value: string) {
    setSpecsDraft((prev) => ({ ...prev, [key]: value }));
    markDirty();
  }

  async function handleSaveSpecs() {
    setError(null);
    try {
      const specs: Record<string, any> = { ...specsDraft };
      if (template.materiaPrimaRefs) {
        specs.materiaPrima = materiaPrima
          .filter((r) => r.ref && r.pct)
          .map((r) => ({ ref: r.ref, pct: Number(r.pct), lote: r.lote || undefined }));
      }
      if (template.colores) {
        specs.coloresCara1 = colores.cara1.filter((c) => c.color).map((c) => ({ unidad: c.unidad, color: c.color, lote: c.lote || undefined }));
        specs.coloresCara2 = colores.cara2.filter((c) => c.color).map((c) => ({ unidad: c.unidad, color: c.color, lote: c.lote || undefined }));
      }
      await api.updateProductionOrder(orderId, {
        specs,
        quantityPlanned: Number(headerDraft.quantityPlanned) || undefined,
        measure: headerDraft.measure || undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["productionOrder", orderId] });
      queryClient.invalidateQueries({ queryKey: ["productionOrders"] });
      setMessage("Cambios guardados.");
    } catch {
      setError("No se pudieron guardar los cambios");
    }
  }

  async function handleAddRoll(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!rollDraft.operator || !rollDraft.weight) {
      setError("Completá al menos operario y peso del rollo");
      return;
    }
    const details: Record<string, string> = {};
    for (const col of template.rollColumns) {
      if (col.source === "detail" && rollDraft[`detail:${col.detailKey}`]) {
        details[col.detailKey!] = rollDraft[`detail:${col.detailKey}`];
      }
    }
    try {
      await api.createProductionRoll(orderId, {
        date: rollDraft.date ? new Date(rollDraft.date + "T12:00:00").toISOString() : undefined,
        shift: rollDraft.shift || undefined,
        operatorName: rollDraft.operator,
        machine: rollDraft.machine || undefined,
        label: rollDraft.label || undefined,
        weightKg: Number(rollDraft.weight),
        wasteKg: rollDraft.waste ? Number(rollDraft.waste) : undefined,
        details: Object.keys(details).length ? details : undefined,
      });
      setRollDraft({ date: todayISO() });
      queryClient.invalidateQueries({ queryKey: ["productionOrder", orderId] });
      queryClient.invalidateQueries({ queryKey: ["productionOrders"] });
    } catch (err: any) {
      setError(err?.message?.includes("403") ? "Tu rol no puede registrar rollos en esta estación" : "No se pudo registrar el rollo");
    }
  }

  async function handleDeleteRoll(rollId: number) {
    setError(null);
    try {
      await api.deleteProductionRoll(orderId, rollId);
      queryClient.invalidateQueries({ queryKey: ["productionOrder", orderId] });
    } catch {
      setError("No se pudo borrar el rollo");
    }
  }

  async function handleDerive(target: OpStation) {
    setError(null);
    try {
      const derived = await api.deriveProductionOrder(orderId, { station: target });
      queryClient.invalidateQueries({ queryKey: ["productionOrders"] });
      navigate(`/produccion/ordenes/${derived.id}`);
    } catch {
      setError("No se pudo derivar la OP");
    }
  }

  async function handleClose() {
    setError(null);
    const isFinal = FINAL_STATIONS.includes(station);
    const confirmMsg = isFinal
      ? "¿Cerrar la OP? Pasará a revisión de Calidad y, si se aprueba, sus kilos entran al inventario."
      : "¿Cerrar la OP? Quedará terminada (su material sigue en las OPs derivadas).";
    if (!window.confirm(confirmMsg)) return;
    try {
      await api.closeProductionOrder(orderId);
      queryClient.invalidateQueries({ queryKey: ["productionOrder", orderId] });
      queryClient.invalidateQueries({ queryKey: ["productionOrders"] });
    } catch (err: any) {
      setError(err?.message ?? "No se pudo cerrar la OP");
    }
  }

  async function handleUploadAttachment() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    setError(null);
    try {
      await api.uploadProductionOrderAttachment(orderId, file);
      if (fileInputRef.current) fileInputRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["productionOrder", orderId] });
    } catch {
      setError("No se pudo subir el archivo");
    }
  }

  function rollCellDisplay(roll: any, col: OpRollColumn) {
    switch (col.source) {
      case "date":
        return new Date(roll.date).toLocaleDateString();
      case "shift":
        return roll.shift ?? "—";
      case "operator":
        return roll.operatorName;
      case "machine":
        return roll.machine ?? "—";
      case "label":
        return roll.label ?? "—";
      case "weight":
        return String(Number(roll.weightKg));
      case "waste":
        return String(Number(roll.wasteKg));
      case "detail":
        return roll.details?.[col.detailKey!] != null && roll.details?.[col.detailKey!] !== "" ? String(roll.details[col.detailKey!]) : "—";
    }
  }

  function rollDraftKey(col: OpRollColumn) {
    return col.source === "detail" ? `detail:${col.detailKey}` : col.source === "operator" ? "operator" : col.source;
  }

  const derivations = DERIVATIONS[station];

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to="/produccion/ordenes" className="text-sm text-sky-700 dark:text-sky-400 hover:underline">
          ← Órdenes de producción
        </Link>
        <div className="flex flex-wrap gap-2">
          {canGestion &&
            derivations.map((target) => (
              <button
                key={target}
                type="button"
                onClick={() => handleDerive(target)}
                className="inline-flex items-center gap-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded px-3 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <GitBranch size={14} aria-hidden="true" /> Derivar a {STATION_LABELS[target]}
              </button>
            ))}
          {canOperate && isOpen && (
            <button
              type="button"
              onClick={handleClose}
              className="inline-flex items-center gap-1.5 text-sm bg-emerald-700 hover:bg-emerald-600 text-white rounded px-3 py-1.5"
            >
              <Lock size={14} aria-hidden="true" /> Cerrar OP
            </button>
          )}
          <button
            type="button"
            onClick={() => api.downloadProductionOrderPdf(orderId, order.orderNumber)}
            className="inline-flex items-center gap-1.5 text-sm bg-slate-800 hover:bg-slate-700 text-white rounded px-3 py-1.5"
          >
            <FileDown size={14} aria-hidden="true" /> Reporte PDF
          </button>
        </div>
      </div>

      {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}
      {message && <p className="text-emerald-700 dark:text-emerald-400 text-sm">{message}</p>}

      {/* ---- La hoja, con la estructura del formato en papel ---- */}
      <div className="bg-white dark:bg-slate-900 border-2 border-slate-400 dark:border-slate-500 shadow overflow-x-auto">
        {/* Banda de título */}
        <div className="grid grid-cols-[1fr_2fr_1fr] border-b-2 border-slate-400 dark:border-slate-500">
          <div className={`${cellBorder} border-t-0 border-l-0 p-2 flex items-center`}>
            <p className="text-xs font-bold text-slate-800 dark:text-slate-100">Plásticos Superior S.A.S.</p>
          </div>
          <div className={`${cellBorder} border-t-0 p-2 flex items-center justify-center`}>
            <p className="text-sm sm:text-base font-bold text-slate-800 dark:text-slate-100 text-center">{template.title}</p>
          </div>
          <div className={`${cellBorder} border-t-0 border-r-0 p-2 text-[10px] text-slate-500 dark:text-slate-400 space-y-0.5`}>
            <p className="font-semibold">{template.cod}</p>
            <p>FECHA {new Date(order.createdAt).toLocaleDateString()}</p>
            <p className="uppercase font-semibold">{STATUS_LABELS[order.status]}</p>
          </div>
        </div>

        {/* Encabezado */}
        <div className="grid grid-cols-2 sm:grid-cols-3">
          <div className={`${cellBorder} p-2`}>
            <span className={cellLabel}>Nro O.Prod</span>
            <span className="text-sm font-bold text-slate-800 dark:text-slate-100">{order.orderNumber}</span>
          </div>
          <div className={`${cellBorder} p-2`}>
            <span className={cellLabel}>Cliente</span>
            <span className="text-sm text-slate-800 dark:text-slate-100">{order.client?.name ?? "—"}</span>
          </div>
          <div className={`${cellBorder} p-2`}>
            <span className={cellLabel}>Referencia</span>
            <span className="text-sm text-slate-800 dark:text-slate-100">
              {order.product.name} ({order.product.sku})
            </span>
          </div>
          <div className={`${cellBorder} p-2`}>
            <span className={cellLabel}>Medidas</span>
            <input
              className={sheetInput}
              value={headerDraft.measure}
              disabled={!canEditSpecs}
              onChange={(e) => {
                setHeaderDraft((h) => ({ ...h, measure: e.target.value }));
                markDirty();
              }}
            />
          </div>
          <div className={`${cellBorder} p-2`}>
            <span className={cellLabel}>Cantidad (kilos)</span>
            <input
              className={sheetInput}
              type="number"
              step="0.01"
              value={headerDraft.quantityPlanned}
              disabled={!canEditSpecs}
              onChange={(e) => {
                setHeaderDraft((h) => ({ ...h, quantityPlanned: e.target.value }));
                markDirty();
              }}
            />
          </div>
          <div className={`${cellBorder} p-2`}>
            <span className={cellLabel}>Máquina</span>
            <input className={sheetInput} value={specsDraft.maquina ?? ""} disabled={!canEditSpecs} onChange={(e) => setSpec("maquina", e.target.value)} />
          </div>
          {order.parent && (
            <div className={`${cellBorder} p-2`}>
              <span className={cellLabel}>Derivada de</span>
              <Link to={`/produccion/ordenes/${order.parent.id}`} className="text-sm text-sky-700 dark:text-sky-400 hover:underline">
                {order.parent.orderNumber} ({STATION_LABELS[order.parent.station as OpStation]})
              </Link>
            </div>
          )}
          {order.derivedOrders?.length > 0 && (
            <div className={`${cellBorder} p-2`}>
              <span className={cellLabel}>Deriva en</span>
              <span className="text-sm space-x-2">
                {order.derivedOrders.map((d: any) => (
                  <Link key={d.id} to={`/produccion/ordenes/${d.id}`} className="text-sky-700 dark:text-sky-400 hover:underline">
                    {d.orderNumber} ({STATION_LABELS[d.station as OpStation]})
                  </Link>
                ))}
              </span>
            </div>
          )}
        </div>

        {/* Materia prima (solo Extrusión): kg = % × cantidad, como el Excel */}
        {template.materiaPrimaRefs && (
          <>
            <SheetBand>Materia prima</SheetBand>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase text-slate-500 dark:text-slate-400">
                  <th className={`${cellBorder} px-2 py-1`}>Ref.</th>
                  <th className={`${cellBorder} px-2 py-1 w-24`}>%</th>
                  <th className={`${cellBorder} px-2 py-1 w-28`}>Kg</th>
                  <th className={`${cellBorder} px-2 py-1 w-32`}>Lote</th>
                  {canEditSpecs && <th className={`${cellBorder} px-2 py-1 w-10`} />}
                </tr>
              </thead>
              <tbody>
                {materiaPrima.map((row, i) => (
                  <tr key={i}>
                    <td className={`${cellBorder} px-2 py-1`}>
                      {canEditSpecs ? (
                        <select
                          className={sheetInput}
                          value={row.ref}
                          onChange={(e) => {
                            setMateriaPrima((prev) => prev.map((r, idx) => (idx === i ? { ...r, ref: e.target.value } : r)));
                            markDirty();
                          }}
                        >
                          <option value="">Ref...</option>
                          {template.materiaPrimaRefs!.map((ref) => (
                            <option key={ref} value={ref}>
                              {ref}
                            </option>
                          ))}
                        </select>
                      ) : (
                        row.ref || "—"
                      )}
                    </td>
                    <td className={`${cellBorder} px-2 py-1`}>
                      <input
                        className={sheetInput}
                        type="number"
                        step="0.01"
                        value={row.pct}
                        disabled={!canEditSpecs}
                        onChange={(e) => {
                          setMateriaPrima((prev) => prev.map((r, idx) => (idx === i ? { ...r, pct: e.target.value } : r)));
                          markDirty();
                        }}
                      />
                    </td>
                    <td className={`${cellBorder} px-2 py-1 text-slate-500 dark:text-slate-400`}>
                      {row.pct ? Math.round(((Number(row.pct) / 100) * qty) * 100) / 100 : "—"}
                    </td>
                    <td className={`${cellBorder} px-2 py-1`}>
                      <input
                        className={sheetInput}
                        value={row.lote}
                        disabled={!canEditSpecs}
                        onChange={(e) => {
                          setMateriaPrima((prev) => prev.map((r, idx) => (idx === i ? { ...r, lote: e.target.value } : r)));
                          markDirty();
                        }}
                      />
                    </td>
                    {canEditSpecs && (
                      <td className={`${cellBorder} px-2 py-1 text-center`}>
                        <button
                          type="button"
                          className="text-red-600 dark:text-red-400"
                          onClick={() => {
                            setMateriaPrima((prev) => prev.filter((_, idx) => idx !== i));
                            markDirty();
                          }}
                        >
                          <Trash2 size={13} aria-hidden="true" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className={`${cellBorder} px-2 py-1`}>Total</td>
                  <td className={`${cellBorder} px-2 py-1`}>
                    {Math.round(materiaPrima.reduce((acc, r) => acc + (Number(r.pct) || 0), 0) * 100) / 100}%
                  </td>
                  <td className={`${cellBorder} px-2 py-1`}>{qty}</td>
                  <td className={`${cellBorder} px-2 py-1`} colSpan={canEditSpecs ? 2 : 1} />
                </tr>
              </tbody>
            </table>
            {canEditSpecs && (
              <button
                type="button"
                className="text-xs text-sky-700 dark:text-sky-400 hover:underline px-3 py-1.5"
                onClick={() => setMateriaPrima((prev) => [...prev, { ref: "", pct: "", lote: "" }])}
              >
                + Agregar materia prima
              </button>
            )}
          </>
        )}

        {/* Secciones de specs de la estación */}
        {template.sections.map((section) => (
          <div key={section.title}>
            <SheetBand>{section.title}</SheetBand>
            <div className="grid grid-cols-2 sm:grid-cols-3">
              {section.fields.map((field) => (
                <div key={field.key} className={`${cellBorder} p-2`}>
                  <span className={cellLabel}>{field.label}</span>
                  {field.kind === "options" ? (
                    <select className={sheetInput} value={specsDraft[field.key] ?? ""} disabled={!canEditSpecs} onChange={(e) => setSpec(field.key, e.target.value)}>
                      <option value="">—</option>
                      {field.options!.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className={sheetInput}
                      type={field.kind === "number" ? "number" : "text"}
                      value={specsDraft[field.key] ?? ""}
                      disabled={!canEditSpecs}
                      onChange={(e) => setSpec(field.key, e.target.value)}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Colores cara 1/2 (solo Impresión) */}
        {template.colores &&
          ([1, 2] as const).map((cara) => {
            const key = `cara${cara}` as "cara1" | "cara2";
            const rows = colores[key];
            if (!canEditSpecs && rows.length === 0) return null;
            return (
              <div key={cara}>
                <SheetBand>Colores cara {cara}</SheetBand>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] uppercase text-slate-500 dark:text-slate-400">
                      <th className={`${cellBorder} px-2 py-1 w-24`}>Unidad</th>
                      <th className={`${cellBorder} px-2 py-1`}>Color</th>
                      <th className={`${cellBorder} px-2 py-1 w-32`}>Lote</th>
                      {canEditSpecs && <th className={`${cellBorder} px-2 py-1 w-10`} />}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i}>
                        {(["unidad", "color", "lote"] as const).map((fieldKey) => (
                          <td key={fieldKey} className={`${cellBorder} px-2 py-1`}>
                            <input
                              className={sheetInput}
                              value={row[fieldKey]}
                              disabled={!canEditSpecs}
                              onChange={(e) => {
                                setColores((prev) => ({
                                  ...prev,
                                  [key]: prev[key].map((r, idx) => (idx === i ? { ...r, [fieldKey]: e.target.value } : r)),
                                }));
                                markDirty();
                              }}
                            />
                          </td>
                        ))}
                        {canEditSpecs && (
                          <td className={`${cellBorder} px-2 py-1 text-center`}>
                            <button
                              type="button"
                              className="text-red-600 dark:text-red-400"
                              onClick={() => {
                                setColores((prev) => ({ ...prev, [key]: prev[key].filter((_, idx) => idx !== i) }));
                                markDirty();
                              }}
                            >
                              <Trash2 size={13} aria-hidden="true" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {canEditSpecs && (
                  <button
                    type="button"
                    className="text-xs text-sky-700 dark:text-sky-400 hover:underline px-3 py-1.5"
                    onClick={() => setColores((prev) => ({ ...prev, [key]: [...prev[key], { unidad: String(prev[key].length + 1), color: "", lote: "" }] }))}
                  >
                    + Agregar color
                  </button>
                )}
              </div>
            );
          })}

        {canEditSpecs && dirty && (
          <div className="p-3 border-t border-slate-300 dark:border-slate-600 bg-amber-50 dark:bg-amber-950 flex items-center justify-between gap-2">
            <p className="text-xs text-amber-700 dark:text-amber-400">Hay cambios sin guardar en el encabezado.</p>
            <button type="button" onClick={handleSaveSpecs} className="bg-slate-800 text-white text-sm px-4 py-1.5 rounded">
              Guardar cambios
            </button>
          </div>
        )}

        {/* Registro de rollos */}
        <SheetBand>Registro de rollos / avance</SheetBand>
        <table className="w-full text-xs sm:text-sm">
          <thead>
            <tr className="text-left text-[9px] sm:text-[10px] uppercase text-slate-500 dark:text-slate-400">
              {template.rollColumns.map((col) => (
                <th key={col.label} className={`${cellBorder} px-1.5 py-1`}>
                  {col.label}
                </th>
              ))}
              {canGestion && isOpen && <th className={`${cellBorder} px-1.5 py-1 w-8`} />}
            </tr>
          </thead>
          <tbody>
            {order.rolls.map((roll: any) => (
              <tr key={roll.id}>
                {template.rollColumns.map((col) => (
                  <td key={col.label} className={`${cellBorder} px-1.5 py-1 text-slate-800 dark:text-slate-100`}>
                    {rollCellDisplay(roll, col)}
                  </td>
                ))}
                {canGestion && isOpen && (
                  <td className={`${cellBorder} px-1.5 py-1 text-center`}>
                    <button type="button" className="text-red-600 dark:text-red-400" title="Borrar rollo" onClick={() => handleDeleteRoll(roll.id)}>
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {order.rolls.length === 0 && (
              <tr>
                <td className={`${cellBorder} px-2 py-3 text-center text-slate-500 dark:text-slate-400`} colSpan={template.rollColumns.length + 1}>
                  Sin rollos registrados todavía.
                </td>
              </tr>
            )}
            {/* Fila de carga inline */}
            {canOperate && isOpen && (
              <tr className="bg-sky-50 dark:bg-slate-800">
                {template.rollColumns.map((col) => {
                  const key = rollDraftKey(col);
                  return (
                    <td key={col.label} className={`${cellBorder} px-1 py-1`}>
                      {col.kind === "siNo" ? (
                        <select className={sheetInput} value={rollDraft[key] ?? ""} onChange={(e) => setRollDraft((d) => ({ ...d, [key]: e.target.value }))}>
                          <option value="">—</option>
                          <option value="SI">SI</option>
                          <option value="NO">NO</option>
                        </select>
                      ) : (
                        <input
                          className={sheetInput}
                          type={col.source === "date" ? "date" : col.kind === "number" ? "number" : "text"}
                          step={col.kind === "number" ? "0.01" : undefined}
                          value={rollDraft[key] ?? ""}
                          onChange={(e) => setRollDraft((d) => ({ ...d, [key]: e.target.value }))}
                        />
                      )}
                    </td>
                  );
                })}
                <td className={`${cellBorder} px-1 py-1`}>
                  <button type="button" onClick={handleAddRoll} className="bg-slate-800 text-white text-xs px-2 py-1 rounded whitespace-nowrap">
                    +
                  </button>
                </td>
              </tr>
            )}
            {/* Totales */}
            <tr className="font-semibold bg-slate-100 dark:bg-slate-800">
              <td className={`${cellBorder} px-1.5 py-1`} colSpan={Math.max(1, template.rollColumns.length - 2)}>
                Total · {order.rolls.length} rollos
              </td>
              <td className={`${cellBorder} px-1.5 py-1`}>{Math.round(totalKg * 100) / 100} kg</td>
              <td className={`${cellBorder} px-1.5 py-1`} colSpan={canGestion && isOpen ? 2 : 1}>
                Desp. {Math.round(totalWaste * 100) / 100} kg
              </td>
            </tr>
          </tbody>
        </table>

        {/* Resultado de calidad, si ya pasó */}
        {order.qualityCheck && (
          <div
            className={`px-3 py-2 text-sm border-t border-slate-300 dark:border-slate-600 ${
              order.qualityCheck.result === "aprobado"
                ? "bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400"
                : "bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-400"
            }`}
          >
            Calidad: <strong>{order.qualityCheck.result}</strong>
            {order.qualityCheck.observations && <> — {order.qualityCheck.observations}</>}
            {order.qualityCheck.createdBy?.name && <> · {order.qualityCheck.createdBy.name}</>}
          </div>
        )}
      </div>

      {/* Adjuntos */}
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 space-y-3">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5">
          <Paperclip size={14} aria-hidden="true" /> Adjuntos
        </p>
        <ul className="divide-y divide-slate-100 dark:divide-slate-700">
          {order.attachments?.map((a: any) => (
            <li key={a.id} className="py-2 flex items-center justify-between text-sm">
              <span className="text-slate-800 dark:text-slate-100">
                {a.originalName}{" "}
                <span className="text-xs text-slate-500 dark:text-slate-400">({Math.round(a.sizeBytes / 1024)} KB)</span>
              </span>
              <button
                onClick={() => api.downloadProductionOrderAttachment(orderId, a.id, a.originalName)}
                className="text-sky-700 dark:text-sky-400 text-xs hover:underline"
              >
                Descargar
              </button>
            </li>
          ))}
          {(!order.attachments || order.attachments.length === 0) && (
            <p className="text-slate-500 dark:text-slate-400 text-sm py-1">Sin adjuntos todavía.</p>
          )}
        </ul>
        {canOperate && (
          <div className="flex gap-2 items-center border-t border-slate-100 dark:border-slate-700 pt-3">
            <input ref={fileInputRef} type="file" className="text-sm dark:bg-slate-800 dark:text-slate-100" />
            <button onClick={handleUploadAttachment} className="bg-slate-800 text-white text-sm px-4 py-2 rounded">
              Subir
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
