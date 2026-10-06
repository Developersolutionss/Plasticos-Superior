import { test, expect } from "./support/fixtures";
import { cargarRollo, crearOpExtrusionLiberada, derivarOp, moverRolloA } from "./support/api";

// Trazabilidad por código: se escanea (o se escribe) el QR de un rollo, de
// una etiqueta de bulto o el número de una OP y la pantalla abre la OP
// correcta resaltando el rollo con todo su recorrido.
test.describe("trazabilidad con cámara", () => {
  /** Rollo madre de Extrusión que viaja a Sellado (pesado a 39.5 kg) y alimenta un rollo hijo de 15 kg. */
  async function cadenaConMadreEHijo() {
    const extrusion = await crearOpExtrusionLiberada({ kg: 200 });
    const madre = await cargarRollo(extrusion.id, "extrusion", 40);
    await moverRolloA(madre, "sellado", 39.5);
    const sellado = await derivarOp(extrusion.id, "sellado");
    const hijo = await cargarRollo(sellado.id, "sellado", 15, {
      sourceRollIds: [madre.id],
      sourceRollTokens: { [String(madre.id)]: madre.token },
    });
    return { extrusion, sellado, madre, hijo };
  }

  test("el QR del rollo madre abre su OP y muestra el despacho y el ajuste de saldo", async ({ sesion }) => {
    const { madre } = await cadenaConMadreEHijo();
    const { page, camara } = await sesion("produccion", "/trazabilidad");

    await page.getByTitle("Escanear el QR del rollo o de la etiqueta de bulto").click();
    await camara.mostrarTexto(madre.qr);

    const fila = page.locator("li").filter({ hasText: madre.codigo }).first();
    await expect(fila).toContainText("Despachado Extrusión → Sellado con 40 kg");
    await expect(fila).toContainText("recibió");
    await expect(fila).toContainText("39.5 kg");
    await expect(fila).toContainText("Saldo corregido al recibirlo: 40 → 39.5 kg");
  });

  test("el QR del rollo hijo muestra de qué rollo madre salió y cuántos kilos", async ({ sesion }) => {
    const { madre, hijo } = await cadenaConMadreEHijo();
    const { page, camara } = await sesion("auditor", "/trazabilidad");

    await page.getByTitle("Escanear el QR del rollo o de la etiqueta de bulto").click();
    await camara.mostrarTexto(hijo.qr);

    const fila = page.locator("li").filter({ hasText: hijo.codigo }).first();
    await expect(fila).toContainText(`Salió de: ${madre.codigo} (15 kg)`);
  });

  test("se busca por número de OP escribiendo, y un código que no existe avisa", async ({ sesion }) => {
    const { extrusion } = await cadenaConMadreEHijo();
    const { page, camara } = await sesion("produccion", "/trazabilidad");
    const campo = page.getByPlaceholder(/Código de rollo/);

    await campo.fill(extrusion.orderNumber);
    await page.getByRole("button", { name: "Buscar" }).click();
    await expect(page.getByText(extrusion.orderNumber).filter({ visible: true }).first()).toBeVisible();

    await page.getByTitle("Escanear el QR del rollo o de la etiqueta de bulto").click();
    await camara.mostrarTexto("EXT-99999-AAAAAAAAAAAAAAAA");
    await expect(page.getByText("No existe el rollo EXT-99999")).toBeVisible();
  });
});
