import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FileDown, GitBranch, Lock, Paperclip, Printer, RotateCcw, ScanLine, Send, Trash2, X } from "lucide-react";
import { api } from "../api/client";
import { useAuth, type UserRole } from "../auth/AuthContext";
import { OP_EXTRUSION, OP_IMPRESION, OP_SELLADO, PRODUCCION_GESTION } from "../components/navConfig";
import BarcodeScanner from "../components/BarcodeScanner";
import { useConfirm } from "../components/ConfirmDialog";
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
  /** % del insumo sobre la cantidad planificada de la OP — es el único
   * dato que se tipea; el Kg se calcula solo como `% × cantidad
   * planificada / 100` (ver handleSaveSpecs), no se vuelve a pedir por
   * separado. Así lo pidió el cliente: al colocar el %, el sistema calcula
   * los kg, no al revés. */
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
  const confirm = useConfirm();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [specsDraft, setSpecsDraft] = useState<Record<string, any>>({});
  const [materiaPrima, setMateriaPrima] = useState<MateriaPrimaRow[]>([]);
  const [colores, setColores] = useState<{ cara1: ColorRow[]; cara2: ColorRow[] }>({ cara1: [], cara2: [] });
  const [headerDraft, setHeaderDraft] = useState({ quantityPlanned: "", measure: "", notes: "", alertThresholdKg: "" });
  const [dirty, setDirty] = useState(false);
  const [rollDraft, setRollDraft] = useState<Record<string, string>>({});
  const [sourceRoll, setSourceRoll] = useState<{ id: number; label: string | null; weightKg: unknown; createdBy?: { name: string } | null } | null>(null);
  const [scanningSource, setScanningSource] = useState(false);
  const [bultoLabel, setBultoLabel] = useState<{ id: number; code: string } | null>(null);
  const [scanningBultoLabel, setScanningBultoLabel] = useState(false);
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
    const specs = { ...(order.specs ?? {}) } as Record<string, any>;
    // Si la OP ya nace con Medidas cargadas (ej. viene de un pedido) pero
    // nunca se guardó un Ancho, hay que precargarlo igual que cuando se
    // tipea Medidas a mano — si no, queda vacío hasta que alguien lo retipee.
    if (!specs.ancho && order.measure) {
      const anchoMatch = /^(\d+(?:[.,]\d+)?)/.exec(order.measure.trim());
      if (anchoMatch) specs.ancho = anchoMatch[1];
    }
    setSpecsDraft(specs);
    // Las filas de materia prima son fijas (las mismas 10 refs impresas en
    // el papel, en su mismo orden) — no una lista donde se van agregando;
    // se guardan solo las que tengan % o kg cargado (ver handleSaveSpecs).
    if (order.station === null) return;
    const savedRows = (specs.materiaPrima as any[]) ?? [];
    const refs = OP_TEMPLATES[order.station as OpStation].materiaPrimaRefs ?? [];
    setMateriaPrima(
      refs.map((ref) => {
        const saved = savedRows.find((r) => r.ref === ref);
        return {
          ref,
          pct: saved ? String(saved.pct ?? "") : "",
          lote: saved ? String(saved.lote ?? "") : "",
        };
      })
    );
    setColores({
      cara1: ((specs.coloresCara1 as any[]) ?? []).map((c) => ({ unidad: String(c.unidad ?? ""), color: String(c.color ?? ""), lote: String(c.lote ?? "") })),
      cara2: ((specs.coloresCara2 as any[]) ?? []).map((c) => ({ unidad: String(c.unidad ?? ""), color: String(c.color ?? ""), lote: String(c.lote ?? "") })),
    });
    setHeaderDraft({
      quantityPlanned: String(Number(order.quantityPlanned)),
      measure: order.measure ?? "",
      notes: order.notes ?? "",
      alertThresholdKg: order.alertThresholdKg != null ? String(Number(order.alertThresholdKg)) : "",
    });
    setDirty(false);
  }, [order]);

  if (!Number.isInteger(orderId)) return <p className="text-red-600 dark:text-red-400">OP inválida.</p>;
  if (isLoading || !order) return <p className="text-slate-500 dark:text-slate-400 text-sm">Cargando...</p>;

  const canGestion = !!user && (PRODUCCION_GESTION as UserRole[]).includes(user.role);

  // La OP se crea "en blanco", sin proceso asignado — recién se convierte en
  // una OP de Extrusión (el proceso base) cuando Gestión la deriva
  // explícitamente. Hasta entonces no hay plantilla que mostrar (no existe
  // un OP_TEMPLATES[null]), así que esta es toda la pantalla.
  if (order.station === null) {
    return (
      <div className="max-w-lg mx-auto bg-white dark:bg-slate-900 rounded-lg shadow p-6 space-y-4 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{order.orderNumber}</p>
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
          {order.product.name}
          {order.client?.name ? ` · ${order.client.name}` : ""}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Esta OP todavía no tiene un proceso asignado. El primer paso siempre es Extrusión.
        </p>
        {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}
        {canGestion ? (
          <button onClick={() => handleDerive("extrusion")} className="inline-flex items-center gap-2 bg-slate-800 text-white text-sm px-4 py-2 rounded">
            <Send size={14} /> Derivar a Extrusión
          </button>
        ) : (
          <p className="text-sm text-amber-600 dark:text-amber-400">Solo Gestión/Planeación puede asignar el proceso.</p>
        )}
      </div>
    );
  }

  const station = order.station as OpStation;
  const template = OP_TEMPLATES[station];
  const isDraft = order.status === "borrador";
  const isOpen = OPEN_STATUSES.includes(order.status);
  const isReopenable = REOPENABLE_STATUSES.includes(order.status);
  const canOperate = !!user && STATION_OPERATE[station].includes(user.role);
  // En "borrador" también se edita specs — es justo cuando Gestión carga
  // materia prima/medidas/cliente/referencia antes de liberarla a planta.
  const canEditSpecs = canGestion && (isDraft || isOpen);

  const totalKg = order.rolls.reduce((acc: number, r: any) => acc + Number(r.weightKg), 0);
  const totalWaste = order.rolls.reduce((acc: number, r: any) => acc + Number(r.wasteKg), 0);
  // La meta se completa con PESO + DESPERDICIO, no solo peso producido (así
  // lo pidió el cliente) — una vez alcanzada, se oculta la fila de carga
  // (el server además la rechaza si alguien la manda igual, ver
  // POST /:id/rolls).
  const plannedKg = Number(order.quantityPlanned);
  const producedPlusWaste = totalKg + totalWaste;
  const remainingKg = plannedKg > 0 ? Math.max(0, Math.round((plannedKg - producedPlusWaste) * 100) / 100) : 0;
  const isQuantityComplete = plannedKg > 0 && producedPlusWaste >= plannedKg;
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
        // El % es lo que se tipea; el Kg se calcula solo como su parte de
        // la cantidad planificada de la OP — al revés de como era antes,
        // a pedido del cliente.
        const totalPlanned = Number(headerDraft.quantityPlanned) || 0;
        specs.materiaPrima = materiaPrima
          .filter((r) => r.pct)
          .map((r) => ({
            ref: r.ref,
            pct: r.pct ? Number(r.pct) : undefined,
            kg: r.pct && totalPlanned > 0 ? Math.round(((Number(r.pct) / 100) * totalPlanned) * 100) / 100 : undefined,
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
        alertThresholdKg: headerDraft.alertThresholdKg ? Number(headerDraft.alertThresholdKg) : null,
      });
      queryClient.invalidateQueries({ queryKey: ["productionOrder", orderId] });
      queryClient.invalidateQueries({ queryKey: ["productionOrders"] });
      setMessage("Cambios guardados.");
    } catch {
      setError("No se pudieron guardar los cambios");
    }
  }

  // "Material para" es el único campo del encabezado que también puede
  // tocar el operario (a qué estación va a derivar) — se guarda solo al
  // cambiarlo, ya que el operario no tiene acceso al botón general
  // "Guardar cambios" (eso sigue siendo exclusivo de Gestión).
  async function handleMaterialParaChange(value: string) {
    setSpecsDraft((prev) => ({ ...prev, materialPara: value }));
    setError(null);
    try {
      await api.updateMaterialPara(orderId, value || null);
      queryClient.invalidateQueries({ queryKey: ["productionOrder", orderId] });
      queryClient.invalidateQueries({ queryKey: ["productionOrders"] });
    } catch {
      setError('No se pudo guardar "Material para"');
    }
  }

  async function handleAddRoll(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!rollDraft.weight) {
      setError("Completá el peso del rollo");
      return;
    }
    // En Sellado/Precorte, ETIQUETA/PESO son el rollo de origen escaneado
    // (ver handleScannedSource) — sin un escaneo vigente no hay forma de que
    // esos valores sean confiables (podrían ser un resto de un escaneo que
    // se quitó con "Quitar" sin volver a escanear), así que se bloquea acá
    // además de en la UI.
    if (!template.labelIsOwnRoll && !template.originRollFields && !sourceRoll) {
      setError("Escaneá el rollo de origen antes de registrar la fila");
      return;
    }
    // E. BULTO es una etiqueta física pre-impresa (ver EtiquetasBulto.tsx),
    // no un dato que se tipee — sin escanearla no hay código válido que
    // mandar (el server la marca "usada" recién al crear este rollo).
    const needsBultoLabel = template.rollColumns.some((c) => c.scanBultoLabel);
    if (needsBultoLabel && !bultoLabel) {
      setError("Escaneá la etiqueta de bulto antes de registrar la fila");
      return;
    }
    const details: Record<string, string> = {};
    for (const col of template.rollColumns) {
      if (col.source === "detail" && !col.scanBultoLabel && rollDraft[`detail:${col.detailKey}`]) {
        details[col.detailKey!] = rollDraft[`detail:${col.detailKey}`];
      }
    }
    try {
      await api.createProductionRoll(orderId, {
        // FECHA/HORA/TURNO ya no se tipean — se omiten acá para que el
        // server los deje en el momento real de guardado (igual que
        // `date DateTime @default(now())`), más confiable que lo que el
        // operario recuerde escribir o el reloj de su navegador.
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
        bultoLabelCode: bultoLabel?.code,
      });
      setRollDraft({});
      setSourceRoll(null);
      setBultoLabel(null);
      queryClient.invalidateQueries({ queryKey: ["productionOrder", orderId] });
      queryClient.invalidateQueries({ queryKey: ["productionOrders"] });
      // La etiqueta con QR queda disponible con el botón de impresora en la
      // fila del rollo — ya NO se imprime sola acá. Abrir una pestaña nueva
      // y disparar window.print() automáticamente en cada rollo cargado le
      // robaba el foco a la pestaña principal (sobre todo en la PWA
      // instalada en tablets de planta), dejando los inputs sin responder
      // hasta recargar la página.
    } catch (err: any) {
      if (err?.message?.includes("403")) {
        setError("Tu rol no puede registrar rollos en esta estación");
      } else {
        // El server manda mensajes específicos (ej. "quedan X kg
        // disponibles") que vale la pena mostrar tal cual en vez del
        // genérico — viene como un string JSON-stringificado.
        let serverMessage: string | null = null;
        try {
          serverMessage = JSON.parse(err?.message ?? "");
        } catch {
          serverMessage = null;
        }
        setError(typeof serverMessage === "string" ? serverMessage : "No se pudo registrar el rollo");
      }
    }
  }

  async function handlePrintLabel(rollId: number) {
    setError(null);
    try {
      const label = await api.getProductionRollLabel(orderId, rollId);
      printRollLabel(label);
    } catch {
      setError("No se pudo generar la etiqueta");
    }
  }

  /** "Quitar" en el chip del rollo de origen: además de soltar `sourceRoll`,
   * hay que borrar lo que handleScannedSource haya precargado en el
   * borrador — si no, queda un ETIQUETA/PESO viejo sentado en rollDraft que
   * ya no corresponde a ningún escaneo vigente pero igual se mandaría al
   * guardar la fila (el campo se ve bloqueado, así que el operario no tiene
   * forma de notar ni corregir ese resto). */
  function handleClearSourceRoll() {
    setSourceRoll(null);
    setRollDraft((d) => {
      const next = { ...d };
      if (template.originRollFields) {
        delete next[`detail:${template.originRollFields.labelDetailKey}`];
        delete next[`detail:${template.originRollFields.weightDetailKey}`];
      } else if (!template.labelIsOwnRoll) {
        delete next.label;
        delete next.weight;
      }
      for (const col of template.rollColumns) {
        if (col.source === "detail" && col.kind === "siNo") {
          delete next[`detail:${col.detailKey}`];
        }
      }
      return next;
    });
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
          } else if (!template.labelIsOwnRoll) {
            // Sellado/Precorte no tienen columnas de detalle propias para el
            // rollo de origen (a diferencia de Impresión) — ahí la columna
            // base ETIQUETA/PESO directamente ES el rollo escaneado, no un
            // rollo nuevo de esta estación.
            next.label = roll.label ?? roll.code;
            next.weight = String(Number(roll.weightKg));
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

  function handleScannedBultoLabel(code: string) {
    setScanningBultoLabel(false);
    setError(null);
    api
      .getBultoLabelByCode(code)
      .then((label) => {
        if (label.status !== "disponible") {
          setError(`La etiqueta ${label.code} ya fue usada`);
          return;
        }
        setBultoLabel(label);
      })
      .catch(() => setError('No se encontró ninguna etiqueta con ese código. ¿Es un QR de etiqueta de bulto válido?'));
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
      // Caso especial: si esta OP no tenía proceso asignado, "derivar" la
      // actualiza en el lugar (mismo id) en vez de crear una hija — hay que
      // invalidar su propia query para que la pantalla deje de mostrar el
      // estado "sin proceso" y muestre ya la plantilla de Extrusión.
      queryClient.invalidateQueries({ queryKey: ["productionOrder", orderId] });
      if (derived.id !== orderId) navigate(`/produccion/ordenes/${derived.id}`);
    } catch {
      setError("No se pudo derivar la OP");
    }
  }

  async function handleClose() {
    setError(null);
    const isFinal = FINAL_STATIONS.includes(station);
    const confirmMsg = isFinal
      ? "Pasará a revisión de Calidad y, si se aprueba, sus kilos entran al inventario."
      : "Quedará terminada (su material sigue en las OPs derivadas).";
    if (!(await confirm(confirmMsg, { title: "¿Cerrar la OP?", confirmLabel: "Cerrar OP" }))) return;
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
    const shouldReopen = await confirm(
      "Si tenía calidad aprobada, se revierte la entrada al inventario; si es de Extrusión, se devuelve la materia prima descontada. Vas a tener que volver a cerrarla (y pasarla por Calidad si corresponde) después de corregirla.",
      { title: "¿Reabrir la OP para corregir un error?", confirmLabel: "Reabrir", tone: "danger" }
    );
    if (!shouldReopen) return;
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
    const shouldRelease = await confirm(`A partir de ahora la va a ver la cola de ${STATION_LABELS[station]} y va a poder cargar rollos.`, {
      title: "¿Liberar esta OP a planta?",
      confirmLabel: "Liberar",
    });
    if (!shouldRelease) return;
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

  // Una OP solo puede derivar una vez a cada estación destino (ver guard en
  // el backend) — se ocultan los botones de las que ya tienen una hija para
  // no ofrecer una acción que el server va a rechazar con 400.
  const derivedStations = new Set((order.derivedOrders ?? []).map((d: any) => d.station));
  const derivations = DERIVATIONS[station].filter((s) => !derivedStations.has(s));

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
          {/* Derivar es exclusivo de Gestión/Planeación — ningún operario
              puede mandar la OP al siguiente proceso, esa decisión la
              pidió el cliente que quede siempre centralizada. */}
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
            <img src="/logo-full.png" alt="Plásticos Superior San Judas S.A.S." className="h-8 w-auto" />
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
                const value = e.target.value;
                setHeaderDraft((h) => ({ ...h, measure: value }));
                // El dueño pidió que si acá ponen "12x18", el primer número
                // (el ancho) se cargue solo en la casilla ANCHO de más
                // abajo — no hace falta tipearlo dos veces. Sigue siendo
                // editable a mano después, esto solo la precarga.
                const anchoMatch = /^(\d+(?:[.,]\d+)?)/.exec(value.trim());
                if (anchoMatch) {
                  setSpecsDraft((prev) => ({ ...prev, ancho: anchoMatch[1] }));
                }
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
          <div className={`${cellBorder} p-2`}>
            <span className={cellLabel} title="A cuántos kg (peso + desperdicio) avisar que la OP está por completarse. Vacío = default (90% de lo planificado).">
              Alertar a los (kg)
            </span>
            <input
              className={sheetInput}
              type="number"
              step="0.01"
              placeholder={plannedKg > 0 ? `def. ${Math.round(plannedKg * 0.9 * 100) / 100}` : "90% por defecto"}
              value={headerDraft.alertThresholdKg}
              disabled={!canEditSpecs}
              onChange={(e) => {
                setHeaderDraft((h) => ({ ...h, alertThresholdKg: e.target.value }));
                markDirty();
              }}
            />
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
                  const totalPlanned = Number(headerDraft.quantityPlanned) || 0;
                  return materiaPrima.map((row, i) => {
                    const pct = Number(row.pct) || 0;
                    const kg = totalPlanned > 0 ? Math.round(((pct / 100) * totalPlanned) * 100) / 100 : 0;
                    return (
                      <tr key={row.ref}>
                        <td className={`${cellBorder} px-2 py-1 font-medium`}>{row.ref}</td>
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
                        <td className={`${cellBorder} px-2 py-1 text-slate-500 dark:text-slate-400`}>{pct > 0 ? kg : "—"}</td>
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
                    {Math.round(materiaPrima.reduce((acc, r) => acc + (Number(r.pct) || 0), 0) * 100) / 100}%
                  </td>
                  <td className={`${cellBorder} px-2 py-1`}>
                    {(() => {
                      const totalPlanned = Number(headerDraft.quantityPlanned) || 0;
                      const totalPct = materiaPrima.reduce((acc, r) => acc + (Number(r.pct) || 0), 0);
                      return totalPlanned > 0 ? Math.round(((totalPct / 100) * totalPlanned) * 100) / 100 : 0;
                    })()}
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
              {section.fields.map((field) => {
                // "Material para" (a qué estación va a derivar) es el único
                // campo del encabezado que también edita el operario, no
                // solo Gestión — y se guarda solo al cambiarlo (ver
                // handleMaterialParaChange), no con el botón general.
                const isMaterialPara = field.key === "materialPara";
                const canEditThis = isMaterialPara ? canEditSpecs || canOperate : canEditSpecs;
                return (
                  <div key={field.key} className={`${cellBorder} p-2`}>
                    <span className={cellLabel}>{field.label}</span>
                    {field.kind === "options" ? (
                      <select
                        className={sheetInput}
                        value={specsDraft[field.key] ?? ""}
                        disabled={!canEditThis}
                        onChange={(e) => (isMaterialPara ? handleMaterialParaChange(e.target.value) : setSpec(field.key, e.target.value))}
                      >
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
                        disabled={!canEditThis}
                        onChange={(e) => setSpec(field.key, e.target.value)}
                      />
                    )}
                  </div>
                );
              })}
              {/* Mismo cuadro de "a dónde deriva" pero como acción directa,
                  al lado de "Material para" — exclusivo de Gestión, igual
                  que los botones "Derivar a..." de arriba (ver comentario). */}
              {section.fields.some((f) => f.key === "materialPara") && canGestion && derivations.length > 0 && (
                <div className={`${cellBorder} p-2`}>
                  <span className={cellLabel}>Derivar a</span>
                  <select
                    className={sheetInput}
                    value=""
                    onChange={(e) => {
                      const target = e.target.value as OpStation;
                      if (target) handleDerive(target);
                    }}
                  >
                    <option value="">—</option>
                    {derivations.map((target) => (
                      <option key={target} value={target}>
                        {STATION_LABELS[target]}
                      </option>
                    ))}
                  </select>
                </div>
              )}
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
                <button type="button" onClick={handleClearSourceRoll} title="Quitar" className="text-emerald-700 dark:text-emerald-400">
                  <X size={13} aria-hidden="true" />
                </button>
              </div>
            )}
            <span className="text-[10px] text-slate-500 dark:text-slate-400">Escaneá el QR pegado al rollo que estás tomando como insumo</span>
          </div>
        )}

        {canOperate && isOpen && template.rollColumns.some((c) => c.scanBultoLabel) && (
          <div className="px-3 py-2 border-b border-slate-300 dark:border-slate-600 flex flex-wrap items-center gap-2">
            {!bultoLabel ? (
              <button
                type="button"
                onClick={() => setScanningBultoLabel(true)}
                className="inline-flex items-center gap-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded px-3 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <ScanLine size={13} aria-hidden="true" /> Escanear etiqueta de bulto
              </button>
            ) : (
              <div className="inline-flex items-center gap-2 text-xs bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 rounded px-3 py-1.5">
                <span>
                  Etiqueta de bulto: <strong>{bultoLabel.code}</strong>
                </span>
                <button type="button" onClick={() => setBultoLabel(null)} title="Quitar" className="text-emerald-700 dark:text-emerald-400">
                  <X size={13} aria-hidden="true" />
                </button>
              </div>
            )}
            <span className="text-[10px] text-slate-500 dark:text-slate-400">Escaneá la etiqueta física que te repartió Gestión para este bulto</span>
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
              {canOperate && <th className={`${cellBorder} px-1.5 py-1 w-14`} />}
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
                  {canOperate && (
                    <td className={`${cellBorder} px-1.5 py-1 text-center whitespace-nowrap`}>
                      <button type="button" className="text-slate-500 dark:text-slate-400" title="Imprimir etiqueta" onClick={() => handlePrintLabel(roll.id)}>
                        <Printer size={13} aria-hidden="true" />
                      </button>
                      {canGestion && isOpen && (
                        <button type="button" className="text-red-600 dark:text-red-400 ml-1.5" title="Borrar rollo" onClick={() => handleDeleteRoll(roll.id)}>
                          <Trash2 size={13} aria-hidden="true" />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
                {roll.sourceRoll && (
                  <tr className="bg-slate-50 dark:bg-slate-800/60">
                    <td
                      colSpan={template.rollColumns.length + (canOperate ? 1 : 0)}
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
            {canOperate && isOpen && !isQuantityComplete && (
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
                  // TURNO: solo hay Día/Noche en planta, se calcula solo de
                  // la hora real de Colombia al guardar (mismo criterio que
                  // FECHA/HORA) — acá se muestra una vista previa (hora de
                  // Colombia, no la del huso del navegador/celular), el
                  // valor que realmente queda es el que calcula el servidor
                  // al momento de guardar la fila.
                  if (col.source === "shift") {
                    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Bogota", hour: "numeric", hour12: false }).format(new Date())) % 24;
                    const shiftPreview = hour >= 6 && hour < 18 ? "Día" : "Noche";
                    return (
                      <td
                        key={col.detailKey ?? col.source}
                        className={`${cellBorder} px-1.5 py-1 text-slate-500 dark:text-slate-400 text-center italic`}
                        title="Se completa solo según la hora (6:00–17:59 Día, resto Noche)"
                      >
                        {shiftPreview}
                      </td>
                    );
                  }
                  // ETIQUETA/PESO son el rollo de ORIGEN en Sellado/Precorte
                  // (a diferencia de Extrusión/Impresión, donde arriba ya se
                  // resuelve como "rollo propio"). El jefe pidió que acá no
                  // se pueda tipear a mano: se bloquean hasta escanear el QR
                  // del rollo de origen, que es lo que los rellena — recién
                  // ahí quedan editables por si hace falta corregir algo.
                  if ((col.source === "label" || col.source === "weight") && !template.labelIsOwnRoll && !sourceRoll) {
                    return (
                      <td
                        key={col.detailKey ?? col.source}
                        className={`${cellBorder} px-1.5 py-1 text-slate-400 dark:text-slate-500 text-center italic`}
                        title="Se completa al escanear el QR del rollo de origen"
                      >
                        escaneá el QR
                      </td>
                    );
                  }
                  // E. BULTO: etiqueta física pre-impresa (ver EtiquetasBulto.tsx)
                  // — se completa sola al escanearla y queda de solo lectura
                  // (no editable como el resto: el código ya quedó consumido
                  // del lado del servidor, "corregirlo" a mano lo desconectaría
                  // de la etiqueta física real).
                  if (col.scanBultoLabel) {
                    return (
                      <td
                        key={col.detailKey ?? col.source}
                        className={`${cellBorder} px-1.5 py-1 text-center ${bultoLabel ? "text-slate-800 dark:text-slate-100 font-medium" : "text-slate-400 dark:text-slate-500 italic"}`}
                        title={bultoLabel ? undefined : "Se completa al escanear el QR de la etiqueta de bulto"}
                      >
                        {bultoLabel ? bultoLabel.code : "escaneá el QR"}
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
            {canOperate && isOpen && isQuantityComplete && (
              <tr>
                <td
                  className={`${cellBorder} px-2 py-2 text-center text-emerald-700 dark:text-emerald-400 text-xs font-medium`}
                  colSpan={template.rollColumns.length + 1}
                >
                  Ya se completaron los {plannedKg} kg planificados (peso + desperdicio) — no se pueden cargar más rollos.
                </td>
              </tr>
            )}
            {/* Totales */}
            <tr className="font-semibold bg-slate-100 dark:bg-slate-800">
              <td className={`${cellBorder} px-1.5 py-1`} colSpan={Math.max(1, template.rollColumns.length - 2)}>
                Total · {order.rolls.length} rollos · {Math.round(totalKg * 100) / 100} kg producidos
              </td>
              <td className={`${cellBorder} px-1.5 py-1`}>
                {plannedKg > 0 ? (
                  <span className={isQuantityComplete ? "text-emerald-600 dark:text-emerald-400" : ""}>
                    {isQuantityComplete ? "Completado" : `Restan ${remainingKg} kg`}
                  </span>
                ) : (
                  `${Math.round(totalKg * 100) / 100} kg`
                )}
              </td>
              <td className={`${cellBorder} px-1.5 py-1`} colSpan={canOperate ? 2 : 1}>
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
      {scanningBultoLabel && (
        <BarcodeScanner title="Escanear etiqueta de bulto" onDetected={handleScannedBultoLabel} onClose={() => setScanningBultoLabel(false)} />
      )}
    </div>
  );
}
