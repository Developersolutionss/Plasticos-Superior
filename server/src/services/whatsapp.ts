const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

/**
 * Normaliza un teléfono a E.164 para mandarlo a la API de Meta. Los
 * contactos se cargan a mano en la ficha del cliente sin ningún formato
 * exigido (ej. "300 123 4567", "3001234567") -- Meta rechaza silenciosamente
 * cualquier número que no venga en formato internacional. Si ya trae "+" se
 * respeta tal cual (podría ser de otro país); un número de 10 dígitos sin
 * indicativo se asume celular colombiano.
 */
export function normalizePhoneE164(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    return digits.length >= 8 ? `+${digits}` : null;
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+57${digits}`;
  if (digits.length > 10) return `+${digits}`;
  return null;
}

/**
 * Envía un mensaje de texto libre por WhatsApp Business (Graph API de Meta).
 * Devuelve si se pudo enviar o no (y por qué) para que el llamador pueda
 * dejar constancia (ver Dispatch.notifiedAt/notifyError) en vez de que el
 * aviso se pierda en un log sin que nadie en Almacén se entere de que el
 * cliente nunca recibió el mensaje.
 *
 * OJO: esto solo funciona de verdad si la cuenta de WhatsApp Business ya
 * está aprobada y, para mensajes salientes PROACTIVOS (no dentro de una
 * ventana de 24h iniciada por el cliente), Meta exige usar una plantilla de
 * mensaje pre-aprobada, no texto libre como este. Mientras esa aprobación
 * no esté lista, esta función queda en modo "no-op silencioso" — mismo
 * criterio que `email.ts` cuando falta RESEND_API_KEY: no rompe el flujo
 * que la llama (ej. marcar un despacho completo), solo loguea.
 */
export async function sendWhatsAppMessage(to: string, message: string): Promise<{ ok: boolean; error?: string }> {
  const normalized = normalizePhoneE164(to);
  if (!normalized) {
    const error = `Teléfono con formato inválido: "${to}"`;
    console.error(`[WhatsApp] ${error}`);
    return { ok: false, error };
  }

  if (!ACCESS_TOKEN || !PHONE_NUMBER_ID) {
    console.log(`\n[WhatsApp no enviado, falta WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID] Para ${normalized}:\n${message}\n`);
    return { ok: false, error: "WhatsApp no configurado" };
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: normalized,
        type: "text",
        text: { body: message },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const error = `HTTP ${res.status} ${body}`.trim();
      console.error(`[WhatsApp] No se pudo enviar el mensaje a ${normalized}: ${error}`);
      return { ok: false, error };
    }

    console.log(`[WhatsApp] Mensaje enviado a ${normalized}`);
    return { ok: true };
  } catch (err) {
    // No propaga: un fallo de red hacia Meta no debe romper el flujo (ej.
    // marcar un despacho completo) que disparó el envío.
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[WhatsApp] Error de red enviando a ${normalized}:`, err);
    return { ok: false, error };
  }
}
