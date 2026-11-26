import { productMeasure } from "./productMeasure";

/**
 * Etiquetas físicas de lo que sale de cada estación. Diseño aprobado por el
 * cliente el 2026-11-26 a partir de sus tiquetes de papel ("MATERIAL
 * TUBULAR" y el tiquete verde de rollo): logo y título, Nº grande con el
 * lote (OP), producto con su referencia, cuadrícula de datos (fecha, color,
 * rollo Nº, peso bruto/neto, calibre, densidad, operario, cliente), QR,
 * "contacto con alimentos y bebidas SI/NO" y la NOTA de devoluciones en
 * franja negra con la dirección y los teléfonos.
 *
 * Tamaño: 100 × 75 mm (el rollo de etiquetas que compraron para la
 * impresora SAT TT460). La misma etiqueta sale en ZPL por la impresora de
 * planta desde el celular (server/src/services/labelZpl.ts).
 *
 * Lo que el sistema no sabe queda como línea o casilla para completar a
 * mano: peso bruto (solo se registra el neto) y contacto con alimentos.
 *
 * El QR lleva el código + el token de posesión: es lo que el operario de la
 * estación siguiente escanea para consumir el rollo o bulto.
 */
export type LabelStation = "extrusion" | "impresion" | "sellado" | "precorte" | "embobinado";

export interface RollLabel {
  station: LabelStation;
  code: string;
  qrDataUrl: string;
  orderNumber: string;
  productName: string;
  /** Medida del producto ("55x70 cm"). */
  reference?: string | null;
  color?: string | null;
  /** Peso neto (en Sellado/Embobinado, el del bulto). */
  weightKg: unknown;
  /** Peso bruto, si se conoce; si no, línea para escribir a mano. */
  grossKg?: unknown;
  /** Fecha de producción (ISO o Date); sin fecha, hoy. */
  date?: string | Date | null;
  /** Nº del rollo/bulto dentro de su OP (1, 2, 3...). */
  rollNumber?: number | null;
  calibre?: string | null;
  densidad?: string | null;
  operator?: string | null;
  /** Cant. paca / paquetes por unidad. */
  cantPaca?: string | number | null;
  clientName?: string | null;
  /** Número del tiquete físico del rollo (inventario inicial), si tiene. */
  ticket?: string | null;
  notes?: string | null;
  /** Material para contacto con alimentos: null = casillas vacías para marcar a mano. */
  foodContact?: boolean | null;
}

export interface LabelFormat {
  widthMm: number;
  heightMm: number;
  /** Título grande del encabezado (como "MATERIAL TUBULAR" del papel). */
  title: string;
  /** Qué es, al lado del producto. */
  subtitle: string;
  /** Rótulos de la cuadrícula que cambian por estación. */
  numberLabel: string;
  grossLabel: string;
  netLabel: string;
  /** Sellado muestra PAQ X UNID en lugar del peso bruto. */
  bulto: boolean;
}

/** Impresora de planta: SAT TT460 UE (203 dpi), cabezal de 108 mm. */
export const PRINTER_MAX_WIDTH_MM = 108;

/**
 * Ajustes de la impresora de ESTE equipo (se guardan en el navegador del PC
 * que tiene la impresora conectada). Se calibran en Configuración → Prueba
 * de etiquetas.
 *
 * - `sizeMode: "unico"` (por defecto): las etiquetas salen al tamaño del
 *   rollo cargado (hoy 100 × 75 mm); si el rollo fuera otro, el diseño se
 *   achica y se centra para que entre.
 * - `sizeMode: "estacion"`: cada etiqueta a su tamaño de diseño, girando las
 *   más anchas que el cabezal (`rotateWide`).
 * - Corrimiento (mm) si la impresora saca el diseño corrido.
 */
export interface PrinterSettings {
  sizeMode: "unico" | "estacion";
  labelWidthMm: number;
  labelHeightMm: number;
  rotateWide: boolean;
  offsetXmm: number;
  offsetYmm: number;
}

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  sizeMode: "unico",
  labelWidthMm: 100,
  labelHeightMm: 75,
  rotateWide: true,
  offsetXmm: 0,
  offsetYmm: 0,
};
const PRINTER_SETTINGS_KEY = "labelPrinterSettings";

