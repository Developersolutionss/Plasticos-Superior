import { test, expect } from "./support/fixtures";

// Valida el propio arnés: que la cámara emulada llegue al escáner real de la
// app y se decodifique un QR de verdad. Si esto falla, ningún flujo con
// cámara puede confiarse.
test.describe("cámara emulada", () => {
  test("el escáner de la app decodifica el QR que ve la cámara", async ({ sesion }) => {
    const { page, camara } = await sesion("produccion", "/produccion/inventario-bodegas");
    const errores: string[] = [];
    page.on("pageerror", (e) => errores.push(e.message));

    await page.getByRole("button", { name: /Escanear rollo/ }).click();
    await camara.mostrarTexto("EXT-1");

    // EXT-1 es el rollo demo que el seed deja en la bodega de Impresión.
    await expect(page.getByText("EXT-1 está en la bodega de Impresión")).toBeVisible();
    await page.waitForTimeout(1500);
    console.log("ESTADO CÁMARA:", JSON.stringify(await camara.estado()));
    console.log("ERRORES DE PÁGINA:", JSON.stringify(errores));
  });
});
