import { describe, expect, it } from "vitest";
import { splitScannedCode } from "../../client/src/lib/rollQr";

describe("splitScannedCode", () => {
  it("separa código y token del QR", () => {
    expect(splitScannedCode("EXT-9-K7M9XT4P2R6HW3JC")).toEqual({ code: "EXT-9", token: "K7M9XT4P2R6HW3JC" });
  });

  it("pasa a mayúsculas lo tipeado a mano en minúscula", () => {
    expect(splitScannedCode("ext-9-k7m9xt4p2r6hw3jc")).toEqual({ code: "EXT-9", token: "K7M9XT4P2R6HW3JC" });
    expect(splitScannedCode("sell-3")).toEqual({ code: "SELL-3", token: "" });
  });

  it("sin token devuelve token vacío", () => {
    expect(splitScannedCode("EXT-9")).toEqual({ code: "EXT-9", token: "" });
  });

  it("no toca un código que no es de rollo", () => {
    expect(splitScannedCode("abc")).toEqual({ code: "abc", token: "" });
  });
});
