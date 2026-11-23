import { productCalibre, productMeasure } from "./productMeasure";

/**
 * Etiquetas físicas de lo que sale de cada estación (pedido del cliente
 * 2026-11-23, sobre su etiqueta de papel de siempre: logo + "En precios y
 * calidad somos Superior", producto grande, REF, fecha/peso/color/cant.
 * paca, pie con el reclamo y la dirección, y el código abajo a la derecha).
 * Cada estación tiene su tamaño de etiqueta:
 *
 * - Sellado (bultos): 16 × 8 cm
 * - Extrusión, Impresión y Precorte (rollos): 13 × 10 cm
 * - Embobinado: 10 × 8 cm
 *
 * Todas llevan el QR con el token de posesión: es lo que el operario de la
 * estación siguiente escanea para consumir el rollo o bulto.
 */
export type LabelStation = "extrusion" | "impresion" | "sellado" | "precorte" | "embobinado";

export interface RollLabel {
  station: LabelStation;
  code: string;
  qrDataUrl: string;
  orderNumber: string;
  productName: string;
  /** "55x70 cm · cal 2.5": medida y calibre (sin color, que va aparte). */
  reference?: string | null;
  color?: string | null;
  weightKg: unknown;
  /** Fecha de producción (ISO o Date); sin fecha, hoy. */
  date?: string | Date | null;
  /** Cant. paca / paquetes por unidad; vacío = línea para escribir a mano. */
  cantPaca?: string | number | null;
  clientName?: string | null;
  /** Número del tiquete físico del rollo (inventario inicial), si tiene. */
  ticket?: string | null;
}

export interface LabelFormat {
  widthMm: number;
  heightMm: number;
  /** Lo que se lee debajo del nombre del producto. */
  subtitle: string;
  /** Rótulo del peso en esta estación. */
  weightLabel: string;
  /** ¿Muestra la línea de "cant. paca"? (rollos de Extrusión no la usan). */
  cantPaca: string | null;
}

/**
 * Impresora de planta: SAT TT460 UE (transferencia térmica, 203 dpi). El
 * cabezal imprime hasta 108 mm de ancho; a lo largo (por donde sale el
 * papel) la etiqueta puede ser más larga. Una etiqueta más ancha que el
 * cabezal (Sellado 16 cm, rollos 13 cm) se manda GIRADA 90°: el rollo de
 * etiquetas va cargado por su lado corto (8 cm / 10 cm) y la etiqueta sale
 * a lo largo. Igual se lee derecha una vez pegada.
 */
export const PRINTER_MAX_WIDTH_MM = 108;

/** Hoja que recibe la impresora: ancho = lo que cruza el cabezal. */
/**
 * Ajustes de la impresora de ESTE equipo (se guardan en el navegador del PC
 * que tiene la impresora conectada): si se gira lo que no entra a lo ancho
 * (por si cargan el rollo de etiquetas de otra forma) y cuánto correr el
 * diseño (mm) si la impresora lo saca corrido. Se calibran en
 * Configuración → Prueba de etiquetas.
 */
export interface PrinterSettings {
  rotateWide: boolean;
  offsetXmm: number;
  offsetYmm: number;
}

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = { rotateWide: true, offsetXmm: 0, offsetYmm: 0 };
const PRINTER_SETTINGS_KEY = "labelPrinterSettings";

