import { test, expect, toleraCierreRapidoDelEscaner } from "./support/fixtures";
import { cargarRollo, crearOpExtrusionLiberada, derivarOp, generarEtiquetasBulto, moverRolloA } from "./support/api";

// El botón de escaneo de la hoja de la OP lee con la cámara tanto rollos
// madre como etiquetas de bulto y decide solo cuál es cada código. Aquí se
// prueba con la cámara emulada lo que más puede fallar en planta: códigos
// que se parecen, QR sin token, permiso de cámara negado y escaneos repetidos.
test.describe("escaneo en la hoja de la OP de Sellado", () => {
  /** OP de Sellado derivada de una de Extrusión que tiene un rollo de `kg` en la bodega de Sellado. */
  async function selladoConRolloEnBodega(kg: number) {
    const extrusion = await crearOpExtrusionLiberada({ kg: 200 });
    const rollo = await cargarRollo(extrusion.id, "extrusion", kg);
    await moverRolloA(rollo, "sellado");
    const sellado = await derivarOp(extrusion.id, "sellado");
    return { rollo, sellado };
  }

  test("el mismo botón lee una etiqueta de bulto y un rollo madre sin confundirlos", async ({ sesion }) => {
    const { rollo, sellado } = await selladoConRolloEnBodega(40);
    const [etiqueta] = await generarEtiquetasBulto(1);
    const { page, camara } = await sesion("sellado", `/produccion/ordenes/${sellado.id}`);
    const escanear = page.getByTitle(/^Escan/);

    // EXT-0000N tiene forma de etiqueta de bulto: se registra como bulto, no como rollo.
    await escanear.click();
    await camara.mostrarTexto(etiqueta);
    await expect(page.getByText(`Etiqueta de bulto: ${etiqueta}`).filter({ visible: true }).first()).toBeVisible();

    // El código del rollo (EXT-N con el token) se registra como rollo madre.
    await escanear.click();
    await camara.mostrarTexto(rollo.qr);
    await expect(page.getByText(/quedan\s*40 kg/).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText(`Etiqueta de bulto: ${etiqueta}`).filter({ visible: true }).first()).toBeVisible();
  });

  test("una etiqueta de bulto que no existe no se reintenta como rollo", async ({ sesion }) => {
    const { sellado } = await selladoConRolloEnBodega(10);
    const { page, camara } = await sesion("sellado", `/produccion/ordenes/${sellado.id}`);

    await page.getByTitle(/^Escan/).click();
    await camara.mostrarTexto("EXT-09999");
    await expect(page.getByText("No se encontró la etiqueta de bulto EXT-09999")).toBeVisible();
  });

  test("un rollo sin token se rechaza al escanear, no al guardar la fila", async ({ sesion }) => {
    const { rollo, sellado } = await selladoConRolloEnBodega(10);
    const { page, camara } = await sesion("sellado", `/produccion/ordenes/${sellado.id}`);

    await page.getByTitle(/^Escan/).click();
    await camara.mostrarTexto(rollo.codigo);
    await expect(page.getByText(`El código ${rollo.codigo} no trae el token de posesión`)).toBeVisible();
    await expect(page.getByText(/quedan\s*10 kg/)).toHaveCount(0);
  });

  test("un rollo que sigue en la bodega de Extrusión no se puede consumir en Sellado", async ({ sesion }) => {
    const extrusion = await crearOpExtrusionLiberada({ kg: 200 });
    const rollo = await cargarRollo(extrusion.id, "extrusion", 15);
    const sellado = await derivarOp(extrusion.id, "sellado");
    const { page, camara } = await sesion("sellado", `/produccion/ordenes/${sellado.id}`);

    await page.getByTitle(/^Escan/).click();
    await camara.mostrarTexto(rollo.qr);
    await expect(page.getByText(/está en la bodega de Extrusión/)).toBeVisible();
    await expect(page.getByText(/quedan\s*15 kg/)).toHaveCount(0);
  });
});

test.describe("la cámara en el escáner", () => {
  test("sin permiso de cámara avisa y deja tipear el código completo a mano", async ({ sesion }) => {
    const extrusion = await crearOpExtrusionLiberada({ kg: 100 });
    const rollo = await cargarRollo(extrusion.id, "extrusion", 12);
    const { page, camara } = await sesion("impresion", "/produccion/despacho-bodegas");

    await camara.denegarPermiso();
    await page.getByRole("button", { name: /Escanear rollo/ }).click();
    await expect(page.getByText("No se pudo acceder a la cámara. Revisá los permisos del navegador.")).toBeVisible();

    await page.getByPlaceholder(/a mano/).fill(rollo.qr.toLowerCase());
    await page.getByRole("button", { name: "Usar código" }).click();
    await expect(page.getByText("Saldo: 12 kg")).toBeVisible();
  });

  test("cerrar el escáner suelta la cámara", async ({ sesion }, info) => {
    toleraCierreRapidoDelEscaner(info);
    const { page, camara } = await sesion("impresion", "/produccion/despacho-bodegas");

    await page.getByRole("button", { name: /Escanear rollo/ }).click();
    await expect.poll(async () => (await camara.estado()).activas).toBe(1);

    await page.getByRole("button", { name: "×" }).click();
    await expect.poll(async () => (await camara.estado()).activas).toBe(0);
  });

  test("abrir y cerrar el escáner muchas veces y muy rápido nunca deja la cámara prendida", async ({ sesion }, info) => {
    toleraCierreRapidoDelEscaner(info);
    const { page, camara } = await sesion("impresion", "/produccion/despacho-bodegas");

    // Cierres a distintos momentos del arranque de la cámara, incluido el más apretado.
    const retardos = [0, 20, 50, 100, 150, 250, 400, 700, 0, 20, 50, 100, 150, 250, 400, 700];
    for (const ms of retardos) {
      await page.getByRole("button", { name: /Escanear rollo/ }).click();
      await page.waitForTimeout(ms);
      await page.getByRole("button", { name: "×" }).click();
      await page.waitForTimeout(150);
    }

    await expect.poll(async () => (await camara.estado()).activas).toBe(0);
    const { pedidos, arrancadas, detenidas } = await camara.estado();
    expect(pedidos).toBe(retardos.length);
    expect(detenidas).toBe(arrancadas);
  });

  test("un QR que se queda frente a la cámara se procesa una sola vez", async ({ sesion }) => {
    const extrusion = await crearOpExtrusionLiberada({ kg: 100 });
    const rollo = await cargarRollo(extrusion.id, "extrusion", 18);
    const { page, camara } = await sesion("impresion", "/produccion/despacho-bodegas");
    let lecturas = 0;
    page.on("request", (r) => {
      if (r.url().includes("/api/roll-transfers/scan/")) lecturas++;
    });

    await page.getByRole("button", { name: /Escanear rollo/ }).click();
    await camara.mostrarTexto(rollo.qr);
    await expect(page.getByText("Saldo: 18 kg")).toBeVisible();
    await page.waitForTimeout(2500);
    expect(lecturas).toBe(1);
  });
});
