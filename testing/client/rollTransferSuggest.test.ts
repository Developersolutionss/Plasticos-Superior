import { describe, it, expect } from "vitest";
import { suggestDispatch } from "../../client/src/lib/rollTransferSuggest";

const EXT = ["impresion", "sellado", "precorte"] as const;

describe("suggestDispatch · qué se precarga al escanear un rollo para despacharlo", () => {
  it("el operario de una estación destino: su bodega y 'me lo llevo yo', aunque otra OP también lo espere", () => {
    expect(suggestDispatch({ destinations: [...EXT], expectingStations: ["precorte"] }, "sellado")).toEqual({ toStation: "sellado", mode: "retiro" });
  });

  it("una sola OP abierta esperándolo: esa, en modo entrega", () => {
    expect(suggestDispatch({ destinations: [...EXT], expectingStations: ["precorte"], materialPara: "sellado" }, "extrusion")).toEqual({
      toStation: "precorte",
      mode: "entrega",
    });
  });

  it("varias esperándolo: desempata 'Material para'; si no coincide con ninguna, no elige nada", () => {
    const info = { destinations: [...EXT], expectingStations: ["sellado", "precorte"] as ("sellado" | "precorte")[] };
    expect(suggestDispatch({ ...info, materialPara: "precorte" }, undefined).toStation).toBe("precorte");
    expect(suggestDispatch({ ...info, materialPara: "impresion" }, undefined).toStation).toBe("");
    expect(suggestDispatch({ ...info, materialPara: null }, undefined).toStation).toBe("");
  });

  it("ninguna esperándolo: 'Material para' si es destino posible, o el único destino", () => {
    expect(suggestDispatch({ destinations: [...EXT], expectingStations: [], materialPara: "impresion" }, undefined).toStation).toBe("impresion");
    expect(suggestDispatch({ destinations: ["sellado"], expectingStations: [] }, undefined).toStation).toBe("sellado");
    expect(suggestDispatch({ destinations: [...EXT], expectingStations: [] }, undefined)).toEqual({ toStation: "", mode: "entrega" });
  });

  it("ignora una estación esperando que no es destino posible (el rollo ya está ahí)", () => {
    expect(suggestDispatch({ destinations: ["impresion", "precorte"], expectingStations: ["sellado"] }, undefined).toStation).toBe("");
  });
});
