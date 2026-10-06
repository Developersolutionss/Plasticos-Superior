import type { BrowserContext, Page } from "@playwright/test";
import { qrComoImagen } from "./qr";

/**
 * Cámara emulada. Reemplaza `navigator.mediaDevices.getUserMedia` por un
 * video que sale de un <canvas>: el escáner real de la app (html5-qrcode)
 * lee esos cuadros y decodifica el QR igual que con una cámara de verdad.
 * Así se prueba la cadena completa (video → decodificación → servidor)
 * sin hardware y eligiendo en cada paso qué QR "ve" la cámara.
 *
 * También cuenta cuántas pistas de video se abrieron y cuántas se cerraron,
 * para comprobar que la app suelta la cámara al cerrar el escáner.
 */
const SCRIPT_CAMARA = `
(() => {
  if (window.__camaraEmulada) return;
  const W = 640, H = 480;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const estado = { pedidos: 0, arrancadas: 0, detenidas: 0, denegada: false };
  let imagen = null;

  function pintar() {
    if (!imagen) { ctx.fillStyle = '#1f2937'; ctx.fillRect(0, 0, W, H); return; }
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    const lado = 300;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(imagen, (W - lado) / 2, (H - lado) / 2, lado, lado);
  }
  pintar();
  // Se repinta siempre: un canvas quieto puede dejar de emitir cuadros.
  setInterval(pintar, 100);

  window.__camaraEmulada = {
    async mostrar(dataUrl) {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      imagen = img;
      pintar();
    },
    vaciar() { imagen = null; pintar(); },
    denegar(valor) { estado.denegada = valor !== false; },
    estado() { return { ...estado, activas: estado.arrancadas - estado.detenidas }; },
  };

  // window.open + print() de la etiqueta no deben abrir un diálogo de impresión.
  window.print = () => {};

  const md = navigator.mediaDevices;
  if (!md) return;
  md.getUserMedia = async (constraints) => {
    if (!constraints || !constraints.video) throw new DOMException('Solo se emula video', 'NotFoundError');
    estado.pedidos++;
    if (estado.denegada) throw new DOMException('Permission denied', 'NotAllowedError');
    const stream = canvas.captureStream(15);
    for (const pista of stream.getVideoTracks()) {
      estado.arrancadas++;
      const detener = pista.stop.bind(pista);
      let cerrada = false;
      pista.stop = () => {
        if (!cerrada) {
          cerrada = true;
          estado.detenidas++;
          // Sin ninguna sesión abierta la cámara ya no apunta a nada: una
          // cámara real no sigue viendo la etiqueta anterior en el siguiente
          // escaneo. Así cada lectura exige volver a mostrar su QR.
          if (estado.arrancadas === estado.detenidas) imagen = null;
        }
        detener();
      };
    }
    return stream;
  };
  md.enumerateDevices = async () => [
    { deviceId: 'camara-emulada', groupId: 'e2e', kind: 'videoinput', label: 'Cámara emulada', toJSON() { return this; } },
  ];
})();
`;

export interface EstadoCamara {
  pedidos: number;
  arrancadas: number;
  detenidas: number;
  denegada: boolean;
  activas: number;
}

export interface Camara {
  /**
   * La cámara pasa a ver el QR de este texto (ej. "EXT-9-K7M9XT4P2R6HW3JC").
   * Se muestra DESPUÉS de abrir el escáner; al cerrarse la cámara el QR se
   * retira solo, como al bajar el celular.
   */
  mostrarTexto(texto: string): Promise<void>;
  /** La cámara pasa a ver esta imagen tal cual (ej. el QR de una etiqueta impresa). */
  mostrarImagen(dataUrl: string): Promise<void>;
  /** La cámara deja de ver cualquier QR. */
  vaciar(): Promise<void>;
  /** El navegador rechaza el permiso de cámara (o lo vuelve a permitir). */
  denegarPermiso(denegar?: boolean): Promise<void>;
  estado(): Promise<EstadoCamara>;
}

export async function instalarCamaraEmulada(contexto: BrowserContext): Promise<void> {
  await contexto.addInitScript(SCRIPT_CAMARA);
}

export function controlarCamara(page: Page): Camara {
  return {
    async mostrarTexto(texto) {
      await this.mostrarImagen(await qrComoImagen(texto));
    },
    async mostrarImagen(dataUrl) {
      await page.evaluate((url) => (window as any).__camaraEmulada.mostrar(url), dataUrl);
    },
    async vaciar() {
      await page.evaluate(() => (window as any).__camaraEmulada.vaciar());
    },
    async denegarPermiso(denegar = true) {
      await page.evaluate((valor) => (window as any).__camaraEmulada.denegar(valor), denegar);
    },
    async estado() {
      return page.evaluate(() => (window as any).__camaraEmulada.estado());
    },
  };
}
