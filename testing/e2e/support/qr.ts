import QRCode from "qrcode";

/**
 * QR del texto como imagen (data URL PNG). Cada módulo mide un número entero
 * de píxeles y el margen es el de 4 módulos que exige el estándar (el mismo
 * de las etiquetas que imprime la app), así el decodificador de la cámara
 * emulada lo lee con la misma fiabilidad que el de una etiqueta real.
 */
export function qrComoImagen(texto: string): Promise<string> {
  return QRCode.toDataURL(texto, { errorCorrectionLevel: "M", margin: 4, scale: 8 });
}
