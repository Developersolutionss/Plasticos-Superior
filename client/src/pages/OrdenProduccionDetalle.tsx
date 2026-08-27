import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FileDown, GitBranch, Lock, Paperclip, RotateCcw, ScanLine, Send, Trash2, X } from "lucide-react";
import { api } from "../api/client";
import { useAuth, type UserRole } from "../auth/AuthContext";
import { OP_EXTRUSION, OP_IMPRESION, OP_SELLADO, PRODUCCION_GESTION } from "../components/navConfig";
import BarcodeScanner from "../components/BarcodeScanner";
import {
  DERIVATIONS,
  FINAL_STATIONS,
  OPEN_STATUSES,
  REOPENABLE_STATUSES,
  OP_TEMPLATES,
  OpRollColumn,
  OpStation,
  STATION_LABELS,
} from "../opTemplates";

const STATUS_LABELS: Record<string, string> = {
  borrador: "Borrador",
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

/** Mismo patrón que printLabels en Productos.tsx: ventana nueva
 * autocontenida + @media print, con el mismo cuidado de escapar el texto
 * interpolado y esperar a que el QR (data: URI) termine de decodificar antes
 * de imprimir (si no, la primera impresión sale con el QR vacío). */
function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function printRollLabel(label: { code: string; orderNumber: string; productName: string; weightKg: unknown; qrDataUrl: string }) {
  const win = window.open("", "_blank");
  if (!win) return;

  const code = escapeHtml(label.code);
  const info = escapeHtml(`${label.orderNumber} · ${label.productName} · ${Number(label.weightKg)} kg`);

  win.document.write(`<!DOCTYPE html>
    <html>
      <head>
        <title>Etiqueta de rollo</title>
        <style>
          * { box-sizing: border-box; }
          body { font-family: sans-serif; margin: 0; padding: 8mm; }
          .label {
            width: 6cm; min-height: 4cm; height: auto;
            border: 1px dashed #999; border-radius: 3mm;
            padding: 3mm; display: flex; align-items: center; gap: 3mm;
          }
          .label img { width: 2.6cm; height: 2.6cm; flex-shrink: 0; }
          .label .text { overflow: hidden; min-width: 0; }
          .label .code { font-weight: bold; font-size: 12pt; margin: 0 0 2mm; overflow-wrap: anywhere; word-break: break-word; }
          .label .info { font-size: 8pt; margin: 0; color: #333; overflow-wrap: anywhere; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="label">
          <img src="${label.qrDataUrl}" alt="QR ${code}" />
          <div class="text">
            <p class="code">${code}</p>
            <p class="info">${info}</p>
          </div>
        </div>
      </body>
    </html>`);
  win.document.close();

  let printed = false;
  const doPrint = () => {
    if (printed) return;
    printed = true;
    win.focus();
    win.print();
  };
  win.onload = doPrint;
  setTimeout(doPrint, 400);
}

interface MateriaPrimaRow {
  ref: string;
  /** Kg del insumo, cargado a mano igual que en el papel — es el único
   * dato que se tipea; el % se calcula solo a partir de esto (ver
   * `materiaPrimaPct` más abajo), no se vuelve a pedir por separado. */
  kg: string;
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
  const [headerDraft, setHeaderDraft] = useState({ quantityPlanned: "", measure: "", notes: "" });
  const [dirty, setDirty] = useState(false);
  const [rollDraft, setRollDraft] = useState<Record<string, string>>({});
  const [sourceRoll, setSourceRoll] = useState<{ id: number; label: string | null; weightKg: unknown; createdBy?: { name: string } | null } | null>(null);
  const [scanningSource, setScanningSource] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reopening, setReopening] = useState(false);
  const [releasing, setReleasing] = useState(false);
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
    // Las filas de materia prima son fijas (las mismas 10 refs impresas en
    // el papel, en su mismo orden) — no una lista donde se van agregando;
    // se guardan solo las que tengan % o kg cargado (ver handleSaveSpecs).
    const savedRows = (specs.materiaPrima as any[]) ?? [];
    const refs = OP_TEMPLATES[order.station as OpStation].materiaPrimaRefs ?? [];
    setMateriaPrima(
      refs.map((ref) => {
        const saved = savedRows.find((r) => r.ref === ref);
        return {
          ref,
          kg: saved ? String(saved.kg ?? "") : "",
          lote: saved ? String(saved.lote ?? "") : "",
        };
      })
    );
    setColores({
      cara1: ((specs.coloresCara1 as any[]) ?? []).map((c) => ({ unidad: String(c.unidad ?? ""), color: String(c.color ?? ""), lote: String(c.lote ?? "") })),
      cara2: ((specs.coloresCara2 as any[]) ?? []).map((c) => ({ unidad: String(c.unidad ?? ""), color: String(c.color ?? ""), lote: String(c.lote ?? "") })),
    });
    setHeaderDraft({ quantityPlanned: String(Number(order.quantityPlanned)), measure: order.measure ?? "", notes: order.notes ?? "" });
    setDirty(false);
  }, [order]);

  if (!Number.isInteger(orderId)) return <p className="text-red-600 dark:text-red-400">OP inválida.</p>;
  if (isLoading || !order) return <p className="text-slate-500 dark:text-slate-400 text-sm">Cargando...</p>;

  const station = order.station as OpStation;
  const template = OP_TEMPLATES[station];
  const isDraft = order.status === "borrador";
  const isOpen = OPEN_STATUSES.includes(order.status);
  const isReopenable = REOPENABLE_STATUSES.includes(order.status);
  const canGestion = !!user && (PRODUCCION_GESTION as UserRole[]).includes(user.role);
  const canOperate = !!user && STATION_OPERATE[station].includes(user.role);
  // En "borrador" también se edita specs — es justo cuando Gestión carga
  // materia prima/medidas/cliente/referencia antes de liberarla a planta.
  const canEditSpecs = canGestion && (isDraft || isOpen);

  const totalKg = order.rolls.reduce((acc: number, r: any) => acc + Number(r.weightKg), 0);
  const totalWaste = order.rolls.reduce((acc: number, r: any) => acc + Number(r.wasteKg), 0);
  // Acumulado hasta cada fila (columna TOTAL del papel) — order.rolls ya
  // viene ordenado por fecha/id asc desde el backend.
  const rollCumulative: number[] = [];
  order.rolls.reduce((acc: number, r: any, i: number) => {
    const next = acc + Number(r.weightKg);
    rollCumulative[i] = next;
    return next;
  }, 0);

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
        const totalMpKg = materiaPrima.reduce((acc, r) => acc + (Number(r.kg) || 0), 0);
        specs.materiaPrima = materiaPrima
          .filter((r) => r.kg)
          .map((r) => ({
            ref: r.ref,
            pct: totalMpKg > 0 ? Math.round(((Number(r.kg) || 0) / totalMpKg) * 100 * 100) / 100 : undefined,
            kg: r.kg ? Number(r.kg) : undefined,
            lote: r.lote || undefined,
          }));
      }
      if (template.colores) {
        specs.coloresCara1 = colores.cara1.filter((c) => c.color).map((c) => ({ unidad: c.unidad, color: c.color, lote: c.lote || undefined }));
        specs.coloresCara2 = colores.cara2.filter((c) => c.color).map((c) => ({ unidad: c.unidad, color: c.color, lote: c.lote || undefined }));
      }
      await api.updateProductionOrder(orderId, {
        specs,
        quantityPlanned: Number(headerDraft.quantityPlanned) || undefined,
        // "" (campo vaciado a propósito) tiene que mandarse como null, no
        // como undefined — undefined se cae del JSON y el backend interpreta
        // "no tocar este campo", dejando pisado el valor viejo.
        measure: headerDraft.measure || null,
        notes: headerDraft.notes || null,
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
    if (!rollDraft.weight) {
      setError("Completá el peso del rollo");
      return;
    }
    const details: Record<string, string> = {};
    for (const col of template.rollColumns) {
      if (col.source === "detail" && rollDraft[`detail:${col.detailKey}`]) {
        details[col.detailKey!] = rollDraft[`detail:${col.detailKey}`];
      }
    }
    try {
      const created = await api.createProductionRoll(orderId, {
        // FECHA/HORA ya no se tipean — se omiten acá para que el server las
        // deje en el momento real de guardado (`date DateTime @default(now())`),
        // que es más confiable que lo que el operario recuerde escribir.
        shift: rollDraft.shift || undefined,
        // El operario SIEMPRE es quien está logueado, no un campo libre —
        // así el registro queda atado a la cuenta real, no a lo que alguien
        // tipee. Cada operario necesita su propia cuenta (Configuración →
        // Usuarios) para que esto sea trazabilidad real y no una firma falsa.
        operatorName: user!.name,
        machine: rollDraft.machine || undefined,
        // ETIQUETA: en Extrusión e Impresión es la identidad del rollo que
        // se está creando ahora mismo — no tiene sentido pedirla a mano, se
        // genera sola (código RL-<id>, ver rollCellDisplay) apenas se guarda
        // la fila. En Sellado/Precorte sigue siendo el rollo de ORIGEN que
        // se está tomando como insumo, así que ahí se mantiene manual/editable.
        label: template.labelIsOwnRoll ? undefined : rollDraft.label || undefined,
        weightKg: Number(rollDraft.weight),
        wasteKg: rollDraft.waste ? Number(rollDraft.waste) : undefined,
        details: Object.keys(details).length ? details : undefined,
        sourceRollId: sourceRoll?.id,
      });
      setRollDraft({});
      setSourceRoll(null);
      queryClient.invalidateQueries({ queryKey: ["productionOrder", orderId] });
      queryClient.invalidateQueries({ queryKey: ["productionOrders"] });
      // Etiqueta con QR del rollo recién creado, para pegar en el rollo
      // físico — así la estación siguiente puede escanearlo como origen.
      const label = await api.getProductionRollLabel(orderId, created.id);
      printRollLabel(label);
    } catch (err: any) {
      setError(err?.message?.includes("403") ? "Tu rol no puede registrar rollos en esta estación" : "No se pudo registrar el rollo");
    }
  }

  function handleScannedSource(code: string) {
    setScanningSource(false);
    setError(null);
    api
      .getProductionRollByCode(code)
      .then((roll) => {
        setSourceRoll(roll);
        setRollDraft((d) => {
          const next = { ...d };
          if (template.originRollFields) {
            next[`detail:${template.originRollFields.labelDetailKey}`] = roll.label ?? roll.code;
            next[`detail:${template.originRollFields.weightDetailKey}`] = String(Number(roll.weightKg));
          }
          // Pruebas SI/NO (ej. P. RESISTENCIA): si el rollo escaneado ya
          // tiene esa misma prueba registrada de su propia estación, se
          // precarga acá como punto de partida — el operario la puede
          // cambiar, no queda trabada.
          for (const col of template.rollColumns) {
            if (col.source === "detail" && col.kind === "siNo" && roll.details?.[col.detailKey!] != null) {
              next[`detail:${col.detailKey}`] = String(roll.details[col.detailKey!]);
            }
          }
          return next;
        });
      })
      .catch(() => setError('No se encontró ningún rollo con ese código. ¿Es un QR de rollo válido ("RL-...")?'));
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

  async function handleReopen() {
    setError(null);
    if (
      !window.confirm(
        "¿Reabrir la OP para corregir un error? Si tenía calidad aprobada, se revierte la entrada al inventario; si es de Extrusión, se devuelve la materia prima descontada. Vas a tener que volver a cerrarla (y pasarla por Calidad si corresponde) después de corregirla."
      )
    )
      return;
    setReopening(true);
    try {
      await api.reopenProductionOrder(orderId);
      queryClient.invalidateQueries({ queryKey: ["productionOrder", orderId] });
      queryClient.invalidateQueries({ queryKey: ["productionOrders"] });
    } catch (err: any) {
      setError(err?.message ?? "No se pudo reabrir la OP");
    } finally {
      setReopening(false);
    }
  }

  async function handleRelease() {
    setError(null);
    if (!window.confirm(`¿Liberar esta OP a planta? A partir de ahora la va a ver la cola de ${STATION_LABELS[station]} y va a poder cargar rollos.`)) return;
    setReleasing(true);
    try {
      await api.releaseProductionOrder(orderId);
      queryClient.invalidateQueries({ queryKey: ["productionOrder", orderId] });
      queryClient.invalidateQueries({ queryKey: ["productionOrders"] });
    } catch (err: any) {
      setError(err?.message ?? "No se pudo liberar la OP");
    } finally {
      setReleasing(false);
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

  /** `cumulative` es la suma de kg hasta esta fila inclusive (columna TOTAL
   * del papel) — la calcula el caller recorriendo order.rolls en orden. */
  function rollCellDisplay(roll: any, col: OpRollColumn, cumulative?: number) {
    switch (col.source) {
      case "date":
        return new Date(roll.date).toLocaleDateString();
      case "time":
        // 24h ("14:30") — la versión de 12h con AM/PM es muy larga para la
        // columna angosta de HORA.
        return new Date(roll.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
      case "shift":
        return roll.shift ?? "—";
      case "operator":
        return roll.operatorName;
      case "machine":
        return roll.machine ?? "—";
      case "label":
        // En Extrusión/Impresión la etiqueta no se tipea, se genera sola
        // (mismo código RL-<id> de la etiqueta QR impresa) — así igual queda
        // algo identificable en la tabla en vez de un "—" vacío.
        return roll.label ?? (template.labelIsOwnRoll ? `RL-${roll.id}` : "—");
      case "weight":
        return String(Number(roll.weightKg));
      case "waste":
        return String(Number(roll.wasteKg));
      case "cumulativeWeight":
        return String(Math.round((cumulative ?? 0) * 100) / 100);
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
          {canGestion && isDraft && (
            <button
              type="button"
              onClick={handleRelease}
              disabled={releasing}
              className="inline-flex items-center gap-1.5 text-sm bg-sky-700 hover:bg-sky-600 text-white rounded px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send size={14} aria-hidden="true" /> {releasing ? "Liberando..." : "Liberar a planta"}
            </button>
          )}
          {/* Derivar lo puede hacer Gestión o el operario de la estación que
              está cerrando su parte — no hace falta que Gestión intervenga
              para mandar la OP al siguiente paso. */}
          {canOperate &&
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
          {canGestion && isReopenable && (
            <button
              type="button"
              onClick={handleReopen}
              disabled={reopening}
              className="inline-flex items-center gap-1.5 text-sm border border-amber-400 text-amber-700 dark:text-amber-400 dark:border-amber-500 rounded px-3 py-1.5 hover:bg-amber-50 dark:hover:bg-amber-950 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RotateCcw size={14} aria-hidden="true" /> {reopening ? "Reabriendo..." : "Reabrir OP"}
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

        {/* Materia prima (solo Extrusión): las 10 filas son fijas, en el
            mismo orden que el papel — no se agregan ni se quitan. Solo se
            tipea el Kg de cada insumo; el % se calcula solo como su parte
            del total de kg cargado (no se pide por separado, para que
            nunca quede desalineado con lo que realmente se descuenta del
            inventario de materia prima al cerrar la OP). */}
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
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const totalMpKg = materiaPrima.reduce((acc, r) => acc + (Number(r.kg) || 0), 0);
                  return materiaPrima.map((row, i) => {
                    const kg = Number(row.kg) || 0;
                    const pct = totalMpKg > 0 ? Math.round((kg / totalMpKg) * 100 * 100) / 100 : 0;
                    return (
                      <tr key={row.ref}>
                        <td className={`${cellBorder} px-2 py-1 font-medium`}>{row.ref}</td>
                        <td className={`${cellBorder} px-2 py-1 text-slate-500 dark:text-slate-400`}>{kg > 0 ? `${pct}%` : "—"}</td>
                        <td className={`${cellBorder} px-2 py-1`}>
                          <input
                            className={sheetInput}
                            type="number"
                            step="0.01"
                            value={row.kg}
                            disabled={!canEditSpecs}
                            onChange={(e) => {
                              setMateriaPrima((prev) => prev.map((r, idx) => (idx === i ? { ...r, kg: e.target.value } : r)));
                              markDirty();
                            }}
                          />
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
                      </tr>
                    );
                  });
                })()}
                <tr className="font-semibold">
                  <td className={`${cellBorder} px-2 py-1`}>Total</td>
                  <td className={`${cellBorder} px-2 py-1`}>
                    {materiaPrima.some((r) => Number(r.kg) > 0) ? "100%" : "0%"}
                  </td>
                  <td className={`${cellBorder} px-2 py-1`}>
                    {Math.round(materiaPrima.reduce((acc, r) => acc + (Number(r.kg) || 0), 0) * 100) / 100}
                  </td>
                  <td className={`${cellBorder} px-2 py-1`} />
                </tr>
              </tbody>
            </table>
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

        {/* Orden de <estación padre> / Orden <esta estación> (solo Sellado):
            kilos y rollos/bultos/desperdicio calculados de los rollos reales
            cargados, no texto libre — Unid. es el único campo manual. */}
        {template.ordenReferencia && (
          <>
            <SheetBand>
              {order.parent ? `Orden de ${STATION_LABELS[order.parent.station as OpStation]}` : "Orden de la OP padre"}
            </SheetBand>
            <div className="grid grid-cols-2 sm:grid-cols-3">
              {order.parent ? (
                <>
                  <div className={`${cellBorder} p-2`}>
                    <span className={cellLabel}>OP</span>
                    <Link to={`/produccion/ordenes/${order.parent.id}`} className="text-sm text-sky-700 dark:text-sky-400 hover:underline">
                      {order.parent.orderNumber}
                    </Link>
                  </div>
                  <div className={`${cellBorder} p-2`}>
                    <span className={cellLabel}>Kilos</span>
                    <span className="text-sm text-slate-800 dark:text-slate-100">
                      {Math.round((order.parent.rolls ?? []).reduce((acc: number, r: any) => acc + Number(r.weightKg), 0) * 100) / 100} kg
                    </span>
                  </div>
                  <div className={`${cellBorder} p-2`}>
                    <span className={cellLabel}>Rollos</span>
                    <span className="text-sm text-slate-800 dark:text-slate-100">{(order.parent.rolls ?? []).length}</span>
                  </div>
                </>
              ) : (
                <div className={`${cellBorder} p-2 sm:col-span-3`}>
                  <span className="text-sm text-slate-500 dark:text-slate-400">Esta OP no deriva de ninguna otra.</span>
                </div>
              )}
            </div>

            <SheetBand>Orden {STATION_LABELS[station].toUpperCase()}</SheetBand>
            <div className="grid grid-cols-2 sm:grid-cols-3">
              <div className={`${cellBorder} p-2`}>
                <span className={cellLabel}>Kilos</span>
                <span className="text-sm text-slate-800 dark:text-slate-100">{Math.round(totalKg * 100) / 100} kg</span>
              </div>
              <div className={`${cellBorder} p-2`}>
                <span className={cellLabel}>Bultos</span>
                <span className="text-sm text-slate-800 dark:text-slate-100">{order.rolls.length}</span>
              </div>
              {template.ordenReferenciaUnidField && (
                <div className={`${cellBorder} p-2`}>
                  <span className={cellLabel}>{template.ordenReferenciaUnidField.label}</span>
                  <input
                    className={sheetInput}
                    type="number"
                    value={specsDraft[template.ordenReferenciaUnidField.key] ?? ""}
                    disabled={!canEditSpecs}
                    onChange={(e) => setSpec(template.ordenReferenciaUnidField!.key, e.target.value)}
                  />
                </div>
              )}
              <div className={`${cellBorder} p-2`}>
                <span className={cellLabel}>Despr.</span>
                <span className="text-sm text-slate-800 dark:text-slate-100">{Math.round(totalWaste * 100) / 100} kg</span>
              </div>
            </div>
          </>
        )}

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

        {order.parentOrderId && canOperate && isOpen && (
          <div className="px-3 py-2 border-b border-slate-300 dark:border-slate-600 flex flex-wrap items-center gap-2">
            {!sourceRoll ? (
              <button
                type="button"
                onClick={() => setScanningSource(true)}
                className="inline-flex items-center gap-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded px-3 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <ScanLine size={13} aria-hidden="true" /> Escanear rollo de origen
              </button>
            ) : (
              <div className="inline-flex items-center gap-2 text-xs bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 rounded px-3 py-1.5">
                <span>
                  Rollo de origen: <strong>{sourceRoll.label ?? `#${sourceRoll.id}`}</strong> ({Number(sourceRoll.weightKg)} kg)
                  {sourceRoll.createdBy?.name && <> · cargado por {sourceRoll.createdBy.name}</>}
                </span>
                <button type="button" onClick={() => setSourceRoll(null)} title="Quitar" className="text-emerald-700 dark:text-emerald-400">
                  <X size={13} aria-hidden="true" />
                </button>
              </div>
            )}
            <span className="text-[10px] text-slate-500 dark:text-slate-400">Escaneá el QR pegado al rollo que estás tomando como insumo</span>
          </div>
        )}

        <table className="w-full text-xs sm:text-sm">
          <thead>
            <tr className="text-left text-[9px] sm:text-[10px] uppercase text-slate-500 dark:text-slate-400">
              {template.rollColumns.map((col) => (
                <th key={col.detailKey ?? col.source} className={`${cellBorder} px-1.5 py-1`}>
                  {col.label}
                </th>
              ))}
              {canGestion && isOpen && <th className={`${cellBorder} px-1.5 py-1 w-8`} />}
            </tr>
          </thead>
          <tbody>
            {order.rolls.map((roll: any, i: number) => (
              <Fragment key={roll.id}>
                <tr>
                  {template.rollColumns.map((col) => (
                    <td key={col.detailKey ?? col.source} className={`${cellBorder} px-1.5 py-1 text-slate-800 dark:text-slate-100`}>
                      {rollCellDisplay(roll, col, rollCumulative[i])}
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
                {roll.sourceRoll && (
                  <tr className="bg-slate-50 dark:bg-slate-800/60">
                    <td
                      colSpan={template.rollColumns.length + (canGestion && isOpen ? 1 : 0)}
                      className={`${cellBorder} px-1.5 py-0.5 text-[10px] text-slate-500 dark:text-slate-400`}
                    >
                      Insumo: rollo {roll.sourceRoll.label ?? `#${roll.sourceRoll.id}`} ({Number(roll.sourceRoll.weightKg)} kg) — escaneado por{" "}
                      {roll.createdBy?.name ?? roll.operatorName}
                    </td>
                  </tr>
                )}
              </Fragment>
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
                  if (col.source === "operator") {
                    return (
                      <td key={col.detailKey ?? col.source} className={`${cellBorder} px-1.5 py-1 text-slate-500 dark:text-slate-400`} title="El operario es siempre la cuenta con la que iniciaste sesión">
                        {user!.name}
                      </td>
                    );
                  }
                  if (col.source === "cumulativeWeight") {
                    return (
                      <td key={col.detailKey ?? col.source} className={`${cellBorder} px-1.5 py-1 text-slate-400 dark:text-slate-500 text-center`} title="Se calcula solo al guardar">
                        —
                      </td>
                    );
                  }
                  if (col.source === "date" || col.source === "time" || (col.source === "label" && template.labelIsOwnRoll)) {
                    return (
                      <td
                        key={col.detailKey ?? col.source}
                        className={`${cellBorder} px-1.5 py-1 text-slate-400 dark:text-slate-500 text-center italic`}
                        title={col.source === "label" ? "Se genera sola (código del rollo) al guardar" : "Se completa sola con el momento en que se guarda"}
                      >
                        se completa sola
                      </td>
                    );
                  }
                  return (
                    <td key={col.detailKey ?? col.source} className={`${cellBorder} px-1 py-1`}>
                      {col.kind === "siNo" ? (
                        <select className={sheetInput} value={rollDraft[key] ?? ""} onChange={(e) => setRollDraft((d) => ({ ...d, [key]: e.target.value }))}>
                          <option value="">—</option>
                          <option value="SI">SI</option>
                          <option value="NO">NO</option>
                        </select>
                      ) : (
                        <input
                          className={sheetInput}
                          type={col.kind === "number" ? "number" : "text"}
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

        {/* Notas / Observaciones — Sellado las tiene como dos cuadros
            separados en el papel; el resto solo tiene "Observaciones:". */}
        {template.ordenReferencia && (
          <div className={`${cellBorder} p-0`}>
            <SheetBand>Notas</SheetBand>
            <textarea
              className={`${sheetInput} p-2 min-h-16 resize-y`}
              value={headerDraft.notes}
              disabled={!canEditSpecs}
              onChange={(e) => {
                setHeaderDraft((h) => ({ ...h, notes: e.target.value }));
                markDirty();
              }}
            />
          </div>
        )}
        <div className={`${cellBorder} p-0`}>
          <SheetBand>Observaciones</SheetBand>
          <textarea
            className={`${sheetInput} p-2 min-h-16 resize-y`}
            value={specsDraft.observaciones ?? ""}
            disabled={!canEditSpecs}
            onChange={(e) => setSpec("observaciones", e.target.value)}
          />
        </div>

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

      {scanningSource && (
        <BarcodeScanner title="Escanear rollo de origen" onDetected={handleScannedSource} onClose={() => setScanningSource(false)} />
      )}
    </div>
  );
}
