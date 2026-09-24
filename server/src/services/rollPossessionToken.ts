import crypto from "crypto";

/**
 * Alfabeto de Crockford (32 símbolos: sin `0/O`, `1/I/L`) para que el token
 * se pueda tipear a mano sin confundir caracteres parecidos en una pantalla
 * de celular rayada con mala luz — ver docs/notas-pendientes-raw.md
 * ("Recibidas 2026-09-24").
 */
const TOKEN_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** 16 caracteres × 5 bits (32 símbolos) = 80 bits de entropía — de sobra
 * para este modelo de amenaza (tipeado a mano, endpoint limitable), sin
 * necesidad de los 128 bits de una password hasheada offline. */
const TOKEN_LENGTH = 16;

function readSecret(): string {
  const secret = process.env.ROLL_TOKEN_SECRET;
  if (!secret) throw new Error("ROLL_TOKEN_SECRET no está configurado");
  return secret;
}

/** Genera el token visible que se imprime en el QR/etiqueta — nunca se
 * guarda en la base, solo existe acá y en la etiqueta física. */
export function generatePossessionToken(): string {
  let token = "";
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    token += TOKEN_ALPHABET[crypto.randomInt(0, TOKEN_ALPHABET.length)];
  }
  return token;
}

/** Hash que sí se guarda en `ProductionRoll.possessionTokenHash` — mismo
 * principio que un hash de contraseña: una fuga de la base no alcanza para
 * reconstruir el token y fabricar un QR válido. */
export function hashPossessionToken(sequentialCode: string, tokenVisible: string): string {
  return crypto.createHmac("sha256", readSecret()).update(`${sequentialCode}:${tokenVisible}`).digest("hex");
}

/** Compara en tiempo constante contra el hash guardado — nunca con `===`,
 * para no filtrar nada por timing. */
export function verifyPossessionToken(sequentialCode: string, tokenVisible: string, storedHash: string): boolean {
  const expected = Buffer.from(hashPossessionToken(sequentialCode, tokenVisible), "hex");
  const actual = Buffer.from(storedHash, "hex");
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}
