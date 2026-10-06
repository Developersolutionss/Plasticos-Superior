import type { Locator, Page } from "@playwright/test";

function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Registro de rollos / avance de la hoja de una OP. La hoja repite el mismo
 * formulario en dos diseños (tabla en escritorio, tarjetas en celular); esta
 * clase habla con el que se está viendo, así los flujos se escriben una sola
 * vez para los dos.
 */
export class RegistroDeRollos {
  constructor(
    private readonly page: Page,
    private readonly movil: boolean
  ) {}

  private get tabla(): Locator {
    return this.page.locator("table").filter({ has: this.page.locator("th", { hasText: /PESO \(KG\)/ }) });
  }

  private get tarjetas(): Locator {
    return this.page.locator(".md\\:hidden.space-y-2.p-2");
  }

  /** El input o select de un campo de la fila de carga, por el texto de su columna. */
  async campo(etiqueta: string): Promise<Locator> {
    // La hoja carga la OP de forma asíncrona: se espera la fila de carga.
    await (this.movil ? this.tarjetas : this.tabla.locator("tr.bg-sky-50")).first().waitFor();
    if (this.movil) {
      const fila = this.tarjetas
        .locator("div.flex.items-center.justify-between")
        .filter({ has: this.page.locator("span", { hasText: new RegExp(`^\\s*${escapar(etiqueta)}\\s*$`) }) });
      return fila.locator("input, select").first();
    }
    const encabezados = (await this.tabla.locator("thead th").allTextContents()).map((t) => t.trim().toUpperCase());
    const indice = encabezados.indexOf(etiqueta.toUpperCase());
    if (indice < 0) throw new Error(`La tabla no tiene la columna "${etiqueta}". Columnas: ${encabezados.join(", ")}`);
    return this.tabla.locator("tr.bg-sky-50 td").nth(indice).locator("input, select").first();
  }

  async completar(campos: Record<string, string | number>): Promise<void> {
    for (const [etiqueta, valor] of Object.entries(campos)) {
      await (await this.campo(etiqueta)).fill(String(valor));
    }
  }

  async anadir(): Promise<void> {
    if (this.movil) await this.tarjetas.getByRole("button", { name: /Añadir rollo/ }).click();
    else await this.tabla.getByTitle("Añadir rollo a la lista").click();
  }

  /** Botón de reemitir la etiqueta del rollo (Gestión y Calidad), en el diseño que se ve. */
  botonReemitir(): Locator {
    const titulo = "Reemitir etiqueta (invalida la anterior)";
    return (this.movil ? this.tarjetas : this.tabla).getByTitle(titulo).first();
  }

  /** Botón "Confirmar N rollo(s)" (solo existe si hay filas por confirmar). */
  botonConfirmar(cantidad: number): Locator {
    return this.page.getByRole("button", { name: new RegExp(`Confirmar ${cantidad} rollos?`) });
  }

  async confirmar(cantidad: number): Promise<void> {
    await this.botonConfirmar(cantidad).click();
  }

  /** Atajo: carga un rollo (campos), lo añade y lo confirma. */
  async cargarYConfirmar(campos: Record<string, string | number>): Promise<void> {
    await this.completar(campos);
    await this.anadir();
    await this.confirmar(1);
  }
}

/** Botón de la etiqueta lista para imprimir de un rollo recién confirmado (ej. "EXT-3"). */
export function botonEtiquetaLista(page: Page, codigo: string): Locator {
  return page.getByRole("button", { name: codigo, exact: true });
}

/**
 * Toca un botón que imprime una etiqueta y devuelve la imagen del QR tal como
 * quedó en la hoja impresa (la ventana de impresión se abre aparte).
 */
export async function imagenDeLaEtiquetaImpresa(page: Page, boton: Locator): Promise<string> {
  const [ventana] = await Promise.all([page.context().waitForEvent("page"), boton.click()]);
  const imagen = ventana.locator('img[alt^="QR"]').first();
  await imagen.waitFor();
  const origen = await imagen.getAttribute("src");
  await ventana.close();
  if (!origen?.startsWith("data:image")) throw new Error("La etiqueta impresa no trae la imagen del QR");
  return origen;
}
