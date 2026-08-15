import PDFDocument from "pdfkit";

export const COMPANY = "Plásticos Superior S.A.S.";
const BRAND = "#1e293b"; // slate-800, mismo tono que Excel/UI
const MUTED = "#64748b";

export interface PdfItem {
  producto: string;
  cantidad: number;
  unitario: number;
  medida?: string | null;
}

export interface PdfDocumentOptions {
  /** Ej. "Factura" / "Cotización". */
  kind: string;
  /** Ej. "FAC-00001". */
  number: string;
  cliente: string;
  fecha: Date;
  items: PdfItem[];
  /** Líneas libres debajo del cliente (ej. "Vence: ...", "Válida hasta: ..."). */
  metaLines?: string[];
  /** Líneas de totales/pagos, mostradas alineadas a la derecha debajo de la tabla. */
  totalLines?: { label: string; value: string; emphasis?: boolean }[];
  /** Sello de alerta (ej. "VENCIDA") en la esquina superior derecha. */
  stamp?: string;
  notes?: string | null;
}

function formatCOP(n: number) {
  return `$${Math.round(n).toLocaleString("es-CO")}`;
}

/** Arma un PDF simple de una página para un documento comercial puntual
 * (factura o cotización) — encabezado de marca, tabla de ítems, totales.
 * Reusado por facturas.ts y cotizaciones.ts. */
export function buildDocumentPdf(options: PdfDocumentOptions): PDFKit.PDFDocument {
  const doc = new PDFDocument({ size: "A4", margin: 50 });

  if (options.stamp) {
    doc.save();
    doc.fontSize(12).fillColor("#e11d48").text(options.stamp.toUpperCase(), 400, 50, { width: 145, align: "right" });
    doc.restore();
  }

  doc.fontSize(18).fillColor(BRAND).text(COMPANY, 50, 50);
  doc.fontSize(10).fillColor(MUTED).text("Sistema ERP/MES", 50, 72);

  doc.fontSize(14).fillColor(BRAND).text(`${options.kind} ${options.number}`, 50, 100);
  doc.fontSize(10).fillColor(MUTED).text(`Fecha: ${options.fecha.toLocaleDateString("es-CO")}`, 50, 120);
  doc.fontSize(11).fillColor("#1e293b").text(`Cliente: ${options.cliente}`, 50, 138);

  let y = 156;
  for (const line of options.metaLines ?? []) {
    doc.fontSize(10).fillColor(MUTED).text(line, 50, y);
    y += 16;
  }

  y += 10;
  const colX = { producto: 50, cantidad: 300, medida: 360, unitario: 420, subtotal: 490 };
  const PRODUCTO_WIDTH = colX.cantidad - colX.producto - 10;
  const PAGE_BOTTOM = doc.page.height - doc.page.margins.bottom;

  function drawTableHeader(atY: number) {
    doc.rect(50, atY, 495, 20).fill(BRAND);
    doc
      .fillColor("#ffffff")
      .fontSize(9)
      .text("Producto", colX.producto + 5, atY + 6)
      .text("Cantidad", colX.cantidad, atY + 6)
      .text("Medida", colX.medida, atY + 6)
      .text("Precio unit.", colX.unitario, atY + 6)
      .text("Subtotal", colX.subtotal, atY + 6);
    return atY + 20;
  }

  y = drawTableHeader(y);

  doc.fillColor("#1e293b").fontSize(9);
  for (const item of options.items) {
    const subtotal = item.cantidad * item.unitario;
    // Alto real de la fila según cuánto ocupe el nombre del producto (puede
    // envolver a más de una línea) — sin esto, un nombre largo pisaba la
    // fila siguiente porque el alto estaba fijo en 20.
    const rowHeight = Math.max(20, doc.heightOfString(item.producto, { width: PRODUCTO_WIDTH }) + 8);

    if (y + rowHeight > PAGE_BOTTOM) {
      doc.addPage();
      y = drawTableHeader(50);
      doc.fillColor("#1e293b").fontSize(9);
    }

    doc
      .text(item.producto, colX.producto + 5, y + 6, { width: PRODUCTO_WIDTH })
      .text(String(item.cantidad), colX.cantidad, y + 6)
      .text(item.medida ?? "—", colX.medida, y + 6)
      .text(formatCOP(item.unitario), colX.unitario, y + 6)
      .text(formatCOP(subtotal), colX.subtotal, y + 6);
    y += rowHeight;
    doc.moveTo(50, y).lineTo(545, y).strokeColor("#e2e8f0").stroke();
  }

  const totalLines = options.totalLines ?? [];
  const totalsHeight = 15 + totalLines.reduce((sum, l) => sum + (l.emphasis ? 18 : 15), 0);
  if (y + totalsHeight > PAGE_BOTTOM) {
    doc.addPage();
    y = 50;
  }

  y += 15;
  for (const line of totalLines) {
    doc
      .fontSize(line.emphasis ? 12 : 10)
      .fillColor(line.emphasis ? BRAND : "#334155")
      .text(`${line.label}: ${line.value}`, 350, y, { width: 195, align: "right" });
    y += line.emphasis ? 18 : 15;
  }

  if (options.notes) {
    if (y + 30 > PAGE_BOTTOM) {
      doc.addPage();
      y = 50;
    }
    y += 15;
    doc.fontSize(9).fillColor(MUTED).text(`Notas: ${options.notes}`, 50, y, { width: 495 });
  }

  doc.end();
  return doc;
}

/** Junta los chunks del stream de pdfkit en un Buffer único para responder
 * con `res.send()`. Hay que llamarla enseguida de `buildDocumentPdf()` (los
 * listeners se enganchan antes de que el stream empiece a emitir). */
export function pdfToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

export { formatCOP };
