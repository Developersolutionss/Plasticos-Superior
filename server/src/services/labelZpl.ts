import { ZPL_LOGOS } from "./zplLogo";

/**
 * Etiquetas de rollo/bulto en ZPL (el idioma de la impresora térmica SAT
 * TT460, pedido del cliente 2026-11-24: "la idea es que imprima desde los
 * celulares"). El celular no le puede hablar a la impresora: pide la
 * impresión, el servidor arma la etiqueta acá y el puente de impresión del
 * PC de planta se la manda tal cual (ver routes/printers.ts).
 *
 * Diseño aprobado el 2026-11-26 a partir de sus tiquetes de papel (mismo que
 * client/src/lib/rollLabels.ts): logo y título ("MATERIAL TUBULAR"...), Nº
 * con el lote (OP), producto con su referencia, cuadrícula (fecha, color,
 * rollo Nº, peso bruto/neto, calibre, densidad, operario, cliente), QR,
 * "contacto con alimentos SI/NO" y la NOTA de devoluciones en franja negra.
 *
 * Se diseña en puntos para 100 × 75 mm a 203 dpi (800 × 600) y se escala al
 * tamaño de la etiqueta cargada en la impresora.
 */
export type LabelStation = "extrusion" | "impresion" | "sellado" | "precorte" | "embobinado";

export interface LabelData {
  station: LabelStation;
  /** Código del rollo (SELL-482). */
  code: string;
  /** Contenido del QR: código + token de posesión (SELL-482-XXXX). */
  qrContent: string;
  orderNumber: string;
  productName: string;
  /** Medida ("55x70 cm"). */
  reference?: string | null;
  color?: string | null;
  /** Peso neto (Sellado/Embobinado: el del bulto). */
  weightKg: number | null;
  grossKg?: number | null;
  date?: Date | null;
  rollNumber?: number | null;
  calibre?: string | null;
  densidad?: string | null;
  operator?: string | null;
  cantPaca?: string | null;
  clientName?: string | null;
  ticket?: string | null;
  notes?: string | null;
  /** null = casillas vacías para marcar a mano. */
  foodContact?: boolean | null;
}

export interface LabelSize {
  widthMm: number;
  heightMm: number;
  dpi?: number;
}

interface Format {
  title: string;
  subtitle: string;
  numberLabel: string;
  grossLabel: string;
  netLabel: string;
  bulto: boolean;
}

const ROLL = { numberLabel: "ROLLO Nº", grossLabel: "PESO BRUTO", netLabel: "PESO NETO", bulto: false };
const FORMATS: Record<LabelStation, Format> = {
  extrusion: { title: "MATERIAL TUBULAR", subtitle: "ROLLO DE EXTRUSIÓN", ...ROLL },
  impresion: { title: "MATERIAL IMPRESO", subtitle: "ROLLO IMPRESO", ...ROLL },
  precorte: { title: "MATERIAL PRECORTADO", subtitle: "EN ROLLO PRECORTE", ...ROLL },
  embobinado: { title: "MATERIAL EMBOBINADO", subtitle: "ROLLO EMBOBINADO", ...ROLL },
  sellado: { title: "BOLSAS SELLADAS", subtitle: "BULTO SELLADO", numberLabel: "BULTO Nº", grossLabel: "PAQ X UNID", netLabel: "PESO BULTO", bulto: true },
};

const TAGLINE = "TUBULARES · BOLSAS · PRECORTADOS";
const NOTE = "NOTA: Únicamente se aceptan devoluciones y/o reclamos de rollos con la presentación de este tiquete.";
const ADDRESS = "Carrera 44 No. 18-106 · Tel 326 2543 - 336 9192 · Cel 318 5732551 · Cali - Colombia";

