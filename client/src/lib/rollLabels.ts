/**
 * Etiquetas de rollo (QR + código + "OP · producto · kg"). Mismo patrón que
 * printLabels en Productos.tsx: ventana nueva autocontenida + @media print,
 * escapando el texto interpolado y esperando a que los QR (data: URI)
 * terminen de decodificar antes de imprimir (si no, la primera impresión
 * sale con el QR vacío).
 */
export interface RollLabel {
  code: string;
  orderNumber: string;
  productName: string;
  weightKg: unknown;
  qrDataUrl: string;
  /** Número del tiquete físico del rollo (inventario inicial), si tiene. */
  ticket?: string | null;
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** HTML de la página de impresión (separado para poder probarlo). */
export function rollLabelsHtml(labels: RollLabel[]): string {
  const items = labels
    .map((label) => {
      const code = escapeHtml(label.code);
      const info = escapeHtml(`${label.orderNumber} · ${label.productName} · ${Number(label.weightKg)} kg`);
      const ticket = label.ticket ? `<p class="info">Tiquete ${escapeHtml(label.ticket)}</p>` : "";
      return `<div class="label">
          <img src="${label.qrDataUrl}" alt="QR ${code}" />
          <div class="text">
            <p class="code">${code}</p>
            <p class="info">${info}</p>
            ${ticket}
          </div>
        </div>`;
    })
    .join("\n");
  return `<!DOCTYPE html>
    <html>
      <head>
        <title>${labels.length === 1 ? "Etiqueta de rollo" : "Etiquetas de rollo"}</title>
        <style>
          * { box-sizing: border-box; }
          body { font-family: sans-serif; margin: 0; padding: 8mm; display: flex; flex-wrap: wrap; gap: 4mm; align-content: flex-start; }
          .label {
            width: 6cm; min-height: 4cm; height: auto;
            border: 1px dashed #999; border-radius: 3mm;
            padding: 3mm; display: flex; align-items: center; gap: 3mm;
            break-inside: avoid; page-break-inside: avoid;
          }
          .label img { width: 2.6cm; height: 2.6cm; flex-shrink: 0; }
          .label .text { overflow: hidden; min-width: 0; }
          .label .code { font-weight: bold; font-size: 12pt; margin: 0 0 2mm; overflow-wrap: anywhere; word-break: break-word; }
          .label .info { font-size: 8pt; margin: 0; color: #333; overflow-wrap: anywhere; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        ${items}
      </body>
    </html>`;
}

/** Abre la ventana de impresión con una o varias etiquetas. */
export function printRollLabels(labels: RollLabel[]) {
  if (labels.length === 0) return;
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(rollLabelsHtml(labels));
  win.document.close();

  let printed = false;
  const doPrint = () => {
    if (printed) return;
    printed = true;
    win.focus();
    win.print();
  };
  win.onload = doPrint;
  setTimeout(doPrint, 400 + labels.length * 50);
}

export function printRollLabel(label: RollLabel) {
  printRollLabels([label]);
}
