import QRCode from "qrcode";

/** QR del texto como imagen (data URL PNG), la misma forma que la app imprime en una etiqueta. */
export function qrComoImagen(texto: string): Promise<string> {
  return QRCode.toDataURL(texto, { errorCorrectionLevel: "M", margin: 2, width: 300 });
}
