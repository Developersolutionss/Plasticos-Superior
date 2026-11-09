import { describe, it, expect } from "vitest";
import { matchesProductSearch } from "../../client/src/lib/productSearch";

const bolsa = { sku: "BUL-008", name: "Bolsa baja densidad", measure: "5x10", measureUnit: "Pulgadas", calibre: "0.7", color: "Blanco", densidad: "BAJA" };

describe("buscador de productos", () => {
  it("sin texto muestra todo", () => {
    expect(matchesProductSearch(bolsa, "")).toBe(true);
    expect(matchesProductSearch(bolsa, "   ")).toBe(true);
  });

  it("busca por código, nombre, medida, calibre, color y categoría, sin mayúsculas ni tildes", () => {
    expect(matchesProductSearch(bolsa, "bul-008")).toBe(true);
    expect(matchesProductSearch(bolsa, "BOLSA")).toBe(true);
    expect(matchesProductSearch(bolsa, "5x10")).toBe(true);
    expect(matchesProductSearch(bolsa, "cal 0.7")).toBe(true);
    expect(matchesProductSearch(bolsa, "blanco")).toBe(true);
    expect(matchesProductSearch(bolsa, "pulg")).toBe(true);
    expect(matchesProductSearch(bolsa, "bultos", "Bultos")).toBe(true);
    expect(matchesProductSearch({ name: "Lámina separadora" }, "lamina")).toBe(true);
  });

  it("varias palabras: tienen que estar todas", () => {
    expect(matchesProductSearch(bolsa, "bolsa 5x10 blanco")).toBe(true);
    expect(matchesProductSearch(bolsa, "bolsa 5x10 negro")).toBe(false);
    expect(matchesProductSearch(bolsa, "5 x 10")).toBe(true);
  });
});