export function getPrinterSettings(): PrinterSettings {
  try {
    const raw = localStorage.getItem(PRINTER_SETTINGS_KEY);
    if (!raw) return DEFAULT_PRINTER_SETTINGS;
    const s = JSON.parse(raw) as Partial<PrinterSettings>;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(-20, Math.min(20, v)) : 0);
    return { rotateWide: s.rotateWide !== false, offsetXmm: num(s.offsetXmm), offsetYmm: num(s.offsetYmm) };
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

export function labelSheet(
  station: LabelStation,
  settings: Pick<PrinterSettings, "rotateWide"> = DEFAULT_PRINTER_SETTINGS
): { widthMm: number; heightMm: number; rotated: boolean } {
  const f = LABEL_FORMATS[station] ?? LABEL_FORMATS.extrusion;
  const rotated = settings.rotateWide && f.widthMm > PRINTER_MAX_WIDTH_MM;
  return rotated ? { widthMm: f.heightMm, heightMm: f.widthMm, rotated } : { widthMm: f.widthMm, heightMm: f.heightMm, rotated };
}

export const LABEL_FORMATS: Record<LabelStation, LabelFormat> = {
  sellado: { widthMm: 160, heightMm: 80, subtitle: "BULTO SELLADO", weightLabel: "PESO BULTO", cantPaca: "PAQ X UNID" },
  extrusion: { widthMm: 130, heightMm: 100, subtitle: "ROLLO DE EXTRUSIÓN", weightLabel: "PESO", cantPaca: null },
  impresion: { widthMm: 130, heightMm: 100, subtitle: "ROLLO IMPRESO", weightLabel: "PESO", cantPaca: "CANT PACA" },
  precorte: { widthMm: 130, heightMm: 100, subtitle: "EN ROLLO PRECORTE", weightLabel: "PESO", cantPaca: "CANT PACA" },
  embobinado: { widthMm: 100, heightMm: 80, subtitle: "ROLLO EMBOBINADO", weightLabel: "PESO", cantPaca: "CANT PACA" },
};

/** Datos de la empresa del pie (los de su etiqueta de papel). */
export const COMPANY_FOOTER = {
  claim: "PARA CUALQUIER RECLAMO SÍRVASE CITAR ESTA ETIQUETA",
  address: "CRR 44 # 18-106 B/ SAN JUDAS · TELÉFONO 318-8711399",
  city: "CALI - COLOMBIA",
};

export function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** "55x70 cm · cal 2.5" a partir del producto del catálogo. */
export function labelReference(p: { measure?: string | null; measureUnit?: string | null; calibre?: string | null } | null | undefined): string {
  if (!p) return "";
  return [productMeasure(p), productCalibre(p)].filter(Boolean).join(" · ");
}

/** dd-mm-aa, como en la etiqueta de papel (09-11-26). */
export function labelDate(value?: string | Date | null): string {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${String(d.getFullYear()).slice(-2)}`;
}

function kg(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return `${n.toLocaleString("es-CO", { maximumFractionDigits: 2 })} kg`;
}

/** El nombre del producto va lo más grande que entre: los largos bajan de tamaño. */
function titleSize(name: string, station: LabelStation): string {
  const base = station === "embobinado" ? 17 : station === "sellado" ? 22 : 26;
  const len = name.length;
  const factor = len <= 14 ? 1 : len <= 22 ? 0.8 : len <= 32 ? 0.64 : 0.52;
  return `${Math.round(base * factor)}pt`;
}

function field(label: string, value: string, wide = false): string {
  const v = value.trim() ? escapeHtml(value) : '<span class="blank"></span>';
  return `<div class="f${wide ? " wide" : ""}"><b>${escapeHtml(label)}:</b> <span>${v}</span></div>`;
}

function labelHtml(label: RollLabel, logoUrl: string, settings: PrinterSettings): string {
  const fmt = LABEL_FORMATS[label.station] ?? LABEL_FORMATS.extrusion;
  const name = label.productName.toUpperCase();
  const fields = [
    field("FECHA", labelDate(label.date)),
    fmt.cantPaca ? field(fmt.cantPaca, label.cantPaca == null ? "" : String(label.cantPaca)) : "",
    field(fmt.weightLabel, kg(label.weightKg)),
    field("COLOR", (label.color ?? "").toUpperCase()),
    field("OP", label.orderNumber),
    label.ticket ? field("TIQUETE", label.ticket) : "",
    label.clientName ? field("CLIENTE", label.clientName.toUpperCase(), true) : "",
  ].join("");
  const sheet = labelSheet(label.station, settings);
  // Girada: el diseño se arma derecho y se rota 90° dentro de la hoja.
  const moves = [
    settings.offsetXmm || settings.offsetYmm ? `translate(${settings.offsetXmm}mm, ${settings.offsetYmm}mm)` : "",
    sheet.rotated ? `translateX(${sheet.widthMm}mm) rotate(90deg)` : "",
  ].filter(Boolean);
  const rotate = moves.length ? ` style="transform: ${moves.join(" ")}"` : "";
  // 0.3 mm menos de alto que la hoja: por redondeo de mm a px Chrome puede
  // sacar una hoja en blanco entre etiquetas si mide exactamente lo mismo.
  const station = escapeHtml(label.station);
  return `<div class="sheet sheet-${station}" style="width:${sheet.widthMm}mm;height:${sheet.heightMm - 0.3}mm">
  <div class="label lbl-${station}"${rotate}>
    <header>
      <img class="logo" src="${escapeHtml(logoUrl)}" alt="Plásticos Superior San Judas SAS" />
      <div class="slogan">EN PRECIOS Y CALIDAD<br /><u>SOMOS SUPERIOR</u></div>
    </header>
    <section class="title">
      <h1 style="font-size:${titleSize(name, label.station)}">${escapeHtml(name)}</h1>
      <p class="sub">${escapeHtml(fmt.subtitle)}</p>
      ${label.reference ? `<p class="ref">REF: <u>${escapeHtml(label.reference.toUpperCase())}</u></p>` : ""}
    </section>
    <section class="fields">${fields}</section>
    <section class="qr"><img src="${/^data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+$/.test(label.qrDataUrl) ? label.qrDataUrl : ""}" alt="QR ${escapeHtml(label.code)}" /></section>
    <footer>
      <div class="claim">${escapeHtml(COMPANY_FOOTER.claim)}<br />${escapeHtml(COMPANY_FOOTER.address)}<br />${escapeHtml(COMPANY_FOOTER.city)}</div>
      <div class="pcode"><small>CÓDIGO PRODUCTO</small><strong>${escapeHtml(label.code)}</strong></div>
    </footer>
  </div>
  </div>`;
}

const STYLES = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; }
  .label {
    position: relative; overflow: hidden; background: #fff;
    border: 0.6mm solid #000; padding: 2.5mm 3mm;
    display: grid; column-gap: 3mm;
    transform-origin: top left;
  }
  .sheet { position: relative; overflow: hidden; break-after: page; page-break-after: always; }
  .sheet:last-child { break-after: auto; page-break-after: auto; }
  header { grid-area: header; display: flex; align-items: center; justify-content: space-between; gap: 3mm; min-height: 0; }
  .logo { height: 100%; max-height: 15mm; width: auto; filter: grayscale(1) contrast(1.4); }
  .slogan { font-family: "Courier New", Courier, monospace; font-size: 8.5pt; text-align: center; line-height: 1.25; }
  .title { grid-area: title; text-align: center; min-width: 0; }
  .title h1 { margin: 1mm 0 0; line-height: 1; font-weight: 900; letter-spacing: -0.02em; overflow-wrap: anywhere;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .title .sub { margin: 0.8mm 0 0; font-weight: 800; font-style: italic; font-size: 12pt; }
  .title .ref { margin: 0.8mm 0 0; font-weight: 700; font-size: 13pt; }
  .fields { grid-area: fields; display: grid; grid-template-columns: 1fr 1fr; gap: 1mm 3mm; align-content: center; font-size: 10.5pt; min-width: 0; }
  .fields .f { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fields .f.wide { grid-column: 1 / -1; }
  .fields b { font-weight: 800; }
  .blank { display: inline-block; width: 11mm; height: 1em; vertical-align: bottom; border-bottom: 0.3mm solid #000; }
  .qr { grid-area: qr; display: flex; align-items: center; justify-content: center; min-height: 0; }
  .qr img { width: 100%; height: auto; max-height: 100%; image-rendering: pixelated; }
  footer { grid-area: footer; border-top: 0.5mm solid #000; display: flex; align-items: center; justify-content: space-between; gap: 2mm; padding-top: 1mm; }
  .claim { font-size: 5.5pt; font-weight: 700; line-height: 1.3; }
  .pcode { text-align: right; white-space: nowrap; }
  .pcode small { display: block; font-family: "Courier New", Courier, monospace; font-size: 7pt; }
  .pcode strong { font-size: 17pt; font-weight: 900; }

  /* Extrusión / Impresión / Precorte: 13 × 10 cm */
  .lbl-extrusion, .lbl-impresion, .lbl-precorte {
    width: 130mm; height: 100mm;
    grid-template-columns: 1fr 30mm; grid-template-rows: 16mm auto 1fr 14mm;
    grid-template-areas: "header header" "title title" "fields qr" "footer footer";
  }
  /* Sellado (bulto): 16 × 8 cm, apaisada: el QR ocupa la columna derecha. */
  .lbl-sellado {
    width: 160mm; height: 80mm;
    grid-template-columns: 1fr 34mm; grid-template-rows: 13mm auto 1fr 12mm;
    grid-template-areas: "header qr" "title qr" "fields qr" "footer footer";
  }
  .lbl-sellado .title .sub { font-size: 11pt; }
  .lbl-sellado .title .ref { font-size: 12pt; }
  .lbl-sellado .fields { grid-template-columns: 1fr 1fr; font-size: 10.5pt; }
  .lbl-sellado .logo { max-height: 12mm; }
  /* Embobinado: 10 × 8 cm, todo más compacto. */
  .lbl-embobinado {
    width: 100mm; height: 80mm; padding: 2mm 2.5mm;
    grid-template-columns: 1fr 24mm; grid-template-rows: 11mm auto 1fr 11mm;
    grid-template-areas: "header header" "title title" "fields qr" "footer footer";
  }
  .lbl-embobinado .logo { max-height: 10mm; }
  .lbl-embobinado .slogan { font-size: 6.5pt; }
  .lbl-embobinado .title .sub { font-size: 9pt; }
  .lbl-embobinado .title .ref { font-size: 10pt; }
  .lbl-embobinado .fields { grid-template-columns: 1fr; gap: 0.5mm; font-size: 8.5pt; }
  .lbl-embobinado .claim { font-size: 4.5pt; }
  .lbl-embobinado .pcode strong { font-size: 13pt; }
  .lbl-embobinado .pcode small { font-size: 5.5pt; }

  /* Hoja de impresora por tamaño (ancho = lo que cruza el cabezal). */
  .sheet-extrusion, .sheet-impresion, .sheet-precorte { page: rollo; }
  .sheet-sellado { page: bulto; }
  .sheet-embobinado { page: embobinado; }
  @page { margin: 0; }
  @media screen {
    /* En pantalla se ve derecha; girada es solo para la impresora. */
    .sheet { width: auto !important; height: auto !important; }
    .label { transform: none !important; }
    body { background: #e5e7eb; padding: 8mm; display: flex; flex-wrap: wrap; gap: 6mm; align-items: flex-start; }
  }
`;

/** HTML de la página de impresión (separado para poder probarlo). */
export function rollLabelsHtml(labels: RollLabel[], logoUrl = "/logo-full.png", settings: PrinterSettings = getPrinterSettings()): string {
  const first = labelSheet(labels[0]?.station ?? "extrusion", settings);
  const size = (s: LabelStation) => {
    const sh = labelSheet(s, settings);
    return `${sh.widthMm}mm ${sh.heightMm}mm`;
  };
  const pages = `@page rollo { size: ${size("precorte")}; margin: 0; }
      @page bulto { size: ${size("sellado")}; margin: 0; }
      @page embobinado { size: ${size("embobinado")}; margin: 0; }`;
  return `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>${labels.length === 1 ? `Etiqueta ${escapeHtml(labels[0].code)}` : `Etiquetas (${labels.length})`}</title>
    <style>
      ${STYLES}
      ${pages}
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
 * (peso, fecha, color, paquetes) con lo que falte tomado de la OP y su
 * producto.
 */
export function rollLabelFromOrder(
  order: {
    orderNumber: string;
    station: string | null;
    specs?: unknown;
    product: { name: string; measure?: string | null; measureUnit?: string | null; calibre?: string | null; color?: string | null };
    client?: { name: string } | null;
  },
  roll: { weightKg: unknown; details?: unknown; date?: string | Date | null; label?: string | null },
  code: string,
  qrDataUrl: string
): RollLabel {
  const station = (order.station ?? "extrusion") as LabelStation;
  const details = roll.details && typeof roll.details === "object" ? (roll.details as Record<string, unknown>) : {};
  const specs = order.specs && typeof order.specs === "object" ? (order.specs as Record<string, unknown>) : {};
  const str = (v: unknown) => (v == null || v === "" ? null : String(v));
  // Sellado/Embobinado: el peso de la etiqueta es el del bulto (P. BULTO);
  // Precorte suma el segundo par R2 (ver rollProducedKg).
  let weight: unknown = roll.weightKg;
  if ((station === "sellado" || station === "embobinado") && Number(details.pBulto) > 0) weight = details.pBulto;
  if (station === "precorte" && Number(details.pesoR2) > 0) weight = Number(roll.weightKg) + Number(details.pesoR2);
  const cantPaca =
    str(details.paqXUnid) ?? str(specs.unidadesSellado) ?? str(specs.unidadesEmbobinado) ?? null;
  return {
    station,
    code,
    qrDataUrl,
    orderNumber: order.orderNumber,
    productName: order.product.name,
    reference: labelReference(order.product),
    color: str(details.color) ?? str(specs.color) ?? order.product.color ?? null,
    weightKg: weight,
    date: roll.date ?? null,
    cantPaca,
    clientName: order.client?.name ?? null,
    ticket: station === "extrusion" && roll.label && roll.label !== code ? roll.label : null,
  };
}
