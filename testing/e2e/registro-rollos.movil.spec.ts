import { test, expect } from "./support/fixtures";
import { cargarRollo, crearOpExtrusionLiberada } from "./support/api";
import { RegistroDeRollos } from "./support/registroRollos";

// El operario trabaja en el celular, parado frente a la máquina. Estas pruebas
// corren con un Pixel 7 emulado (pantalla táctil de 412 px): se ve el diseño
// de tarjetas, no la tabla de escritorio.
test.describe("registro de rollos en el celular", () => {
  test("los campos automáticos llevan candado, los que se llenan no, y nada se sale de la pantalla", async ({ sesion }) => {
    const op = await crearOpExtrusionLiberada({ kg: 100 });
    const { page } = await sesion("extrusion", `/produccion/ordenes/${op.id}`);
    const tarjeta = page.locator(".md\\:hidden.space-y-2.p-2");
    await tarjeta.waitFor();

    const etiqueta = (texto: string) => tarjeta.locator("span").filter({ hasText: new RegExp(`^\\s*${texto}\\s*$`) }).first();
    await expect(etiqueta("FECHA").locator('svg[class*="lucide-lock"]')).toHaveCount(1);
    await expect(etiqueta("HORA").locator('svg[class*="lucide-lock"]')).toHaveCount(1);
    await expect(etiqueta("PESO \\(KG\\)").locator('svg[class*="lucide-lock"]')).toHaveCount(0);

    const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(desborde, "la hoja no debe desplazarse horizontalmente en el celular").toBeLessThanOrEqual(1);
  });

  test("se arma un lote en el celular: añade, corrige, confirma y quedan las etiquetas listas", async ({ sesion }) => {
    const op = await crearOpExtrusionLiberada({ kg: 100 });
    const { page } = await sesion("extrusion", `/produccion/ordenes/${op.id}`);
    const registro = new RegistroDeRollos(page, true);

    await registro.completar({ "PESO (KG)": 20 });
    await registro.anadir();
    await registro.completar({ "PESO (KG)": 99 });
    await registro.anadir();
    await expect(registro.textoDePendiente(2)).toContainText("Peso 99 kg");

    await registro.editarPendiente(2);
    await registro.completar({ "PESO (KG)": 15 });
    await registro.anadir();
    await expect(registro.textoDePendiente(2)).toContainText("Peso 15 kg");

    await expect(registro.botonConfirmar(2)).toHaveAttribute("title", /ya no vas a poder editar los rollos, solo borrarlos/);
    await registro.confirmar(2);
    await expect(page.getByText("Se confirmaron 2 rollos.")).toBeVisible();
    await expect(page.getByText("Etiquetas listas para imprimir (2):")).toBeVisible();
  });

  test("Despacho a bodegas desde el celular: la cámara lee el QR y el operario se lleva el rollo", async ({ sesion }) => {
    const op = await crearOpExtrusionLiberada({ kg: 100 });
    const rollo = await cargarRollo(op.id, "extrusion", 22);
    const { page, camara } = await sesion("impresion", "/produccion/despacho-bodegas");

    await page.getByRole("button", { name: /Escanear rollo/ }).click();
    await camara.mostrarTexto(rollo.qr);
    await expect(page.getByText("Saldo: 22 kg")).toBeVisible();
    await page.getByRole("button", { name: "Registrar salida a Impresión" }).click();
    await expect(page.getByText(`Rollo ${rollo.codigo} despachado a Impresión con 22 kg`)).toBeVisible();

    const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(desborde).toBeLessThanOrEqual(1);
  });
});
