import { test, expect } from "./support/fixtures";
import { detalleOp, exito, idProducto } from "./support/api";
import { RegistroDeRollos, botonEtiquetaLista, imagenDeLaEtiquetaImpresa } from "./support/registroRollos";

async function stockDe(codigo: string): Promise<number> {
  const stock = await exito<{ code: string; currentStock: number }[]>("planeacion", "GET", "/raw-materials/stock");
  return Number(stock.find((m) => m.code === codigo)?.currentStock);
}

async function stockProducto(sku: string): Promise<number> {
  const inventario = await exito<{ sku: string; currentStock: number }[]>("despacho", "GET", "/inventory");
  return Number(inventario.find((p) => p.sku === sku)?.currentStock);
}

// El ciclo completo del negocio con personas distintas y cámara:
// Gestión crea la OP y la libera → Extrusión carga y cierra → el rollo viaja
// a Sellado → Sellado lo escanea y lo consume por kilos → Calidad aprueba y
// el producto entra a inventario.
test.describe("flujo completo de producción", () => {
  test("de la OP creada al lote aprobado en Calidad", async ({ sesion }, info) => {
    test.setTimeout(180_000);
    const movil = info.project.name === "movil";
    const materiaAntes = await stockDe("BAJA");
    const productoAntes = await stockProducto("ROL-PL-001");

    // 1. Gestión crea la OP desde la pantalla y la deriva a Extrusión.
    const gestion = await sesion("produccion", "/produccion/ordenes");
    await gestion.page.locator("form select").first().selectOption(String(await idProducto()));
    await gestion.page.getByPlaceholder("Cantidad planificada (kg)").fill("100");
    await gestion.page.getByRole("button", { name: "Crear OP y abrir su hoja" }).click();
    await expect(gestion.page).toHaveURL(/\/produccion\/ordenes\/\d+$/);
    const opId = Number(gestion.page.url().split("/").pop());
    await gestion.page.getByRole("button", { name: "Derivar a Extrusión" }).click();

    // 2. No se libera con cambios sin guardar, ni sin la fórmula de materia prima;
    //    con la hoja guardada y la fórmula al 100% sí.
    const liberar = gestion.page.getByRole("button", { name: "Liberar a planta" });
    await liberar.click();
    await expect(gestion.page.getByText(/antes de liberar la OP/)).toBeVisible();
    await gestion.page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(gestion.page.getByText("Cambios guardados.")).toBeVisible();
    await liberar.click();
    await gestion.page.getByRole("button", { name: "Liberar", exact: true }).click();
    await expect(gestion.page.getByText(/Cargá la fórmula de materia prima/)).toBeVisible();
    await gestion.page.getByRole("row").filter({ hasText: /^BAJA/ }).locator('input[type="number"]').fill("100");
    await gestion.page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(gestion.page.getByText("Cambios guardados.")).toBeVisible();
    await liberar.click();
    await gestion.page.getByRole("button", { name: "Liberar", exact: true }).click();
    await expect.poll(async () => (await detalleOp(opId)).status).toBe("pendiente");

    // 3. El operario de Extrusión arma el lote: se equivoca, corrige y sobra una fila.
    const extrusion = await sesion("extrusion", `/produccion/ordenes/${opId}`);
    const registro = new RegistroDeRollos(extrusion.page, movil);
    await registro.completar({ "PESO (KG)": 30 });
    await registro.anadir();
    await registro.completar({ "PESO (KG)": 99 });
    await registro.anadir();
    await expect(registro.textoDePendiente(2)).toContainText("Peso 99 kg");
    await registro.editarPendiente(2);
    await registro.completar({ "PESO (KG)": 25 });
    await registro.anadir();
    await registro.completar({ "PESO (KG)": 10 });
    await registro.anadir();
    await registro.quitarPendiente(3);
    await expect(registro.textoDePendiente(2)).toContainText("Peso 25 kg");
    await expect(registro.textoDePendiente(3)).toHaveCount(0);
    await registro.confirmar(2);
    await expect(extrusion.page.getByText("Se confirmaron 2 rollos.")).toBeVisible();

    // 4. Cierra la OP: Extrusión no pasa por Calidad y descuenta materia prima (55 kg de BAJA).
    await extrusion.page.getByRole("button", { name: "Cerrar OP" }).click();
    await extrusion.page.getByRole("button", { name: "Cerrar OP" }).last().click();
    await expect.poll(async () => (await detalleOp(opId)).status).toBe("finalizada");
    expect(await stockDe("BAJA")).toBe(materiaAntes - 55);

    // 5. Gestión deriva a Sellado.
    await gestion.page.goto(`/produccion/ordenes/${opId}`);
    await gestion.page.getByRole("button", { name: "Derivar a Sellado" }).click();
    await expect(gestion.page).toHaveURL(new RegExp(`/produccion/ordenes/(?!${opId}$)\\d+$`));
    const selladoId = Number(gestion.page.url().split("/").pop());

    // 6. El rollo de 30 kg viaja a la bodega de Sellado (etiqueta impresa → cámara).
    const codigos = await extrusion.page.getByRole("button", { name: /^EXT-\d+$/ }).allTextContents();
    expect(codigos).toHaveLength(2);
    const etiquetaA = await imagenDeLaEtiquetaImpresa(extrusion.page, botonEtiquetaLista(extrusion.page, codigos[0]));

    const sellado = await sesion("sellado", "/produccion/despacho-bodegas");
    const escanearRollo = sellado.page.getByRole("button", { name: /Escanear rollo/ });
    await escanearRollo.click();
    await sellado.camara.mostrarImagen(etiquetaA);
    await sellado.page.getByRole("button", { name: "Registrar salida a Sellado" }).click();
    await expect(sellado.page.getByText(/despachado a Sellado con 30 kg/)).toBeVisible();
    await escanearRollo.click();
    await sellado.camara.mostrarImagen(etiquetaA);
    await sellado.page.getByRole("button", { name: "Confirmar recepción en Sellado" }).click();
    await expect(sellado.page.getByText(/recibido en la bodega de Sellado/)).toBeVisible();

    // 7. Sellado escanea el rollo madre con la cámara y lo consume por kilos (30 → 20 → 12).
    await sellado.page.goto(`/produccion/ordenes/${selladoId}`);
    const registroSellado = new RegistroDeRollos(sellado.page, movil);
    await sellado.page.getByTitle(/^Escan/).click();
    await sellado.camara.mostrarImagen(etiquetaA);
    await expect(sellado.page.getByText(/quedan\s*30 kg/).filter({ visible: true }).first()).toBeVisible();
    await registroSellado.completar({ "PESO (KG)": 10 });
    await registroSellado.anadir();
    await expect(sellado.page.getByText(/quedan\s*20 kg/).filter({ visible: true }).first()).toBeVisible();
    await registroSellado.completar({ "PESO (KG)": 8 });
    await registroSellado.anadir();
    await registroSellado.confirmar(2);
    await expect(sellado.page.getByText("Se confirmaron 2 rollos.")).toBeVisible();
    await sellado.page.getByRole("button", { name: "Cerrar OP" }).click();
    await sellado.page.getByRole("button", { name: "Cerrar OP" }).last().click();
    await expect.poll(async () => (await detalleOp(selladoId)).status).toBe("pendiente_calidad");
    expect(await stockProducto("ROL-PL-001")).toBe(productoAntes);

    // 8. Calidad aprueba: el producto entra a inventario con la suma de kilos de los rollos.
    const calidad = await sesion("calidad", "/calidad");
    const numero = (await detalleOp(selladoId)).orderNumber as string;
    await calidad.page.getByRole("row").filter({ hasText: numero }).getByRole("button", { name: "Aprobar" }).click();
    await expect.poll(async () => (await detalleOp(selladoId)).status).toBe("finalizada");
    expect(await stockProducto("ROL-PL-001")).toBe(productoAntes + 18);
  });
});
