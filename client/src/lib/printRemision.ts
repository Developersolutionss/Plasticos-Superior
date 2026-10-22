/**
 * Remisión de despacho: el papel que va con el camión hasta el cliente
 * (cliente, dirección, contacto, qué productos y qué rollos salieron, con sus
 * kilos, y espacio para las firmas). Se arma con el detalle del despacho
 * (GET /dispatches/:id) en una ventana nueva y se imprime desde el
 * navegador, igual que las etiquetas de rollo.
 */
function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString("es-CO");

export function remisionHtml(d: any): string {
  const e = (v: unknown) => escapeHtml(String(v ?? ""));
  const address = d.client?.addresses?.[0];
  const contact = d.client?.contacts?.[0];
  const sent = (d.items ?? []).filter((i: any) => i.quantityDispatched != null);
  const pending = (d.items ?? []).filter((i: any) => i.quantityDispatched == null);
  const date = d.dispatchedDate ?? new Date().toISOString();

  const rows = sent
    .map((i: any) => {
      const rolls = (i.rolls ?? []).map((r: any) => `${e(r.code)} (${fmt(Number(r.weightKg))} kg)`).join(", ");
      return `<tr>
        <td>${e(i.product.sku)}</td>
        <td>${e(i.product.name)}${rolls ? `<div class="rolls">Rollos: ${rolls}</div>` : ""}</td>
        <td class="num">${fmt(Number(i.quantityDispatched))} ${e(i.product.unit)}</td>
        <td class="num">${(i.rolls ?? []).length || "—"}</td>
      </tr>`;
    })
    .join("");
  const totalRolls = sent.reduce((acc: number, i: any) => acc + (i.rolls ?? []).length, 0);
  const totalKg = sent.filter((i: any) => i.product.unit === "kg").reduce((acc: number, i: any) => acc + Number(i.quantityDispatched), 0);

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Remisión despacho #${e(d.id)}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: Arial, sans-serif; margin: 0; padding: 12mm; color: #111; font-size: 10pt; }
      header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 4mm; }
      h1 { font-size: 16pt; margin: 0; }
      .company { font-weight: bold; font-size: 12pt; }
      .meta { text-align: right; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm 8mm; margin: 5mm 0; }
      .label { font-size: 8pt; color: #555; text-transform: uppercase; }
      table { width: 100%; border-collapse: collapse; margin-top: 3mm; }
      th, td { border: 1px solid #999; padding: 2mm; text-align: left; vertical-align: top; }
      th { background: #eee; font-size: 9pt; }
      .num { text-align: right; white-space: nowrap; }
      .rolls { font-size: 8pt; color: #333; margin-top: 1mm; }
      .totals { margin-top: 3mm; text-align: right; font-weight: bold; }
      .pending { margin-top: 3mm; font-size: 9pt; color: #555; }
      .signatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10mm; margin-top: 22mm; }
      .signatures div { border-top: 1px solid #111; padding-top: 1mm; font-size: 9pt; text-align: center; }
      .transport { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; margin-top: 8mm; font-size: 9pt; }
      .transport span { display: inline-block; border-bottom: 1px solid #111; min-width: 55mm; }
      @media print { body { padding: 8mm; } }
    </style>
  </head>
  <body>
    <header>
      <div>
        <div class="company">Plásticos Superior S.A.S.</div>
        <h1>Remisión de despacho</h1>
      </div>
      <div class="meta">
        <div><strong>Despacho #${e(d.id)}</strong></div>
        <div>Fecha: ${e(new Date(date).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }))}</div>
        ${d.productionOrder ? `<div>OP: ${e(d.productionOrder.orderNumber)}</div>` : ""}
      </div>
    </header>
    <div class="grid">
      <div><div class="label">Cliente</div>${e(d.client?.name)}</div>
      <div><div class="label">Contacto</div>${contact ? `${e(contact.name)}${contact.phone ? ` · ${e(contact.phone)}` : ""}` : "—"}</div>
      <div><div class="label">Dirección de entrega</div>${address ? `${e(address.addressLine)}${address.city ? `, ${e(address.city)}` : ""}` : "—"}</div>
      <div><div class="label">Registró</div>${e(d.createdBy?.name ?? "—")}</div>
    </div>
    <table>
      <thead><tr><th>SKU</th><th>Producto</th><th class="num">Cantidad</th><th class="num">Rollos</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="4">Todavía no salió ningún ítem de este despacho.</td></tr>`}</tbody>
    </table>
    <div class="totals">Total: ${totalRolls} rollo${totalRolls === 1 ? "" : "s"}${totalKg ? ` · ${fmt(totalKg)} kg` : ""}</div>
    ${
      pending.length
        ? `<div class="pending">Pendiente por despachar: ${pending.map((i: any) => `${e(i.product.name)} ${fmt(Number(i.quantityRequested))} ${e(i.product.unit)}`).join("; ")}</div>`
        : ""
    }
    <div class="transport">
      <div>Transportador: <span></span></div>
      <div>Placa: <span></span></div>
    </div>
    <div class="signatures">
      <div>Entregó (Almacén)</div>
      <div>Transportador</div>
      <div>Recibió (cliente)</div>
    </div>
  </body>
</html>`;
}

export function printRemision(d: any) {
  const win = window.open("", "_blank");
  if (!win) return false;
  win.document.write(remisionHtml(d));
  win.document.close();
  win.focus();
  win.print();
  return true;
}