export function getPrinterSettings(): PrinterSettings {
  try {
    const raw = localStorage.getItem(PRINTER_SETTINGS_KEY);
    if (!raw) return DEFAULT_PRINTER_SETTINGS;
    const s = JSON.parse(raw) as Partial<PrinterSettings>;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(-20, Math.min(20, v)) : 0);
    const mm = (v: unknown, def: number, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= 20 && v <= max ? v : def);
    return {
      sizeMode: s.sizeMode === "estacion" ? "estacion" : "unico",
      labelWidthMm: mm(s.labelWidthMm, DEFAULT_PRINTER_SETTINGS.labelWidthMm, PRINTER_MAX_WIDTH_MM),
      labelHeightMm: mm(s.labelHeightMm, DEFAULT_PRINTER_SETTINGS.labelHeightMm, 300),
      rotateWide: s.rotateWide !== false,
      offsetXmm: num(s.offsetXmm),
      offsetYmm: num(s.offsetYmm),
    };
  } catch {
    return DEFAULT_PRINTER_SETTINGS;
  }
}

export function savePrinterSettings(settings: PrinterSettings) {
  try {
    localStorage.setItem(PRINTER_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Sin almacenamiento (modo privado): se usa lo de por defecto.
  }
}

const ROLL = { numberLabel: "ROLLO Nº", grossLabel: "PESO BRUTO", netLabel: "PESO NETO", bulto: false };

export const LABEL_FORMATS: Record<LabelStation, LabelFormat> = {
  extrusion: { widthMm: 100, heightMm: 75, title: "MATERIAL TUBULAR", subtitle: "ROLLO DE EXTRUSIÓN", ...ROLL },
  impresion: { widthMm: 100, heightMm: 75, title: "MATERIAL IMPRESO", subtitle: "ROLLO IMPRESO", ...ROLL },
  precorte: { widthMm: 100, heightMm: 75, title: "MATERIAL PRECORTADO", subtitle: "EN ROLLO PRECORTE", ...ROLL },
  embobinado: { widthMm: 100, heightMm: 75, title: "MATERIAL EMBOBINADO", subtitle: "ROLLO EMBOBINADO", ...ROLL },
  sellado: {
    widthMm: 100,
    heightMm: 75,
    title: "BOLSAS SELLADAS",
    subtitle: "BULTO SELLADO",
    numberLabel: "BULTO Nº",
    grossLabel: "PAQ X UNID",
    netLabel: "PESO BULTO",
    bulto: true,
  },
};

/**
 * Hoja que recibe la impresora (ancho = lo que cruza el cabezal) y cómo
 * entra el diseño: girado y/o achicado (`scale`).
 */
export function labelSheet(
  station: LabelStation,
  settings: Partial<PrinterSettings> = DEFAULT_PRINTER_SETTINGS
): { widthMm: number; heightMm: number; rotated: boolean; scale: number } {
  const f = LABEL_FORMATS[station] ?? LABEL_FORMATS.extrusion;
  const mode = settings.sizeMode ?? DEFAULT_PRINTER_SETTINGS.sizeMode;
  if (mode === "unico") {
    const w = settings.labelWidthMm ?? DEFAULT_PRINTER_SETTINGS.labelWidthMm;
    const h = settings.labelHeightMm ?? DEFAULT_PRINTER_SETTINGS.labelHeightMm;
    return { widthMm: w, heightMm: h, rotated: false, scale: Math.min(1, w / f.widthMm, h / f.heightMm) };
  }
  const rotated = (settings.rotateWide ?? true) && f.widthMm > PRINTER_MAX_WIDTH_MM;
  return rotated
    ? { widthMm: f.heightMm, heightMm: f.widthMm, rotated, scale: 1 }
    : { widthMm: f.widthMm, heightMm: f.heightMm, rotated, scale: 1 };
}

/** Pie de la etiqueta (los del tiquete de papel "Material Tubular"). */
export const COMPANY_FOOTER = {
  note: "NOTA: Únicamente se aceptan devoluciones y/o reclamos de rollos con la presentación de este tiquete.",
  address: "Carrera 44 No. 18-106 · Tel 326 2543 - 336 9192 · Cel 318 5732551 · Cali - Colombia",
  tagline: "TUBULARES · BOLSAS · PRECORTADOS",
};

export function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** "55x70 cm" a partir del producto del catálogo (el calibre va en su casilla). */
export function labelReference(p: { measure?: string | null; measureUnit?: string | null } | null | undefined): string {
  if (!p) return "";
  return productMeasure(p);
}

/** dd-mm-aa, como en la etiqueta de papel (09-11-26). */
export function labelDate(value?: string | Date | null): string {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${String(d.getFullYear()).slice(-2)}`;
}

function kg(value: unknown): string {
  if (value == null || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  return `${n.toLocaleString("es-CO", { maximumFractionDigits: 2 })} kg`;
}

/** Observaciones: cant. paca (rollos), tiquete y notas de la fila. */
export function labelObservations(label: RollLabel): string {
  const fmt = LABEL_FORMATS[label.station] ?? LABEL_FORMATS.extrusion;
  return [
    !fmt.bulto && label.cantPaca != null && label.cantPaca !== "" ? `Cant. paca ${label.cantPaca}` : "",
    label.ticket ? `Tiquete ${label.ticket}` : "",
    label.notes?.trim() ?? "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Las casillas de la cuadrícula, en orden (la última, cliente, va a lo ancho). */
export function labelCells(label: RollLabel): { label: string; value: string; wide?: boolean }[] {
  const fmt = LABEL_FORMATS[label.station] ?? LABEL_FORMATS.extrusion;
  const up = (s?: string | null) => (s ?? "").toString().trim().toUpperCase();
  return [
    { label: "FECHA", value: labelDate(label.date) },
    { label: "COLOR", value: up(label.color) },
    { label: fmt.numberLabel, value: label.rollNumber ? String(label.rollNumber) : "" },
    { label: fmt.grossLabel, value: fmt.bulto ? up(label.cantPaca == null ? "" : String(label.cantPaca)) : kg(label.grossKg) },
    { label: "CALIBRE", value: up(label.calibre) },
    { label: fmt.netLabel, value: kg(label.weightKg) },
    { label: "DENSIDAD", value: up(label.densidad) },
    { label: "OPERARIO", value: up(label.operator) },
    { label: "CLIENTE", value: up(label.clientName) || "STOCK (SIN CLIENTE)", wide: true },
  ];
}

function cell(c: { label: string; value: string; wide?: boolean }): string {
  const v = c.value ? `<b>${escapeHtml(c.value)}</b>` : '<span class="blank"></span>';
  return `<div class="c${c.wide ? " wide" : ""}"><small>${escapeHtml(c.label)}:</small>${v}</div>`;
}

function labelHtml(label: RollLabel, logoUrl: string, settings: PrinterSettings): string {
  const fmt = LABEL_FORMATS[label.station] ?? LABEL_FORMATS.extrusion;
  const sheet = labelSheet(label.station, settings);
  // El diseño se arma derecho a su tamaño y se acomoda en la hoja: girado
  // 90° (tamaño por estación) o achicado y centrado (un solo tamaño).
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const cx = sheet.scale < 1 ? r2((sheet.widthMm - fmt.widthMm * sheet.scale) / 2) : 0;
  const cy = sheet.scale < 1 ? r2((sheet.heightMm - fmt.heightMm * sheet.scale) / 2) : 0;
  const dx = r2(settings.offsetXmm + cx);
  const dy = r2(settings.offsetYmm + cy);
  const moves = [
    dx || dy ? `translate(${dx}mm, ${dy}mm)` : "",
    sheet.rotated ? `translateX(${sheet.widthMm}mm) rotate(90deg)` : "",
    sheet.scale < 1 ? `scale(${r2(sheet.scale * 1000) / 1000})` : "",
  ].filter(Boolean);
  const transform = moves.length ? ` style="transform: ${moves.join(" ")}"` : "";
  const station = escapeHtml(label.station);
  const product = [label.productName, label.reference ? `REF ${label.reference}` : ""].filter(Boolean).join(" · ").toUpperCase();
  const obs = labelObservations(label);
  const food = label.foodContact;
  const qr = /^data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+$/.test(label.qrDataUrl) ? label.qrDataUrl : "";
  // 0.3 mm menos de alto que la hoja: por redondeo de mm a px Chrome puede
  // sacar una hoja en blanco entre etiquetas si mide exactamente lo mismo.
  return `<div class="sheet sheet-${station}" style="width:${sheet.widthMm}mm;height:${sheet.heightMm - 0.3}mm">
  <div class="label lbl-${station}"${transform}><div class="box">
    <header>
      <img src="${escapeHtml(logoUrl)}" alt="Plásticos Superior San Judas SAS" />
      <div class="tit"><b style="font-size:${fmt.title.length > 16 ? 8.4 : 10.5}pt">${escapeHtml(fmt.title)}</b><small>${escapeHtml(COMPANY_FOOTER.tagline)}</small></div>
      <div class="num"><small>Nº</small><b>${escapeHtml(label.code)}</b><small>LOTE ${escapeHtml(label.orderNumber)}</small></div>
    </header>
    <div class="prod"><b>${escapeHtml(product)}</b><i>${escapeHtml(fmt.subtitle)}</i></div>
    <div class="body">
      <div class="grid">${labelCells(label).map(cell).join("")}</div>
      <div class="qr"><img src="${qr}" alt="QR ${escapeHtml(label.code)}" /><small>Escanear para<br />trazabilidad</small></div>
    </div>
    <div class="ali">CONTACTO CON ALIMENTOS Y BEBIDAS:
      SI <span class="ck">${food === true ? "X" : ""}</span> NO <span class="ck">${food === false ? "X" : ""}</span>
      ${obs ? `<span class="obs">OBS: ${escapeHtml(obs)}</span>` : ""}</div>
    <footer>
      <b>${escapeHtml(COMPANY_FOOTER.note)}</b>
      <small>${escapeHtml(COMPANY_FOOTER.address)}</small>
    </footer>
  </div></div>
  </div>`;
}

const STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; }
  .sheet { position: relative; overflow: hidden; break-after: page; page-break-after: always; }
  .sheet:last-child { break-after: auto; page-break-after: auto; }
  .label { width: 100mm; height: 75mm; padding: 1.6mm; background: #fff; transform-origin: top left;
           -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .box { width: 100%; height: 100%; border: 0.5mm solid #000; border-radius: 2mm; overflow: hidden;
         display: grid; grid-template-rows: 12.5mm 6.5mm 1fr 4.6mm 10.6mm; }
  header { display: grid; grid-template-columns: 22mm 1fr 25mm; align-items: center; gap: 1.5mm; padding: 1mm 1.5mm 0.6mm; border-bottom: 0.35mm solid #000; }
  header img { width: 22mm; filter: grayscale(1) contrast(1.4); }
  .tit { min-width: 0; }
  .tit b { display: block; font-weight: 900; letter-spacing: -0.2pt; line-height: 1; white-space: nowrap; }
  .tit small { display: block; font-size: 5.4pt; font-weight: 700; margin-top: 0.8mm; white-space: nowrap; }
  .num { border: 0.4mm solid #000; border-radius: 1.5mm; text-align: center; padding: 0.4mm 0; overflow: hidden; }
  .num small { display: block; font-size: 5.3pt; font-weight: 700; white-space: nowrap; }
  .num b { display: block; font-size: 10.5pt; font-weight: 900; line-height: 1.05; white-space: nowrap; }
  .prod { display: flex; align-items: baseline; justify-content: space-between; gap: 2mm; padding: 0 1.8mm; border-bottom: 0.35mm solid #000; min-width: 0; }
  .prod b { font-size: 10.5pt; font-weight: 900; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .prod i { font-size: 6.5pt; font-weight: 800; white-space: nowrap; }
  .body { display: grid; grid-template-columns: 1fr 21mm; min-height: 0; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: 1fr; border-right: 0.35mm solid #000; min-width: 0; }
  .c { border-bottom: 0.25mm solid #000; padding: 0.3mm 1.2mm; display: flex; align-items: baseline; gap: 1mm; min-width: 0; overflow: hidden; }
  .c:nth-child(odd):not(.wide) { border-right: 0.25mm solid #000; }
  .c.wide { grid-column: 1 / -1; border-bottom: 0; }
  .c small { font-size: 5.6pt; font-weight: 700; white-space: nowrap; }
  .c b { font-size: 8.2pt; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .blank { flex: 1; max-width: 16mm; border-bottom: 0.3mm solid #000; height: 3mm; }
  .qr { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.6mm; }
  .qr img { width: 18.5mm; height: 18.5mm; image-rendering: pixelated; }
  .qr small { font-size: 5pt; font-weight: 700; text-align: center; line-height: 1.1; }
  .ali { display: flex; align-items: center; gap: 1.5mm; padding: 0 1.8mm; font-size: 6.2pt; font-weight: 700; border-bottom: 0.35mm solid #000; white-space: nowrap; overflow: hidden; }
  .ck { display: inline-block; width: 2.6mm; height: 2.6mm; border: 0.3mm solid #000; text-align: center; line-height: 2.4mm; font-size: 6.5pt; margin-left: 0.6mm; }
  .ali .obs { margin-left: auto; font-weight: 400; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  footer { background: #000; color: #fff; padding: 0.7mm 1.8mm; display: flex; flex-direction: column; justify-content: center; }
  footer b { font-size: 6.6pt; font-weight: 900; line-height: 1.12; }
  footer small { font-size: 4.9pt; font-weight: 700; margin-top: 0.5mm; }
  .sheet { page: etiqueta; }
  @page { margin: 0; }
  @media screen {
    .sheet { width: auto !important; height: auto !important; }
    .label { transform: none !important; }
    body { background: #e5e7eb; padding: 8mm; display: flex; flex-wrap: wrap; gap: 6mm; align-items: flex-start; }
  }
`;

/** HTML de la página de impresión (separado para poder probarlo). */
export function rollLabelsHtml(labels: RollLabel[], logoUrl = "/logo-full.png", settings: PrinterSettings = getPrinterSettings()): string {
  const first = labelSheet(labels[0]?.station ?? "extrusion", settings);
  return `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>${labels.length === 1 ? `Etiqueta ${escapeHtml(labels[0].code)}` : `Etiquetas (${labels.length})`}</title>
    <style>
      ${STYLES}
      @page etiqueta { size: ${first.widthMm}mm ${first.heightMm}mm; margin: 0; }
      @page { size: ${first.widthMm}mm ${first.heightMm}mm; margin: 0; }
    </style>
  </head>
  <body>
    ${labels.map((l) => labelHtml(l, logoUrl, settings)).join("\n")}
  </body>
</html>`;
}

/** Abre la ventana de impresión con una o varias etiquetas. */
export function printRollLabels(labels: RollLabel[]) {
  if (labels.length === 0) return;
  const win = window.open("", "_blank");
  if (!win) return;
  // La ventana nueva es about:blank: el logo necesita la URL completa.
  win.document.write(rollLabelsHtml(labels, `${window.location.origin}/logo-full.png`));
  win.document.close();

  let printed = false;
  const doPrint = () => {
    if (printed) return;
    printed = true;
    win.focus();
    win.print();
  };
  // onload espera al logo y a los QR; el timeout es el respaldo.
  win.onload = doPrint;
  setTimeout(doPrint, 1200 + labels.length * 50);
}

export function printRollLabel(label: RollLabel) {
  printRollLabels([label]);
}

/**
 * Arma la etiqueta de un rollo/bulto de una OP: los datos de la fila
 * (peso, fecha, color, paquetes, operario) con lo que falte tomado de la OP
 * y su producto. `rollNumber` = su Nº dentro de la OP (1, 2, 3...).
 */
export function rollLabelFromOrder(
  order: {
    orderNumber: string;
    station: string | null;
    specs?: unknown;
    product: {
      name: string;
      measure?: string | null;
      measureUnit?: string | null;
      calibre?: string | null;
      color?: string | null;
      densidad?: string | null;
    };
    client?: { name: string } | null;
  },
  roll: {
    station?: string | null;
    weightKg: unknown;
    details?: unknown;
    date?: string | Date | null;
    label?: string | null;
    operatorName?: string | null;
    notes?: string | null;
  },
  code: string,
  qrDataUrl: string,
  rollNumber?: number | null
): RollLabel {
  const station = (roll.station ?? order.station ?? "extrusion") as LabelStation;
  const details = roll.details && typeof roll.details === "object" ? (roll.details as Record<string, unknown>) : {};
  const specs = order.specs && typeof order.specs === "object" ? (order.specs as Record<string, unknown>) : {};
  const str = (v: unknown) => (v == null || v === "" ? null : String(v));
  // Sellado/Embobinado: el peso de la etiqueta es el del bulto (P. BULTO);
  // Precorte suma el segundo par R2 (ver rollProducedKg).
  let weight: unknown = roll.weightKg;
  if ((station === "sellado" || station === "embobinado") && Number(details.pBulto) > 0) weight = details.pBulto;
  if (station === "precorte" && Number(details.pesoR2) > 0) weight = Number(roll.weightKg) + Number(details.pesoR2);
  return {
    station,
    code,
    qrDataUrl,
    orderNumber: order.orderNumber,
    productName: order.product.name,
    reference: labelReference(order.product),
    color: str(details.color) ?? str(specs.color) ?? order.product.color ?? null,
    weightKg: weight,
    grossKg: str(details.pesoBruto),
    date: roll.date ?? null,
    rollNumber: rollNumber ?? null,
    calibre: str(specs.calibre) ?? order.product.calibre ?? null,
    densidad: str(details.densidad) ?? str(specs.densidad) ?? str(specs.materialDensidad) ?? order.product.densidad ?? null,
    operator: roll.operatorName ?? null,
    cantPaca: str(details.paqXUnid) ?? str(specs.unidadesSellado) ?? str(specs.unidadesEmbobinado) ?? null,
    clientName: order.client?.name ?? null,
    ticket: station === "extrusion" && roll.label && roll.label !== code ? roll.label : null,
    notes: roll.notes && roll.notes !== "Inventario inicial" ? roll.notes : null,
    foodContact: null,
  };
}
