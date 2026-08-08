import { OTP } from "otplib";
import QRCode from "qrcode";

const ISSUER = "Plasticos Superior";
const otp = new OTP({ strategy: "totp" });

export function generateSecret() {
  return otp.generateSecret();
}

/** Genera el QR (data URL) que el usuario escanea con Google Authenticator/Authy. */
export async function generateQrCodeDataUrl(email: string, secret: string) {
  const otpauthUrl = otp.generateURI({ issuer: ISSUER, label: email, secret });
  return QRCode.toDataURL(otpauthUrl);
}

/** Tolera 1 paso de 30s hacia atrás/adelante, por relojes ligeramente desincronizados. */
export async function verifyToken(token: string, secret: string) {
  const result = await otp.verify({ secret, token, epochTolerance: 30 });
  return result.valid;
}
