import { describe, it, expect } from "vitest";
import { nameWithMeasure, productMeasure } from "../../client/src/lib/productMeasure";

describe("medida del producto en selectores y listas", () => {
  it("agrega la unidad corta a la medida", () => {
    expect(productMeasure({ measure: "8+2.5+5.5x16", measureUnit: "Pulgadas" })).toBe("8+2.5+5.5x16 pulg");
    expect(productMeasure({ measure: "20x30", measureUnit: "Cms." })).toBe("20x30 cm");
  });

  it("no repite la unidad si ya está escrita y deja la medida sola si no hay unidad", () => {
    expect(productMeasure({ measure: "20x30cm", measureUnit: "Cms." })).toBe("20x30cm");
    expect(productMeasure({ measure: "12+3+3x26", measureUnit: null })).toBe("12+3+3x26");
  });

  it("nombre con medida, o solo el nombre si no tiene", () => {
    expect(nameWithMeasure({ name: "Bolsa manigueta", measure: "12+3+3x26", measureUnit: "Pulgadas" })).toBe("Bolsa manigueta · 12+3+3x26 pulg");
    expect(nameWithMeasure({ name: "Bolsa manigueta", measure: "  ", measureUnit: "Pulgadas" })).toBe("Bolsa manigueta");
    expect(nameWithMeasure({ name: "Bolsa manigueta" })).toBe("Bolsa manigueta");
  });
});
