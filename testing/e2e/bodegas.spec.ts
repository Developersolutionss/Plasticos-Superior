import { test, expect } from "./support/fixtures";
import { cargarRollo, crearOpExtrusionLiberada, exito, llamar, saldoDeRollo } from "./support/api";

// Despacho a bodegas e Inventario de bodegas, de punta a punta y con cámara:
// el rollo sale de Extrusión, lo retira un operario de Sellado, lo recibe
// pesándolo y Gestión lo ve (y lo cuenta) en el inventario.
test.describe("bodegas de planta", () => {
  test("un rollo viaja de Extrusión a Sellado: se retira, se recibe con peso y queda en el inventario", async ({ sesion }) => {
    const op = await crearOpExtrusionLiberada({ kg: 100 });
    const rollo = await cargarRollo(op.id, "extrusion", 25);

    // 1. Un operario de Sellado escanea el QR y se lo lleva.
    const sellado = await sesion("sellado", "/produccion/despacho-bodegas");
    const escanearSellado = sellado.page.getByRole("button", { name: /Escanear rollo/ });
    await escanearSellado.click();
    await sellado.camara.mostrarTexto(rollo.qr);
    await expect(sellado.page.getByText("Saldo: 25 kg")).toBeVisible();
    // La pantalla ya propone su propia bodega y "Me lo llevo yo".
    await expect(sellado.page.getByRole("button", { name: /^Sellado/ })).toHaveAttribute("aria-pressed", "true");
    await expect(sellado.page.getByLabel("Me lo llevo yo")).toBeChecked();
    await sellado.page.getByRole("button", { name: "Registrar salida a Sellado" }).click();
    await expect(sellado.page.getByText(`Rollo ${rollo.codigo} despachado a Sellado con 25 kg`)).toBeVisible();

    // 2. Un operario de otra estación lo ve en camino, pero no lo puede recibir.
    const extrusion = await sesion("extrusion", "/produccion/despacho-bodegas");
    await extrusion.page.getByRole("button", { name: /Escanear rollo/ }).click();
    await extrusion.camara.mostrarTexto(rollo.qr);
    await expect(extrusion.page.getByText(/En tránsito hacia/)).toBeVisible();
    await expect(extrusion.page.getByText("Lo tiene que recibir un operario de Sellado.")).toBeVisible();
    await expect(extrusion.page.getByRole("button", { name: /Confirmar recepción/ })).toHaveCount(0);

    // 3. Sellado lo recibe y lo pesa en la balanza: ese peso pasa a ser el saldo.
    await escanearSellado.click();
    await sellado.camara.mostrarTexto(rollo.qr);
    await expect(sellado.page.getByText(/En tránsito hacia/)).toBeVisible();
    await sellado.page.getByPlaceholder("Opcional", { exact: true }).fill("24.5");
    await sellado.page.getByRole("button", { name: "Confirmar recepción en Sellado" }).click();
    await expect(sellado.page.getByText(`Rollo ${rollo.codigo} recibido en la bodega de Sellado. Saldo del rollo: 24.5 kg`)).toBeVisible();
    expect(await saldoDeRollo(rollo.codigo)).toBe(24.5);

    // 4. Gestión lo ve en el inventario de bodegas y lo ajusta por conteo.
    const gestion = await sesion("produccion", "/produccion/inventario-bodegas");
    const fila = gestion.page.locator("li").filter({ hasText: rollo.codigo });
    await expect(fila).toContainText("24.5 kg");
    await expect(fila).toContainText("de 25 kg");
    await fila.getByText("Ajustar por conteo").click();
    await fila.getByLabel(`Peso contado de ${rollo.codigo}`).fill("24");
    await fila.getByRole("button", { name: "Guardar conteo" }).click();
    await expect(fila.getByText(new RegExp(`${rollo.codigo}: saldo 24.5 → 24 kg`))).toBeVisible();
    expect(await saldoDeRollo(rollo.codigo)).toBe(24);
  });

  test("un peso al recibir muy distinto (error de tipeo) no cambia el saldo y avisa a Gestión", async ({ sesion }) => {
    const op = await crearOpExtrusionLiberada({ kg: 100 });
    const rollo = await cargarRollo(op.id, "extrusion", 25);
    await exito("sellado", "POST", "/roll-transfers", {
      code: rollo.codigo,
      token: rollo.token,
      toStation: "sellado",
      mode: "retiro",
      clientTimezone: "America/Bogota",
      clientUtcOffsetMinutes: -300,
    });

    const sellado = await sesion("sellado", "/produccion/despacho-bodegas");
    await sellado.page.getByRole("button", { name: /Escanear rollo/ }).click();
    await sellado.camara.mostrarTexto(rollo.qr);
    await sellado.page.getByPlaceholder("Opcional", { exact: true }).fill("478");
    await sellado.page.getByRole("button", { name: "Confirmar recepción en Sellado" }).click();
    await expect(sellado.page.getByText(/NO se cambió el saldo, se le avisó a Gestión/)).toBeVisible();

    expect(await saldoDeRollo(rollo.codigo)).toBe(25);
    const { datos: avisos } = await llamar<{ message: string; type: string }[]>("produccion", "GET", "/notifications");
    expect(avisos.some((a) => a.type === "despacho_diferencia_peso" && a.message.includes(rollo.codigo))).toBe(true);
  });

  test("Ventas no ve las bodegas: el menú no las ofrece, la URL redirige y el API responde 403", async ({ sesion }) => {
    const { page } = await sesion("ventas", "/");
    await expect(page.getByRole("link", { name: "Inventario de bodegas" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Despacho a bodegas" })).toHaveCount(0);

    await page.goto("/produccion/inventario-bodegas");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Inventario de bodegas" })).toHaveCount(0);

    for (const ruta of ["/roll-transfers/inventory", "/roll-transfers"]) {
      expect((await llamar("ventas", "GET", ruta)).status).toBe(403);
    }
  });
});
