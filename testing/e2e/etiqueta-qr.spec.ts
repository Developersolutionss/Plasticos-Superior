import { test, expect } from "./support/fixtures";
import { cargarRollo, crearOpExtrusionLiberada, llamar } from "./support/api";
import { RegistroDeRollos, botonEtiquetaLista, imagenDeLaEtiquetaImpresa } from "./support/registroRollos";

// Regresión del bug de la etiqueta sin token (commit 5b11d07): la etiqueta
// que se imprimía llevaba solo el código del rollo (EXT-7) y no el token de
// posesión, así que al escanearla el servidor rechazaba el rollo en
// cualquier flujo que exige tenerlo en la mano. Estas pruebas cubren lo que
// los tests unitarios no pueden: que lo que IMPRIME la pantalla es
// exactamente lo que LEE la cámara y lo que ACEPTA el servidor.
test.describe("etiqueta con QR del rollo", () => {
  test("la etiqueta que imprime la app la lee la cámara y el servidor la acepta", async ({ sesion }, info) => {
    const op = await crearOpExtrusionLiberada({ kg: 100 });

    // 1. El operario de Extrusión carga y confirma un rollo en la hoja de la OP.
    const extrusion = await sesion("extrusion", `/produccion/ordenes/${op.id}`);
    const registro = new RegistroDeRollos(extrusion.page, info.project.name === "movil");
    await registro.cargarYConfirmar({ "PESO (KG)": 25 });
    await expect(extrusion.page.getByText("Se confirmaron 1 rollo.")).toBeVisible();
    await expect(extrusion.page.getByText("Etiquetas listas para imprimir (1):")).toBeVisible();

    // 2. Toca la etiqueta lista para imprimir y se abre la hoja a imprimir.
    const codigo = (await extrusion.page.getByText(/^EXT-\d+$/).first().textContent())?.trim() ?? "";
    const etiqueta = await imagenDeLaEtiquetaImpresa(extrusion.page, botonEtiquetaLista(extrusion.page, codigo));

    // 3. En la bodega de Impresión escanean ESA imagen con la cámara.
    const impresion = await sesion("impresion", "/produccion/despacho-bodegas");
    await impresion.page.getByRole("button", { name: /Escanear rollo/ }).click();
    await impresion.camara.mostrarImagen(etiqueta);

    await expect(impresion.page.getByText("Saldo: 25 kg")).toBeVisible();
    await expect(impresion.page.getByText(codigo, { exact: true }).first()).toBeVisible();
    await expect(impresion.page.getByText(/no trae el token|Falta demostrar posesión/)).toHaveCount(0);
  });

  test("sin token o con token falso el rollo se rechaza; con el verdadero pasa", async ({ sesion }) => {
    const op = await crearOpExtrusionLiberada({ kg: 100 });
    const rollo = await cargarRollo(op.id, "extrusion", 20);
    const { page, camara } = await sesion("impresion", "/produccion/despacho-bodegas");
    const escanear = page.getByRole("button", { name: /Escanear rollo/ });

    // Solo el código (como imprimía la etiqueta con el bug).
    await escanear.click();
    await camara.mostrarTexto(rollo.codigo);
    await expect(page.getByText(`El código ${rollo.codigo} no trae el token de posesión`)).toBeVisible();

    // Código correcto con un token inventado.
    await escanear.click();
    await camara.mostrarTexto(`${rollo.codigo}-AAAAAAAAAAAAAAAA`);
    await expect(page.getByText(`Falta demostrar posesión física del rollo ${rollo.codigo}`)).toBeVisible();

    // Con el token verdadero sí pasa: el rechazo era por el token, no por el rollo.
    await escanear.click();
    await camara.mostrarTexto(rollo.qr);
    await expect(page.getByText("Saldo: 20 kg")).toBeVisible();
    await expect(page.getByText(/Falta demostrar posesión|no trae el token/)).toHaveCount(0);
  });

  test("reemitir la etiqueta invalida la anterior y la nueva sí sirve", async ({ sesion }, info) => {
    const op = await crearOpExtrusionLiberada({ kg: 100 });
    const rollo = await cargarRollo(op.id, "extrusion", 30);

    // Gestión reemite desde la fila del rollo y se imprime la etiqueta nueva.
    const gestion = await sesion("produccion", `/produccion/ordenes/${op.id}`);
    const registro = new RegistroDeRollos(gestion.page, info.project.name === "movil");
    await registro.botonReemitir().click();
    await expect(gestion.page.getByText("¿Reemitir etiqueta?")).toBeVisible();
    const nueva = await imagenDeLaEtiquetaImpresa(gestion.page, gestion.page.getByRole("button", { name: "Aceptar" }));

    const { page, camara } = await sesion("impresion", "/produccion/despacho-bodegas");
    const escanear = page.getByRole("button", { name: /Escanear rollo/ });

    // La etiqueta física vieja ya no sirve.
    await escanear.click();
    await camara.mostrarTexto(rollo.qr);
    await expect(page.getByText(`Falta demostrar posesión física del rollo ${rollo.codigo}`)).toBeVisible();

    // La que se acaba de imprimir sí.
    await escanear.click();
    await camara.mostrarImagen(nueva);
    await expect(page.getByText("Saldo: 30 kg")).toBeVisible();
  });

  test("las filas confirmadas ya no ofrecen reimprimir una etiqueta sin token", async ({ sesion }) => {
    const op = await crearOpExtrusionLiberada({ kg: 100 });
    const rollo = await cargarRollo(op.id, "extrusion", 15);

    const gestion = await sesion("produccion", `/produccion/ordenes/${op.id}`);
    await expect(gestion.page.getByText(rollo.codigo).filter({ visible: true }).first()).toBeVisible();
    await expect(gestion.page.getByTitle("Imprimir etiqueta")).toHaveCount(0);

    // El endpoint viejo, que armaba un QR sin token, ya no existe.
    const { status } = await llamar("produccion", "GET", `/production-orders/${op.id}/rolls/${rollo.id}/label`);
    expect(status).toBe(404);
  });
});
