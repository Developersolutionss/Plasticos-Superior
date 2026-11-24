import { ZPL_LOGOS } from "./zplLogo";

/**
 * Etiquetas de rollo/bulto en ZPL (el idioma de la impresora térmica SAT
 * TT460, pedido del cliente 2026-11-24: "la idea es que imprima desde los
 * celulares"). El celular no le puede hablar a la impresora: pide la
 * impresión, el servidor arma la etiqueta acá y el puente de impresión del
 * PC de planta se la manda tal cual (ver routes/printers.ts).
 *
 * Mismo contenido que la etiqueta del navegador (client/src/lib/rollLabels.ts):
 * logo, "En precios y calidad somos Superior", producto, subtítulo de la
 * estación, REF, fecha/peso/color/cant. paca/OP/cliente, QR y código, y el
 * pie de reclamo. El tamaño lo pone la etiqueta cargada en la impresora
 * (hoy 100 × 75 mm): todo se acomoda en proporción.
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
  reference?: string | null;
  color?: string | null;
  weightKg: number | null;
  date?: Date | null;
  cantPaca?: string | null;
  clientName?: string | null;
  ticket?: string | null;
}

export interface LabelSize {
  widthMm: number;
  heightMm: number;
  dpi?: number;
}

const FORMATS: Record<LabelStation, { subtitle: string; weightLabel: string; cantPaca: string | null }> = {
  sellado: { subtitle: "BULTO SELLADO", weightLabel: "PESO BULTO", cantPaca: "PAQ X UNID" },
  extrusion: { subtitle: "ROLLO DE EXTRUSION", weightLabel: "PESO", cantPaca: null },
  impresion: { subtitle: "ROLLO IMPRESO", weightLabel: "PESO", cantPaca: "CANT PACA" },
  precorte: { subtitle: "EN ROLLO PRECORTE", weightLabel: "PESO", cantPaca: "CANT PACA" },
  embobinado: { subtitle: "ROLLO EMBOBINADO", weightLabel: "PESO", cantPaca: "CANT PACA" },
};

const FOOTER = ["PARA CUALQUIER RECLAMO SIRVASE CITAR ESTA ETIQUETA", "CRR 44 # 18-106 B/ SAN JUDAS - TELEFONO 318-8711399", "CALI - COLOMBIA"];

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

function kgText(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "";
  return `${n.toLocaleString("es-CO", { maximumFractionDigits: 2 })} kg`;
}

/** Ancho aproximado de un texto en la fuente 0 de ZPL (para no pasarse). */
function textWidth(text: string, h: number): number {
  return text.length * h * 0.52;
}

function fitFont(text: string, maxWidth: number, maxH: number, minH: number): number {
  let h = maxH;
  while (h > minH && textWidth(text, h) > maxWidth) h -= 1;
  return h;
}

function truncate(text: string, maxWidth: number, h: number): string {
  const max = Math.max(4, Math.floor(maxWidth / (h * 0.5)));
  return text.length <= max ? text : `${text.slice(0, max - 1)}.`;
}

/** Módulos del QR (versión 2 o 3, corrección L) según el largo del contenido. */
function qrModules(len: number): number {
  if (len <= 17) return 21;
  if (len <= 32) return 25;
  if (len <= 53) return 29;
  return 33;
}

