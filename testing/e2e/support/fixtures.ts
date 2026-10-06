import { test as base, expect, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { login, type Rol } from "./api";
import { controlarCamara, instalarCamaraEmulada, type Camara } from "./fakeCamera";

export { expect };

/**
 * Errores que html5-qrcode lanza sin atraparlos cuando el escáner se cierra
 * justo mientras la cámara está arrancando (la cámara igual se libera). Un
 * test que cierra el escáner a propósito en esa ventana los declara con
 * `toleraCierreRapidoDelEscaner()`; en cualquier otro test siguen siendo fallo.
 */
const ERRORES_DE_CIERRE_RAPIDO_DEL_ESCANER = [
  /Cannot clear while scan is ongoing/,
  /The play\(\) request was interrupted because the media was removed from the document/,
];
const ETIQUETA_TOLERANCIA = "tolera-cierre-rapido-del-escaner";

export function toleraCierreRapidoDelEscaner(info: TestInfo): void {
  info.annotations.push({ type: ETIQUETA_TOLERANCIA });
}

export interface Sesion {
  rol: Rol;
  page: Page;
  contexto: BrowserContext;
  camara: Camara;
  /** Nombre con el que quedan registradas sus acciones (el del usuario del seed). */
  nombre: string;
}

/** Opciones del proyecto (escritorio/móvil) para los contextos que se abren a mano. */
function opcionesDelProyecto(info: TestInfo) {
  const uso = info.project.use as Record<string, unknown>;
  const clave = ["viewport", "userAgent", "deviceScaleFactor", "isMobile", "hasTouch", "locale", "timezoneId", "baseURL"] as const;
  return Object.fromEntries(clave.filter((k) => uso[k] !== undefined).map((k) => [k, uso[k]]));
}

/**
 * `sesion(rol)` abre un navegador aparte con la sesión ya iniciada de ese
 * usuario y la cámara emulada instalada. Se puede llamar varias veces en un
 * mismo test (cada una es una persona distinta con su propio celular).
 */
export const test = base.extend<{ sesion: (rol: Rol, ruta?: string) => Promise<Sesion> }>({
  sesion: async ({ browser }, use, info) => {
    const abiertos: BrowserContext[] = [];
    // Red de seguridad de todas las pruebas: un error sin atrapar en el
    // navegador o una respuesta 5xx del servidor es un bug aunque la pantalla
    // "parezca" bien, así que hace fallar el test.
    const fallos: string[] = [];
    await use(async (rol, ruta) => {
      const contexto = await browser.newContext({ ...opcionesDelProyecto(info) });
      abiertos.push(contexto);
      await instalarCamaraEmulada(contexto);
      const { token, user } = await login(rol);
      await contexto.addInitScript(
        ({ t, u }) => {
          localStorage.setItem("token", t);
          localStorage.setItem("user", JSON.stringify(u));
        },
        { t: token, u: user }
      );
      const page = await contexto.newPage();
      page.on("pageerror", (error) => fallos.push(`[${rol}] error sin atrapar en el navegador: ${error.message}`));
      page.on("response", (res) => {
        if (res.status() >= 500) fallos.push(`[${rol}] el servidor respondió ${res.status()} a ${res.request().method()} ${new URL(res.url()).pathname}`);
      });
      const sesion: Sesion = { rol, page, contexto, camara: controlarCamara(page), nombre: user.name };
      if (ruta) await page.goto(ruta);
      return sesion;
    });
    for (const contexto of abiertos) await contexto.close();
    const toleradas = info.annotations.some((n) => n.type === ETIQUETA_TOLERANCIA) ? ERRORES_DE_CIERRE_RAPIDO_DEL_ESCANER : [];
    const reales = fallos.filter((f) => !toleradas.some((permitido) => permitido.test(f)));
    expect(reales, "errores inesperados durante el flujo").toEqual([]);
  },
});
