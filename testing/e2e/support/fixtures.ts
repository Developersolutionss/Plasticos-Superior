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

interface Guardia {
  /** Errores del navegador y respuestas 5xx vistos durante el test. */
  fallos: string[];
  contextos: BrowserContext[];
}

function vigilar(page: Page, quien: string, fallos: string[]): void {
  page.on("pageerror", (error) => fallos.push(`[${quien}] error sin atrapar en el navegador: ${error.message}`));
  page.on("response", (res) => {
    if (res.status() >= 500) fallos.push(`[${quien}] el servidor respondió ${res.status()} a ${res.request().method()} ${new URL(res.url()).pathname}`);
  });
}

/**
 * `sesion(rol)` abre un navegador aparte con la sesión ya iniciada de ese
 * usuario y la cámara emulada instalada. Se puede llamar varias veces en un
 * mismo test (cada una es una persona distinta con su propio celular).
 * `visitante()` abre uno sin sesión, para probar el inicio de sesión.
 *
 * Red de seguridad de todas las pruebas: un error sin atrapar en el
 * navegador o una respuesta 5xx del servidor es un bug aunque la pantalla
 * "parezca" bien, así que hace fallar el test.
 */
export const test = base.extend<{
  guardia: Guardia;
  sesion: (rol: Rol, ruta?: string) => Promise<Sesion>;
  visitante: (ruta?: string) => Promise<Page>;
}>({
  guardia: async ({}, use, info) => {
    const guardia: Guardia = { fallos: [], contextos: [] };
    await use(guardia);
    for (const contexto of guardia.contextos) await contexto.close();
    const toleradas = info.annotations.some((n) => n.type === ETIQUETA_TOLERANCIA) ? ERRORES_DE_CIERRE_RAPIDO_DEL_ESCANER : [];
    const reales = guardia.fallos.filter((f) => !toleradas.some((permitido) => permitido.test(f)));
    expect(reales, "errores inesperados durante el flujo").toEqual([]);
  },

  sesion: async ({ browser, guardia }, use, info) => {
    await use(async (rol, ruta) => {
      const contexto = await browser.newContext({ ...opcionesDelProyecto(info) });
      guardia.contextos.push(contexto);
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
      vigilar(page, rol, guardia.fallos);
      const sesion: Sesion = { rol, page, contexto, camara: controlarCamara(page), nombre: user.name };
      if (ruta) await page.goto(ruta);
      return sesion;
    });
  },

  visitante: async ({ browser, guardia }, use, info) => {
    await use(async (ruta) => {
      const contexto = await browser.newContext({ ...opcionesDelProyecto(info) });
      guardia.contextos.push(contexto);
      const page = await contexto.newPage();
      vigilar(page, "visitante", guardia.fallos);
      if (ruta) await page.goto(ruta);
      return page;
    });
  },
});