export function renderLabelZpl(label: LabelData, size: LabelSize): string {
  const dpmm = (size.dpi ?? 203) / 25.4;
  const W = Math.round(size.widthMm * dpmm);
  const H = Math.round(size.heightMm * dpmm);
  const fmt = FORMATS[label.station] ?? FORMATS.extrusion;
  // ^MNY: etiquetas con separación (gap) — la impresora arranca cada una en
  // su borde aunque haya quedado configurada como papel continuo.
  const out: string[] = ["^XA", "^CI28", "^MNY", `^PW${W}`, `^LL${H}`, "^LH0,0"];
  const text = (x: number, y: number, h: number, s: string, opts?: { width?: number; align?: "L" | "C" | "R"; lines?: number }) => {
    const t = zplText(s);
    if (!t) return;
    const fb = opts?.width ? `^FB${Math.round(opts.width)},${opts.lines ?? 1},0,${opts.align ?? "L"},0` : "";
    out.push(`^FO${Math.round(x)},${Math.round(y)}^A0N,${Math.round(h)},${Math.round(h * 0.92)}${fb}^FD${t}^FS`);
  };
  const box = (x: number, y: number, w: number, h: number, t: number) =>
    out.push(`^FO${Math.round(x)},${Math.round(y)}^GB${Math.round(w)},${Math.round(h)},${Math.round(t)}^FS`);

  const m = Math.round(2 * dpmm);
  const x0 = m;
  const y0 = m;
  const iw = W - 2 * m;
  const ih = H - 2 * m;
  const pad = Math.round(1.5 * dpmm);
  box(x0, y0, iw, ih, Math.max(3, Math.round(0.5 * dpmm)));

  // Encabezado: logo a la izquierda, eslogan a la derecha.
  const hh = Math.round(ih * 0.17);
  const logo = [...ZPL_LOGOS].reverse().find((l) => l.h <= hh - 8 && l.w <= iw * 0.5) ?? ZPL_LOGOS[0];
  out.push(`^FO${x0 + pad},${Math.round(y0 + (hh - logo.h) / 2)}^GFA,${logo.bpr * logo.h},${logo.bpr * logo.h},${logo.bpr},${logo.hex}^FS`);
  const sloganW = Math.round(iw * 0.42);
  const sH = Math.max(14, Math.min(26, Math.round(ih * 0.034)));
  const sloganX = x0 + iw - pad - sloganW;
  const sloganY = Math.round(y0 + hh / 2 - sH - 2);
  text(sloganX, sloganY, sH, "EN PRECIOS Y CALIDAD", { width: sloganW, align: "C" });
  text(sloganX, sloganY + sH + 4, sH, "SOMOS SUPERIOR", { width: sloganW, align: "C" });
  const underW = textWidth("SOMOS SUPERIOR", sH * 0.92);
  box(sloganX + (sloganW - underW) / 2, sloganY + 2 * sH + 6, underW, 2, 2);

  // Producto (lo más grande que entre, hasta 2 líneas), estación y REF.
  const name = zplText(label.productName.toUpperCase());
  const titleW = iw - 2 * pad;
  const len = name.length;
  const factor = len <= 14 ? 1 : len <= 22 ? 0.8 : len <= 32 ? 0.64 : 0.52;
  const nameH = Math.max(22, Math.round(ih * 0.12 * factor));
  const nameLines = textWidth(name, nameH * 0.92) > titleW ? 2 : 1;
  let y = y0 + hh + 4;
  text(x0 + pad, y, nameH, name, { width: titleW, align: "C", lines: nameLines });
  y += nameH * nameLines + 6;
  const subH = Math.max(16, Math.round(ih * 0.048));
  text(x0 + pad, y, subH, fmt.subtitle, { width: titleW, align: "C" });
  y += subH + 6;
  if (label.reference) {
    const ref = `REF: ${label.reference.toUpperCase()}`;
    const refH = fitFont(ref, titleW, Math.max(16, Math.round(ih * 0.052)), 14);
    text(x0 + pad, y, refH, ref, { width: titleW, align: "C" });
    y += refH + 6;
  }

  // Pie: línea, reclamo y dirección a la izquierda, código grande a la derecha.
  const fh = Math.round(ih * 0.17);
  const yF = y0 + ih - fh;
  box(x0 + pad, yF, iw - 2 * pad, 3, 3);
  const claimW = Math.round(iw * 0.56);
  const clH = Math.max(12, Math.min(20, Math.round(ih * 0.026)));
  FOOTER.forEach((line, i) => text(x0 + pad, yF + 10 + i * (clH + 4), fitFont(line, claimW, clH, 10), line));
  const codeW = iw - 2 * pad - claimW;
  const codeH = fitFont(label.code, codeW, Math.max(24, Math.round(ih * 0.08)), 18);
  text(x0 + iw - pad - codeW, yF + 8, clH, "CODIGO PRODUCTO", { width: codeW, align: "R" });
  text(x0 + iw - pad - codeW, yF + 8 + clH + 6, codeH, label.code, { width: codeW, align: "R" });

  // Cuerpo: datos a la izquierda, QR a la derecha.
  const yB = y + 4;
  const bodyH = Math.max(40, yF - yB - 6);
  const modules = qrModules(label.qrContent.length);
  const mag = Math.max(2, Math.min(10, Math.floor(Math.min(bodyH, iw * 0.26) / modules)));
  const qrPx = modules * mag;
  const qrX = x0 + iw - pad - qrPx;
  out.push(`^FO${qrX},${Math.round(yB + (bodyH - qrPx) / 2)}^BQN,2,${mag}^FDLA,${zplText(label.qrContent)}^FS`);

  const fields: { text: string; wide?: boolean }[] = [
    { text: `FECHA: ${labelDateText(label.date)}` },
    ...(fmt.cantPaca ? [{ text: `${fmt.cantPaca}: ${label.cantPaca ?? "______"}` }] : []),
    { text: `${fmt.weightLabel}: ${kgText(label.weightKg) || "______"}` },
    { text: `COLOR: ${(label.color ?? "").toUpperCase() || "______"}` },
    { text: `OP: ${label.orderNumber}` },
    ...(label.ticket ? [{ text: `TIQUETE: ${label.ticket}` }] : []),
    ...(label.clientName ? [{ text: `CLIENTE: ${label.clientName.toUpperCase()}`, wide: true }] : []),
  ];
  const fieldsW = qrX - (x0 + pad) - pad;
  const cols = fieldsW >= 400 ? 2 : 1;
  const colW = cols === 2 ? (fieldsW - pad) / 2 : fieldsW;
  // Filas: los campos de 2 columnas van de a pares; los "anchos" ocupan una fila.
  const rows: { text: string; wide?: boolean }[][] = [];
  for (const f of fields) {
    const last = rows[rows.length - 1];
    if (!f.wide && cols === 2 && last && last.length === 1 && !last[0].wide) last.push(f);
    else rows.push([f]);
  }
  let fH = Math.max(14, Math.min(30, Math.round(ih * 0.045)));
  while (fH > 12 && rows.length * fH * 1.35 > bodyH) fH -= 1;
  const rowH = fH * 1.35;
  const fy = yB + Math.max(0, (bodyH - rows.length * rowH) / 2);
  rows.forEach((row, r) =>
    row.forEach((f, c) => {
      const w = f.wide ? fieldsW : colW;
      text(x0 + pad + c * (colW + pad), fy + r * rowH, fH, truncate(f.text, w, fH * 0.92));
    })
  );

  out.push("^PQ1", "^XZ");
  return out.join("\n");
}