/** ^ y ~ son comandos en ZPL: dentro de un texto romperían la etiqueta. */
export function zplText(s: string): string {
  return s.replace(/[\^~\\]/g, " ").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

/** dd-mm-aa, como en la etiqueta de papel. Hora de Colombia. */
export function labelDateText(d?: Date | null): string {
  const date = d ?? new Date();
  const parts = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "2-digit", year: "2-digit" }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}-${get("month")}-${get("year")}`;
}

function kgText(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "";
  return `${n.toLocaleString("es-CO", { maximumFractionDigits: 2 })} kg`;
}

/** Ancho aproximado de un texto en la fuente 0 de ZPL (para no pasarse). */
function textWidth(text: string, h: number): number {
  return text.length * h * 0.5;
}

function fitFont(text: string, maxWidth: number, maxH: number, minH: number): number {
  let h = maxH;
  while (h > minH && textWidth(text, h) > maxWidth) h -= 1;
  return h;
}

function truncate(text: string, maxWidth: number, h: number): string {
  const max = Math.max(3, Math.floor(maxWidth / (h * 0.5)));
  return text.length <= max ? text : `${text.slice(0, max - 1)}.`;
}

/** Módulos del QR (versión 1 a 4, corrección L) según el largo del contenido. */
function qrModules(len: number): number {
  if (len <= 17) return 21;
  if (len <= 32) return 25;
  if (len <= 53) return 29;
  return 33;
}

/** Observaciones: cant. paca (rollos), tiquete y notas de la fila. */
export function observations(label: LabelData): string {
  const fmt = FORMATS[label.station] ?? FORMATS.extrusion;
  return [
    !fmt.bulto && label.cantPaca ? `Cant. paca ${label.cantPaca}` : "",
    label.ticket ? `Tiquete ${label.ticket}` : "",
    label.notes?.trim() ?? "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function renderLabelZpl(label: LabelData, size: LabelSize): string {
  const dpmm = (size.dpi ?? 203) / 25.4;
  const W = Math.round(size.widthMm * dpmm);
  const H = Math.round(size.heightMm * dpmm);
  // Diseño en 800 × 600 (100 × 75 mm a 8 puntos/mm), escalado y centrado.
  const S = Math.min(W / 800, H / 600);
  const ox = Math.round((W - 800 * S) / 2);
  const oy = Math.round((H - 600 * S) / 2);
  const X = (n: number) => ox + Math.round(n * S);
  const Y = (n: number) => oy + Math.round(n * S);
  const D = (n: number) => Math.max(1, Math.round(n * S));
  const fmt = FORMATS[label.station] ?? FORMATS.extrusion;

  // ^MNY: etiquetas con separación (gap) — la impresora arranca cada una en
  // su borde aunque haya quedado configurada como papel continuo.
  const out: string[] = ["^XA", "^CI28", "^MNY", `^PW${W}`, `^LL${H}`, "^LH0,0"];
  const text = (
    x: number,
    y: number,
    h: number,
    s: string,
    opts?: { width?: number; align?: "L" | "C" | "R"; lines?: number; reverse?: boolean }
  ) => {
    const t = zplText(s);
    if (!t) return;
    const hh = Math.max(10, D(h));
    const fb = opts?.width ? `^FB${D(opts.width)},${opts.lines ?? 1},${opts.lines && opts.lines > 1 ? D(2) : 0},${opts.align ?? "L"},0` : "";
    out.push(`^FO${X(x)},${Y(y)}^A0N,${hh},${Math.round(hh * 0.9)}${fb}${opts?.reverse ? "^FR" : ""}^FD${t}^FS`);
  };
  const box = (x: number, y: number, w: number, h: number, t: number, r = 0) =>
    out.push(`^FO${X(x)},${Y(y)}^GB${D(w)},${D(h)},${D(t)},B,${r}^FS`);

  // Marco con esquinas redondeadas.
  box(13, 13, 774, 574, 4, 1);

  // Encabezado: logo · título · Nº con el lote.
  const logoH = 64 * S;
  const logo = [...ZPL_LOGOS].reverse().find((l) => l.h <= logoH + 1) ?? ZPL_LOGOS[0];
  out.push(`^FO${X(25)},${Y(13) + Math.round((D(100) - logo.h) / 2)}^GFA,${logo.bpr * logo.h},${logo.bpr * logo.h},${logo.bpr},${logo.hex}^FS`);
  const titleX = 25 + Math.round(logo.w / S) + 14;
  const titleW = 568 - titleX;
  text(titleX, 30, fitFont(fmt.title, titleW, fmt.title.length > 16 ? 36 : 44, 22), fmt.title);
  text(titleX, 80, fitFont(TAGLINE, titleW, 19, 12), TAGLINE);
  box(575, 21, 203, 86, 3, 2);
  text(575, 27, 16, "Nº", { width: 203, align: "C" });
  text(575, 45, fitFont(label.code, 185, 38, 20), label.code, { width: 203, align: "C" });
  const lote = `LOTE ${label.orderNumber}`;
  text(575, 85, fitFont(lote, 185, 17, 11), lote, { width: 203, align: "C" });
  box(13, 113, 774, 3, 3);

  // Producto con referencia · qué es.
  const product = [label.productName, label.reference ? `REF ${label.reference}` : ""].filter(Boolean).join(" · ").toUpperCase();
  const prodH = fitFont(product, 500, 36, 22);
  text(27, 124 + Math.round((36 - prodH) / 2), prodH, truncate(product, 500, prodH));
  text(530, 136, 20, fmt.subtitle, { width: 245, align: "R" });
  box(13, 168, 774, 3, 3);

  // Cuadrícula de datos (4 filas de 2 + cliente a lo ancho) y QR a la derecha.
  const up = (s?: string | null) => (s ?? "").toString().trim().toUpperCase();
  const cells: { label: string; value: string; wide?: boolean }[] = [
    { label: "FECHA", value: labelDateText(label.date) },
    { label: "COLOR", value: up(label.color) },
    { label: fmt.numberLabel, value: label.rollNumber ? String(label.rollNumber) : "" },
    { label: fmt.grossLabel, value: fmt.bulto ? up(label.cantPaca) : kgText(label.grossKg) },
    { label: "CALIBRE", value: up(label.calibre) },
    { label: fmt.netLabel, value: kgText(label.weightKg) },
    { label: "DENSIDAD", value: up(label.densidad) },
    { label: "OPERARIO", value: up(label.operator) },
    { label: "CLIENTE", value: up(label.clientName) || "STOCK (SIN CLIENTE)", wide: true },
  ];
  const gx = 13;
  const gy = 171;
  const colW = 302;
  const rowH = 58;
  box(617, gy, 3, 292, 3);
  for (let r = 1; r <= 4; r++) box(gx, gy + r * rowH, 604, 2, 2);
  box(gx + colW, gy, 2, 4 * rowH, 2);
  cells.forEach((c, i) => {
    const row = c.wide ? 4 : Math.floor(i / 2);
    const col = c.wide ? 0 : i % 2;
    const x = gx + col * colW + 10;
    const y = gy + row * rowH;
    const w = c.wide ? 584 : colW - 20;
    const lab = `${c.label}:`;
    text(x, y + 22, 18, lab);
    const vx = x + Math.round(textWidth(lab, 18)) + 10;
    const vw = w - (vx - x);
    if (c.value) {
      const vh = fitFont(c.value, vw, 30, 20);
      text(vx, y + 14 + (30 - vh), vh, truncate(c.value, vw, vh));
    } else {
      // Sin dato: línea para escribirlo a mano.
      box(vx, y + 40, Math.min(150, vw), 2, 2);
    }
  });

  const modules = qrModules(label.qrContent.length);
  const mag = Math.max(1, Math.floor((150 * S + 2) / modules));
  const qrPx = modules * mag;
  out.push(`^FO${X(619) + Math.round((D(168) - qrPx) / 2)},${Y(gy + 20)}^BQN,2,${mag}^FDLA,${zplText(label.qrContent)}^FS`);
  text(619, gy + 20 + Math.round(qrPx / S) + 14, 15, "Escanear para", { width: 168, align: "C" });
  text(619, gy + 20 + Math.round(qrPx / S) + 32, 15, "trazabilidad", { width: 168, align: "C" });

  // Contacto con alimentos (casillas) y observaciones.
  box(13, 463, 774, 3, 3);
  text(27, 476, 20, "CONTACTO CON ALIMENTOS Y BEBIDAS:");
  text(392, 476, 20, "SI");
  box(420, 473, 22, 22, 2);
  if (label.foodContact === true) text(420, 475, 20, "X", { width: 22, align: "C" });
  text(456, 476, 20, "NO");
  box(490, 473, 22, 22, 2);
  if (label.foodContact === false) text(490, 475, 20, "X", { width: 22, align: "C" });
  const obs = observations(label);
  if (obs) {
    const o = `OBS: ${obs}`;
    text(525, 478, 17, truncate(o, 250, 17), { width: 250, align: "R" });
  }

  // Franja negra con la NOTA y la dirección (texto en blanco: ^FR).
  out.push(`^FO${X(13)},${Y(500)}^GB${D(774)},${D(87)},${D(87)},B,0^FS`);
  text(27, 508, 22, NOTE, { width: 748, lines: 2, reverse: true });
  text(27, 563, 15, ADDRESS, { reverse: true });

  out.push("^PQ1", "^XZ");
  return out.join("\n");
}

/** Datos de la etiqueta de un rollo a partir de su OP y su fila (mismo criterio que rollLabelFromOrder del cliente). */
export function labelDataFromRoll(
  order: {
    orderNumber: string;
    station: string | null;
    specs: unknown;
    product: { name: string; measure: string | null; measureUnit: string | null; calibre: string | null; color: string | null; densidad?: string | null };
    client: { name: string } | null;
  },
  roll: {
    station: string;
    weightKg: unknown;
    details: unknown;
    date: Date;
    label: string | null;
    operatorName?: string | null;
    notes?: string | null;
  },
  code: string,
  possessionToken: string,
  rollNumber?: number | null
): LabelData {
  // La del rollo: es la de su código (EXT/SELL/...), aunque la OP ya se haya derivado.
  const station = (roll.station ?? order.station ?? "extrusion") as LabelStation;
  const details = roll.details && typeof roll.details === "object" ? (roll.details as Record<string, unknown>) : {};
  const specs = order.specs && typeof order.specs === "object" ? (order.specs as Record<string, unknown>) : {};
  const str = (v: unknown) => (v == null || v === "" ? null : String(v));
  let weight = Number(roll.weightKg);
  if ((station === "sellado" || station === "embobinado") && Number(details.pBulto) > 0) weight = Number(details.pBulto);
  if (station === "precorte" && Number(details.pesoR2) > 0) weight += Number(details.pesoR2);
  const gross = Number(details.pesoBruto);
  return {
    station,
    code,
    qrContent: `${code}-${possessionToken}`,
    orderNumber: order.orderNumber,
    productName: order.product.name,
    reference: productReference(order.product),
    color: str(details.color) ?? str(specs.color) ?? order.product.color,
    weightKg: Number.isFinite(weight) ? Math.round(weight * 100) / 100 : null,
    grossKg: Number.isFinite(gross) && gross > 0 ? gross : null,
    date: roll.date,
    rollNumber: rollNumber ?? null,
    calibre: str(specs.calibre) ?? order.product.calibre,
    densidad: str(details.densidad) ?? str(specs.densidad) ?? str(specs.materialDensidad) ?? order.product.densidad ?? null,
    operator: roll.operatorName ?? null,
    cantPaca: str(details.paqXUnid) ?? str(specs.unidadesSellado) ?? str(specs.unidadesEmbobinado),
    clientName: order.client?.name ?? null,
    ticket: station === "extrusion" && roll.label && roll.label !== code ? roll.label : null,
    notes: roll.notes && roll.notes !== "Inventario inicial" ? roll.notes : null,
    foodContact: null,
  };
}

const UNIT_SHORT: Record<string, string> = { Pulgadas: "pulg", "Cms.": "cm" };

/** "55x70 cm" (mismo formato que productMeasure del cliente; el calibre va en su casilla). */
export function productReference(p: { measure: string | null; measureUnit: string | null }): string {
  const m = p.measure?.trim() ?? "";
  const unit = p.measureUnit ? UNIT_SHORT[p.measureUnit] ?? p.measureUnit : "";
  return m ? (unit && !/[a-zA-Z"]\s*$/.test(m) ? `${m} ${unit}` : m) : "";
}

/** Etiqueta de muestra (datos de su tiquete de papel), para la prueba de impresión. */
export function sampleLabelData(station: LabelStation): LabelData {
  return {
    station,
    code: "PRUEBA",
    qrContent: "PRUEBA-IMPRESION-SAT-TT460",
    orderNumber: "OP-PRUEBA",
    productName: "Bolsa basura",
    reference: "55x70 cm",
    color: "Negro",
    weightKg: 12.5,
    date: new Date(),
    rollNumber: 1,
    calibre: "2.5",
    densidad: "Alta",
    operator: "Prueba",
    cantPaca: "50",
    clientName: "Cliente de prueba",
  };
}
