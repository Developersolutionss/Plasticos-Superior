import PDFDocument from "pdfkit";
import { COMPANY } from "./pdfDocument";
import { OP_TEMPLATES, OpStation, OpRollColumn } from "./opTemplates";

const BRAND = "#1e293b";
const MUTED = "#64748b";
const BORDER = "#94a3b8";
const HEADER_BG = "#e2e8f0";

const M = 40; // margen
const W = 515; // ancho útil A4 con margen 40

interface RollLike {
  date: Date | string;
  shift: string | null;
  operatorName: string;
  machine: string | null;
  label: string | null;
  weightKg: unknown;
  wasteKg: unknown;
  details: unknown;
}

export interface OpPdfData {
  orderNumber: string;
  station: OpStation;
  status: string;
  createdAt: Date;
  quantityPlanned: number;
  measure: string | null;
  notes: string | null;
  specs: Record<string, unknown> | null;
  clientName: string | null;
  productName: string;
  productSku: string;
  parentOrderNumber: string | null;
  derivedOrderNumbers: string[];
  rolls: RollLike[];
  attachmentNames: string[];
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

function fmtDate(d: Date | string) {
  return new Date(d).toLocaleDateString("es-CO");
}

/**
 * Trunca `text` a lo que entre en `maxWidth` con el font/tamaño ya seteado
 * en `doc`, agregando "…". pdfkit's `{ ellipsis: true, lineBreak: false }`
 * no siempre respeta el ancho en celdas angostas (texto largo terminaba
 * envolviendo a dos líneas y pisando la fila de abajo) — medir con
 * `widthOfString` y cortar a mano es lo único confiable acá.
 */
function fitText(doc: PDFKit.PDFDocument, text: string, maxWidth: number): string {
  if (doc.widthOfString(text) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (doc.widthOfString(text.slice(0, mid) + "…") <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + "…";
}

function fmtTime(d: Date | string) {
  // 24h y sin espacios ("14:30", no "2:30 p. m.") — la versión de 12h con
  // "a. m."/"p. m." es lo bastante larga como para partirse en dos líneas
  // en la columna angosta de HORA del formato de Extrusión.
  return new Date(d).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** `cumulative` es la suma de kg hasta esta fila inclusive (columna TOTAL
 * del papel de Extrusión) — la calcula el caller recorriendo las filas en
 * orden, ver el `reduce` en buildOpPdf. */
function rollCellValue(roll: RollLike, col: OpRollColumn, cumulative?: number): string {
  switch (col.source) {
    case "date":
      return fmtDate(roll.date);
    case "time":
      return fmtTime(roll.date);
    case "shift":
      return str(roll.shift);
    case "operator":
      return str(roll.operatorName);
    case "machine":
      return str(roll.machine);
    case "label":
      return str(roll.label);
    case "weight":
      return String(num(roll.weightKg));
    case "waste":
      return String(num(roll.wasteKg));
    case "cumulativeWeight":
      return String(Math.round((cumulative ?? 0) * 100) / 100);
    case "detail": {
      const details = (roll.details ?? {}) as Record<string, unknown>;
      return str(details[col.detailKey!]);
    }
  }
}

/**
 * Reporte consolidado de una OP con el layout del formato en papel del
 * cliente (media/FORMATO *.xlsx): banda de título con COD, encabezado en
 * grilla, materia prima con kg calculados, secciones de specs, tabla de
 * rollos y resumen de cierre (totales, operarios por turno, adjuntos).
 */
export function buildOpPdf(data: OpPdfData): PDFKit.PDFDocument {
  const doc = new PDFDocument({ size: "A4", margin: M });
  const template = OP_TEMPLATES[data.station];
  const specs = data.specs ?? {};
  const PAGE_BOTTOM = doc.page.height - M;
  let y = M;

  function ensureSpace(height: number) {
    if (y + height > PAGE_BOTTOM) {
      doc.addPage();
      y = M;
    }
  }

  function sectionBand(title: string) {
    ensureSpace(40);
    doc.rect(M, y, W, 16).fillAndStroke(HEADER_BG, BORDER);
    doc.fillColor(BRAND).fontSize(8).font("Helvetica-Bold").text(title, M + 6, y + 4);
    doc.font("Helvetica");
    y += 16;
  }

  /** Grilla de "Label: valor" en 3 columnas, con bordes tipo planilla. */
  function fieldGrid(pairs: { label: string; value: string }[]) {
    const cols = 3;
    const cellW = W / cols;
    const cellH = 18;
    for (let i = 0; i < pairs.length; i += cols) {
      ensureSpace(cellH);
      const row = pairs.slice(i, i + cols);
      row.forEach((pair, j) => {
        const x = M + j * cellW;
        const innerW = cellW - 8;
        doc.rect(x, y, cellW, cellH).stroke(BORDER);
        doc.fillColor(MUTED).fontSize(7);
        doc.text(fitText(doc, pair.label.toUpperCase(), innerW), x + 4, y + 3, { lineBreak: false });
        doc.fillColor(BRAND).fontSize(9);
        doc.text(fitText(doc, pair.value, innerW), x + 4, y + 9, { lineBreak: false });
      });
      // Completa la fila con celdas vacías para que la grilla quede pareja.
      for (let j = row.length; j < cols; j++) {
        doc.rect(M + j * cellW, y, cellW, cellH).stroke(BORDER);
      }
      y += cellH;
    }
  }

  function table(headers: string[], widths: number[], rows: string[][], opts?: { boldRow?: number }) {
    const headH = 16;
    const drawHead = () => {
      ensureSpace(headH + 14);
      doc.rect(M, y, W, headH).fillAndStroke(BRAND, BRAND);
      let x = M;
      doc.fillColor("#ffffff").fontSize(6.5).font("Helvetica-Bold");
      headers.forEach((h, i) => {
        doc.text(fitText(doc, h, widths[i] - 6), x + 3, y + 5, { lineBreak: false });
        x += widths[i];
      });
      doc.font("Helvetica");
      y += headH;
    };
    drawHead();
    rows.forEach((row, rowIdx) => {
      const rowH = 14;
      if (y + rowH > PAGE_BOTTOM) {
        doc.addPage();
        y = M;
        drawHead();
      }
      let x = M;
      const bold = opts?.boldRow === rowIdx;
      doc.fillColor(BRAND).fontSize(7.5).font(bold ? "Helvetica-Bold" : "Helvetica");
      row.forEach((cell, i) => {
        doc.rect(x, y, widths[i], rowH).stroke(BORDER);
        doc.text(fitText(doc, cell, widths[i] - 6), x + 3, y + 4, { lineBreak: false });
        x += widths[i];
      });
      doc.font("Helvetica");
      y += rowH;
    });
  }

  // ---- Banda de título (como la cabecera del Excel) ----
  const bandH = 42;
  doc.rect(M, y, W, bandH).stroke(BORDER);
  doc.rect(M, y, 130, bandH).stroke(BORDER);
  doc.rect(M + W - 110, y, 110, bandH).stroke(BORDER);
  doc.fillColor(BRAND).fontSize(9).font("Helvetica-Bold").text(COMPANY, M + 6, y + 10, { width: 118 });
  doc
    .fontSize(12)
    .text(template.title, M + 130, y + 15, { width: W - 240, align: "center" });
  doc.fontSize(7.5).font("Helvetica");
  doc.fillColor(MUTED);
  doc.text(template.cod, M + W - 104, y + 6);
  doc.text(`FECHA ${fmtDate(data.createdAt)}`, M + W - 104, y + 17);
  doc.text(`ESTADO ${data.status.replace(/_/g, " ").toUpperCase()}`, M + W - 104, y + 28);
  y += bandH + 6;

  // ---- Encabezado principal ----
  const headerPairs = [
    { label: "Nro O.Prod", value: data.orderNumber },
    { label: "Cliente", value: str(data.clientName) },
    { label: "Referencia", value: `${data.productName} (${data.productSku})` },
    { label: "Medidas", value: str(data.measure) },
    { label: "Cantidad", value: `${data.quantityPlanned} KILOS` },
    { label: "Máquina", value: str((specs as Record<string, unknown>).maquina) },
  ];
  if (data.parentOrderNumber) headerPairs.push({ label: "Derivada de", value: data.parentOrderNumber });
  if (data.derivedOrderNumbers.length) headerPairs.push({ label: "Deriva en", value: data.derivedOrderNumbers.join(", ") });
  fieldGrid(headerPairs);
  y += 6;

  // ---- Materia prima (solo Extrusión) ----
  if (template.materiaPrimaRefs) {
    sectionBand("MATERIA PRIMA");
    const rows = ((specs.materiaPrima as { ref?: string; pct?: unknown; kg?: unknown; lote?: string }[] | undefined) ?? [])
      .filter((r) => r.ref && (num(r.pct) > 0 || num(r.kg) > 0));
    const totalPct = rows.reduce((acc, r) => acc + num(r.pct), 0);
    // El Kg lo tipea/pisa el operario a mano — si no lo cargó (specs
    // viejas de antes de esto), se cae al cálculo % × cantidad.
    const kgOf = (r: { pct?: unknown; kg?: unknown }) => (r.kg != null && r.kg !== "" ? num(r.kg) : (num(r.pct) / 100) * data.quantityPlanned);
    const totalKg = rows.reduce((acc, r) => acc + kgOf(r), 0);
    const body = rows.map((r) => [str(r.ref), `${num(r.pct)}%`, String(Math.round(kgOf(r) * 100) / 100), str(r.lote)]);
    body.push(["Total", `${Math.round(totalPct * 100) / 100}%`, String(Math.round(totalKg * 100) / 100), ""]);
    table(["REF.", "%", "KG", "LOTE"], [200, 90, 105, 120], body, { boldRow: body.length - 1 });
    y += 6;
  }

  // ---- Secciones de specs de la estación ----
  for (const section of template.sections) {
    const pairs = section.fields.map((f) => ({ label: f.label, value: str(specs[f.key]) }));
    if (pairs.every((p) => p.value === "—")) continue;
    sectionBand(section.title);
    fieldGrid(pairs);
    y += 6;
  }

  // ---- Colores cara 1 / cara 2 (solo Impresión) ----
  if (template.colores) {
    for (const cara of [1, 2] as const) {
      const rows = ((specs[`coloresCara${cara}`] as { unidad?: unknown; color?: string; lote?: string }[] | undefined) ?? [])
        .filter((c) => c.color);
      if (!rows.length) continue;
      sectionBand(`COLORES CARA ${cara}`);
      table(
        ["UNIDAD", "COLOR", "LOTE"],
        [100, 250, 165],
        rows.map((c) => [str(c.unidad), str(c.color), str(c.lote)])
      );
      y += 6;
    }
  }

  // ---- Registro de rollos ----
  sectionBand("REGISTRO DE ROLLOS / AVANCE");
  const cols = template.rollColumns;
  const weightOf = (c: OpRollColumn) => (c.source === "date" ? 1.3 : c.source === "operator" ? 1.5 : c.kind === "siNo" ? 1.2 : 1);
  const totalWeight = cols.reduce((acc, c) => acc + weightOf(c), 0);
  const widths = cols.map((c) => Math.floor((weightOf(c) / totalWeight) * W));
  widths[widths.length - 1] += W - widths.reduce((a, b) => a + b, 0);

  if (data.rolls.length === 0) {
    ensureSpace(20);
    doc.fillColor(MUTED).fontSize(8).text("Sin rollos registrados todavía.", M, y + 4);
    y += 20;
  } else {
    let cumulative = 0;
    table(
      cols.map((c) => c.label),
      widths,
      data.rolls.map((roll) => {
        cumulative += num(roll.weightKg);
        return cols.map((c) => rollCellValue(roll, c, cumulative));
      })
    );
  }
  y += 8;

  // ---- Consolidado de cierre ----
  const totalKg = data.rolls.reduce((acc, r) => acc + num(r.weightKg), 0);
  const totalWaste = data.rolls.reduce((acc, r) => acc + num(r.wasteKg), 0);
  sectionBand("CONSOLIDADO");
  fieldGrid([
    { label: "Rollos registrados", value: String(data.rolls.length) },
    { label: "Kilos totales", value: `${Math.round(totalKg * 100) / 100} kg` },
    { label: "Desperdicio total", value: `${Math.round(totalWaste * 100) / 100} kg` },
  ]);
  y += 6;

  // Operarios por turno
  const turnos = new Map<string, { rolls: number; kg: number }>();
  for (const roll of data.rolls) {
    const key = `${roll.shift?.trim() || "Sin turno"} · ${roll.operatorName}`;
    const agg = turnos.get(key) ?? { rolls: 0, kg: 0 };
    agg.rolls += 1;
    agg.kg += num(roll.weightKg);
    turnos.set(key, agg);
  }
  if (turnos.size) {
    sectionBand("OPERARIOS POR TURNO");
    table(
      ["TURNO · OPERARIO", "ROLLOS", "KG"],
      [315, 90, 110],
      [...turnos.entries()].map(([key, agg]) => [key, String(agg.rolls), String(Math.round(agg.kg * 100) / 100)])
    );
    y += 6;
  }

  if (data.attachmentNames.length) {
    sectionBand("ADJUNTOS");
    ensureSpace(data.attachmentNames.length * 12 + 6);
    doc.fillColor(BRAND).fontSize(8);
    for (const name of data.attachmentNames) {
      doc.text(`• ${name}`, M + 4, y + 2);
      y += 12;
    }
    y += 6;
  }

  const obs = str(specs.observaciones);
  if (obs !== "—" || data.notes) {
    sectionBand("OBSERVACIONES");
    const text = [obs !== "—" ? obs : null, data.notes].filter(Boolean).join("\n");
    const h = doc.heightOfString(text, { width: W - 12 }) + 10;
    ensureSpace(h);
    doc.rect(M, y, W, h).stroke(BORDER);
    doc.fillColor(BRAND).fontSize(8).text(text, M + 6, y + 5, { width: W - 12 });
    y += h;
  }

  return doc;
}