/** Datos de la etiqueta de un rollo a partir de su OP y su fila (mismo criterio que rollLabelFromOrder del cliente). */
export function labelDataFromRoll(
  order: {
    orderNumber: string;
    station: string | null;
    specs: unknown;
    product: { name: string; measure: string | null; measureUnit: string | null; calibre: string | null; color: string | null };
    client: { name: string } | null;
  },
  roll: { weightKg: unknown; details: unknown; date: Date; label: string | null },
  code: string,
  possessionToken: string
): LabelData {
  const station = (order.station ?? "extrusion") as LabelStation;
  const details = roll.details && typeof roll.details === "object" ? (roll.details as Record<string, unknown>) : {};
  const specs = order.specs && typeof order.specs === "object" ? (order.specs as Record<string, unknown>) : {};
  const str = (v: unknown) => (v == null || v === "" ? null : String(v));
  let weight = Number(roll.weightKg);
  if ((station === "sellado" || station === "embobinado") && Number(details.pBulto) > 0) weight = Number(details.pBulto);
  if (station === "precorte" && Number(details.pesoR2) > 0) weight += Number(details.pesoR2);
  return {
    station,
    code,
    qrContent: `${code}-${possessionToken}`,
    orderNumber: order.orderNumber,
    productName: order.product.name,
    reference: productReference(order.product),
    color: str(details.color) ?? str(specs.color) ?? order.product.color,
    weightKg: Number.isFinite(weight) ? Math.round(weight * 100) / 100 : null,
    date: roll.date,
    cantPaca: str(details.paqXUnid) ?? str(specs.unidadesSellado) ?? str(specs.unidadesEmbobinado),
    clientName: order.client?.name ?? null,
    ticket: station === "extrusion" && roll.label && roll.label !== code ? roll.label : null,
  };
}

const UNIT_SHORT: Record<string, string> = { Pulgadas: "pulg", "Cms.": "cm" };

/** "55x70 cm · cal 2.5" (mismo formato que productMeasure/productCalibre del cliente). */
export function productReference(p: { measure: string | null; measureUnit: string | null; calibre: string | null }): string {
  const m = p.measure?.trim() ?? "";
  const unit = p.measureUnit ? UNIT_SHORT[p.measureUnit] ?? p.measureUnit : "";
  const measure = m ? (unit && !/[a-zA-Z"]\s*$/.test(m) ? `${m} ${unit}` : m) : "";
  const c = p.calibre?.trim() ?? "";
  const calibre = c ? (/^cal/i.test(c) ? c : `cal ${c}`) : "";
  return [measure, calibre].filter(Boolean).join(" - ");
}

/** Etiqueta de muestra (la de su papel), para la prueba de impresión. */
export function sampleLabelData(station: LabelStation): LabelData {
  return {
    station,
    code: "PRUEBA",
    qrContent: "PRUEBA-IMPRESION-SAT-TT460",
    orderNumber: "OP-PRUEBA",
    productName: "Bolsa basura",
    reference: "55x70 cm - cal 2.5",
    color: "Negro",
    weightKg: 12.5,
    date: new Date(),
    cantPaca: "50",
    clientName: "Cliente de prueba",
  };
}
