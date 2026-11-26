import { describe, it, expect } from "vitest";
import {
  LABEL_FORMATS,
  labelCells,
  labelDate,
  labelObservations,
  labelSheet,
  rollLabelFromOrder,
  rollLabelsHtml,
  type RollLabel,
} from "../../client/src/lib/rollLabels";

const base: RollLabel = {
  station: "precorte",
  code: "PRE-6354",
  qrDataUrl: "data:image/png;base64,AAA",
  orderNumber: "OP-00029",
  productName: "Bolsa basura",
  reference: "55x70 cm",
  color: "Negro",
  weightKg: 12.5,
  date: "2026-11-24T15:00:00",
  rollNumber: 12,
  calibre: "2.5",
  densidad: "Alta",
  operator: "Carlos",
  cantPaca: 50,
  clientName: "Agropecuaria La Sevillana",
};

describe("etiqueta de rollo/bulto (diseño de sus tiquetes de papel, 100 × 75 mm)", () => {
  it("todas son de 100 × 75 mm, el rollo que compraron: sin girar ni achicar", () => {
    for (const s of ["extrusion", "impresion", "precorte", "embobinado", "sellado"] as const) {
      expect(LABEL_FORMATS[s]).toMatchObject({ widthMm: 100, heightMm: 75 });
      expect(labelSheet(s)).toEqual({ widthMm: 100, heightMm: 75, rotated: false, scale: 1 });
    }
    const html = rollLabelsHtml([base]);
    expect(html).toContain("@page { size: 100mm 75mm; margin: 0; }");
    expect(html).not.toContain("rotate(90deg)");
    expect(html).not.toMatch(/transform: [^"]*scale\(/);
  });

  it("si el rollo cargado es otro, el diseño se achica y se centra", () => {
    const s = { sizeMode: "unico" as const, labelWidthMm: 80, labelHeightMm: 75, rotateWide: true, offsetXmm: 0, offsetYmm: 0 };
    expect(labelSheet("sellado", s)).toEqual({ widthMm: 80, heightMm: 75, rotated: false, scale: 0.8 });
    expect(rollLabelsHtml([base], "/l.png", s)).toContain("transform: translate(0mm, 7.5mm) scale(0.8)");
  });

  it("lleva lo del tiquete de papel: título, Nº con el lote, producto y REF, la cuadrícula, contacto con alimentos y la NOTA", () => {
    const html = rollLabelsHtml([base]);
    expect(html).toContain("MATERIAL PRECORTADO");
    expect(html).toContain("TUBULARES · BOLSAS · PRECORTADOS");
    expect(html).toContain("<b>PRE-6354</b><small>LOTE OP-00029</small>");
    expect(html).toContain("BOLSA BASURA · REF 55X70 CM");
    expect(html).toContain("EN ROLLO PRECORTE");
    expect(html).toContain("<small>FECHA:</small><b>24-11-26</b>");
    expect(html).toContain("<small>ROLLO Nº:</small><b>12</b>");
    expect(html).toContain("<small>CALIBRE:</small><b>2.5</b>");
    expect(html).toContain("<small>PESO NETO:</small><b>12,5 kg</b>");
    expect(html).toContain("<small>DENSIDAD:</small><b>ALTA</b>");
    expect(html).toContain("<small>OPERARIO:</small><b>CARLOS</b>");
    expect(html).toContain('<div class="c wide"><small>CLIENTE:</small><b>AGROPECUARIA LA SEVILLANA</b>');
    expect(html).toContain("CONTACTO CON ALIMENTOS Y BEBIDAS");
    expect(html).toContain("OBS: Cant. paca 50");
    expect(html).toContain("NOTA: Únicamente se aceptan devoluciones");
    expect(html).toContain("Carrera 44 No. 18-106");
  });

  it("lo que el sistema no sabe queda para completar a mano: peso bruto (línea) y contacto con alimentos (casillas vacías)", () => {
    const html = rollLabelsHtml([base]);
    expect(html).toContain('<small>PESO BRUTO:</small><span class="blank"></span>');
    expect(html).toMatch(/SI <span class="ck"><\/span> NO <span class="ck"><\/span>/);
    expect(rollLabelsHtml([{ ...base, foodContact: true }])).toMatch(/SI <span class="ck">X<\/span> NO <span class="ck"><\/span>/);
    expect(rollLabelsHtml([{ ...base, clientName: null }])).toContain("<b>STOCK (SIN CLIENTE)</b>");
  });

  it("el texto se escapa", () => {
    const html = rollLabelsHtml([{ ...base, productName: "<b>x</b>", operator: "<img>" }]);
    expect(html).toContain("&lt;B&gt;X&lt;/B&gt;");
    expect(html).not.toContain("<B>X</B>");
    expect(html).not.toContain("<IMG>");
  });

  it("Sellado: BULTO Nº, PAQ X UNID y PESO BULTO (el del bulto), y la cant. paca no se repite en OBS", () => {
    const order = {
      orderNumber: "OP-00012",
      station: "sellado",
      specs: { color: "Negro", calibre: "2.5", materialDensidad: "ALTA" },
      product: { name: "Bolsa basura", measure: "55x70", measureUnit: "Cms.", calibre: "1", color: null },
      client: { name: "KLISTO" },
    };
    const label = rollLabelFromOrder(
      order,
      { station: "sellado", weightKg: 30, details: { pBulto: 12.5, paqXUnid: "50" }, date: "2026-11-09T15:00:00", operatorName: "Ana" },
      "SELL-4",
      "data:x",
      3
    );
    expect(label).toMatchObject({
      station: "sellado",
      weightKg: 12.5,
      cantPaca: "50",
      color: "Negro",
      reference: "55x70 cm",
      calibre: "2.5",
      densidad: "ALTA",
      operator: "Ana",
      rollNumber: 3,
      clientName: "KLISTO",
      foodContact: null,
    });
    const cells = labelCells(label);
    expect(cells.map((c) => c.label)).toEqual(["FECHA", "COLOR", "BULTO Nº", "PAQ X UNID", "CALIBRE", "PESO BULTO", "DENSIDAD", "OPERARIO", "CLIENTE"]);
    expect(cells.find((c) => c.label === "PESO BULTO")?.value).toBe("12,5 kg");
    expect(labelObservations(label)).toBe("");
    expect(labelDate("2026-11-09T15:00:00")).toBe("09-11-26");
  });

  it("inventario inicial: el tiquete va en observaciones; la nota automática no", () => {
    const order = { orderNumber: "OP-1", station: "extrusion", product: { name: "Tubular" }, client: null };
    const l = rollLabelFromOrder(order, { station: "extrusion", weightKg: 49.8, label: "1023", notes: "Inventario inicial" }, "EXT-9", "data:x", 1);
    expect(labelObservations(l)).toBe("Tiquete 1023");
  });
});
