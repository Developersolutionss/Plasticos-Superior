import { describe, it, expect } from "vitest";
import { LABEL_FORMATS, labelDate, labelSheet, rollLabelFromOrder, rollLabelsHtml, type RollLabel } from "../../client/src/lib/rollLabels";

const base: RollLabel = {
  station: "precorte",
  code: "PRE-6354",
  qrDataUrl: "data:image/png;base64,AAA",
  orderNumber: "OP-00012",
  productName: "Bolsa basura",
  reference: "55x70 cm · cal 2.5",
  color: "Negro",
  weightKg: 12.5,
  date: "2026-11-09T15:00:00",
  cantPaca: 50,
};

describe("etiquetas por estación", () => {
  it("cada estación tiene su tamaño: Sellado 16×8, rollos 13×10, Embobinado 10×8", () => {
    expect(LABEL_FORMATS.sellado).toMatchObject({ widthMm: 160, heightMm: 80, subtitle: "BULTO SELLADO" });
    for (const s of ["extrusion", "impresion", "precorte"] as const) expect(LABEL_FORMATS[s]).toMatchObject({ widthMm: 130, heightMm: 100 });
    expect(LABEL_FORMATS.embobinado).toMatchObject({ widthMm: 100, heightMm: 80 });
    // La SAT TT460 imprime hasta 108 mm a lo ancho: las más anchas salen giradas.
    expect(labelSheet("sellado")).toEqual({ widthMm: 80, heightMm: 160, rotated: true });
    expect(labelSheet("precorte")).toEqual({ widthMm: 100, heightMm: 130, rotated: true });
    expect(labelSheet("embobinado")).toEqual({ widthMm: 100, heightMm: 80, rotated: false });
    expect(rollLabelsHtml([{ ...base, station: "sellado" }])).toContain("@page { size: 80mm 160mm; margin: 0; }");
    expect(rollLabelsHtml([{ ...base, station: "sellado" }])).toContain("transform: translateX(80mm) rotate(90deg)");
    expect(rollLabelsHtml([base])).toContain("@page { size: 100mm 130mm; margin: 0; }");
    expect(rollLabelsHtml([{ ...base, station: "embobinado" }])).toContain("@page { size: 100mm 80mm; margin: 0; }");
  });

  it("lleva los datos de la etiqueta de papel: producto, subtítulo, REF, fecha dd-mm-aa, cant. paca, peso, color y código", () => {
    const html = rollLabelsHtml([base]);
    expect(html).toContain("BOLSA BASURA");
    expect(html).toContain("EN ROLLO PRECORTE");
    expect(html).toContain("REF: <u>55X70 CM · CAL 2.5</u>");
    expect(html).toContain("<b>FECHA:</b> <span>09-11-26</span>");
    expect(html).toContain("<b>CANT PACA:</b> <span>50</span>");
    expect(html).toContain("<b>PESO:</b> <span>12,5 kg</span>");
    expect(html).toContain("<b>COLOR:</b> <span>NEGRO</span>");
    expect(html).toContain("<strong>PRE-6354</strong>");
    expect(html).toContain("SOMOS SUPERIOR");
  });

  it("un dato que falta queda como línea para escribir a mano; el texto se escapa", () => {
    const html = rollLabelsHtml([{ ...base, cantPaca: null, productName: "<b>x</b>" }]);
    expect(html).toContain('<b>CANT PACA:</b> <span><span class="blank"></span></span>');
    expect(html).toContain("&lt;B&gt;X&lt;/B&gt;");
    expect(html).not.toContain("<B>X</B>");
  });

  it("Sellado: el peso es el del bulto y la cantidad es PAQ X UNID", () => {
    const order = {
      orderNumber: "OP-00012",
      station: "sellado",
      specs: { color: "Negro" },
      product: { name: "Bolsa basura", measure: "55x70", measureUnit: "Cms.", calibre: "2.5", color: null },
      client: { name: "KLISTO" },
    };
    const label = rollLabelFromOrder(order, { weightKg: 30, details: { pBulto: 12.5, paqXUnid: "50" }, date: "2026-11-09T15:00:00" }, "SELL-4", "data:x");
    expect(label).toMatchObject({ station: "sellado", weightKg: 12.5, cantPaca: "50", color: "Negro", reference: "55x70 cm · cal 2.5", clientName: "KLISTO" });
    expect(labelDate("2026-11-09T15:00:00")).toBe("09-11-26");
  });
});
