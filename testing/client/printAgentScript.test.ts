import { describe, it, expect } from "vitest";
import { buildAgentScript, buildInstallerCmd, psString } from "../../client/src/lib/printAgentScript";

describe("puente de impresión (script de PowerShell)", () => {
  it("el nombre de la impresora no depende de la codificación ni puede cerrar la cadena", () => {
    expect(psString("SAT TT460 UE (203 dpi) (ZPL)")).toBe("'SAT TT460 UE (203 dpi) (ZPL)'");
    expect(psString("O'Brien")).toBe("'O''Brien'");
    // ñ, tildes y la comilla tipográfica (que PowerShell 5.1 toma como comilla) van como [char].
    expect(psString("Ñ’")).toBe("([char]0x00d1 + [char]0x2019)");
    expect(psString("")).toBe("''");
  });

  it("lleva servidor, token e impresora; cada etiqueta en su propio try y el instalador cierra los permisos", () => {
    const s = buildAgentScript({ server: "https://plasticos-superior.com/", token: "psa_abc", printerName: "SAT TT460" });
    expect(s).toContain("$Servidor  = 'https://plasticos-superior.com'");
    expect(s).toContain("$Token     = 'psa_abc'");
    expect(s).toContain("$Impresora = 'SAT TT460'");
    expect(s).toContain("icacls $Carpeta /inheritance:r");
    expect(s.indexOf("foreach ($job in @($r.jobs))")).toBeLessThan(s.indexOf("      try {"));
    expect(/[^\x00-\x7f]/.test(s)).toBe(false); // ASCII: PowerShell 5.1 lo lee bien con o sin BOM
    expect(s).toContain("\r\n");
    expect(buildInstallerCmd()).toContain("-Instalar");
  });
});
