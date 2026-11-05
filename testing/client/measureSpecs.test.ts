import { describe, expect, it } from "vitest";
import { deriveSpecsFromMeasure } from "../../client/src/lib/measureSpecs";

describe("deriveSpecsFromMeasure", () => {
  it("una sola medida: solo el ancho", () => {
    expect(deriveSpecsFromMeasure("20")).toEqual({ ancho: "20" });
    expect(deriveSpecsFromMeasure(" 12,5 ")).toEqual({ ancho: "12,5" });
  });

  it("AxB: ancho y largo", () => {
    expect(deriveSpecsFromMeasure("20x30")).toEqual({ ancho: "20", medAncho: "20", medLargo: "30" });
    expect(deriveSpecsFromMeasure("20 X 30")).toEqual({ ancho: "20", medAncho: "20", medLargo: "30" });
  });

  it("AxB con un segundo número menor a 1 es el calibre", () => {
    expect(deriveSpecsFromMeasure("12x0.00045")).toEqual({ ancho: "12", calibre: "0.00045" });
  });

  it("bolsa con fuelles: ancho + fuelles x largo", () => {
    expect(deriveSpecsFromMeasure("8+2.5+5.5x16")).toEqual({ ancho: "8", medAncho: "8", medLargo: "16" });
    expect(deriveSpecsFromMeasure("8 + 2.5 x 16")).toEqual({ ancho: "8", medAncho: "8", medLargo: "16" });
  });

  it("texto sin número no precarga nada", () => {
    expect(deriveSpecsFromMeasure("")).toEqual({});
    expect(deriveSpecsFromMeasure("según muestra")).toEqual({});
  });
});
