import { describe, expect, it } from "vitest";
import { catalogIssues, duplicateNameIds } from "../../client/src/lib/catalogIssues";

const ok = { unitPrice: 1000 };

describe("catalogIssues", () => {
  it("densidad del nombre contra el campo", () => {
    expect(catalogIssues({ ...ok, name: "Rollo de ALTA DENSIDAD", densidad: "BAJA" })).toEqual([
      "El nombre dice ALTA DENSIDAD pero la Densidad es BAJA.",
    ]);
    expect(catalogIssues({ ...ok, name: "Rollo densidad baja", densidad: "" })).toEqual(["El nombre dice BAJA DENSIDAD pero la Densidad está vacía."]);
    expect(catalogIssues({ ...ok, name: "Rollo de alta densidad", densidad: "ALTA" })).toEqual([]);
  });

  it("color del nombre contra el campo, sin adivinar si el nombre trae dos colores", () => {
    expect(catalogIssues({ ...ok, name: "Bolsa blanca", color: "Negro" })).toEqual(["El nombre dice blanco pero el Color es Negro."]);
    expect(catalogIssues({ ...ok, name: "ROLLO TRASPARENTE", color: "Transparente" })).toEqual([]);
    expect(catalogIssues({ ...ok, name: "Bolsa verde claro", color: "Verde claro" })).toEqual([]);
    expect(catalogIssues({ ...ok, name: "Bolsa blanca con impresión roja", color: "Negro" })).toEqual([]);
    expect(catalogIssues({ ...ok, name: "Bolsa manigueta pequeña impresa", color: "Blanco" })).toEqual([]);
  });

  it("medida sin unidad o con unidad contraria", () => {
    expect(catalogIssues({ ...ok, name: "Bolsa", measure: "8+2.5+5.5x16", measureUnit: "" })).toEqual([
      "Hay medida pero falta la Unidad de medida (pulgadas o cms).",
    ]);
    expect(catalogIssues({ ...ok, name: "Bolsa", measure: "20x30cm", measureUnit: "Pulgadas" })).toEqual([
      "La medida dice cm pero la Unidad de medida es Pulgadas.",
    ]);
    expect(catalogIssues({ ...ok, name: "Bolsa", measure: "12+3+3x26", measureUnit: "Pulgadas" })).toEqual([]);
  });

  it("precio en cero", () => {
    expect(catalogIssues({ name: "Bolsa", unitPrice: "0" })).toEqual(["El precio está en 0: saldría en cero en cotizaciones y facturas."]);
  });
});

describe("duplicateNameIds", () => {
  it("marca nombres repetidos entre productos activos, sin importar mayúsculas ni tildes", () => {
    const ids = duplicateNameIds([
      { id: 1, name: "Bolsa Pequeña", active: true },
      { id: 2, name: "bolsa  pequena", active: true },
      { id: 3, name: "Bolsa pequeña", active: false },
      { id: 4, name: "Otra", active: true },
    ]);
    expect([...ids].sort()).toEqual([1, 2]);
  });
});
