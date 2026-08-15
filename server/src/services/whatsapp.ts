const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

/**
 * Envía un mensaje de texto libre por WhatsApp Business (Graph API de Meta).
 *
 * OJO: esto solo funciona de verdad si la cuenta de WhatsApp Business ya
 * está aprobada y, para mensajes salientes PROACTIVOS (no dentro de una
 * ventana de 24h iniciada por el cliente), Meta exige usar una plantilla de
 * mensaje pre-aprobada, no texto libre como este. Mientras esa aprobación
 * no esté lista, esta función queda en modo "no-op silencioso" — mismo
 * criterio que `email.ts` cuando falta RESEND_API_KEY: no rompe el flujo
 * que la llama (ej. marcar un despacho completo), solo loguea.
 */
export async function sendWhatsAppMessage(to: string, message: string) {
  if (!ACCESS_TOKEN || !PHONE_NUMBER_ID) {
    console.log(`\n[WhatsApp no enviado, falta WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID] Para ${to}:\n${message}\n`);
    return;
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
        to,
        type: "text",
        text: { body: message },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[WhatsApp] No se pudo enviar el mensaje a ${to}: HTTP ${res.status} ${body}`);
      return;
    }

    console.log(`[WhatsApp] Mensaje enviado a ${to}`);
  } catch (err) {
    // No propaga: un fallo de red hacia Meta no debe romper el flujo (ej.
    // marcar un despacho completo) que disparó el envío.
    console.error(`[WhatsApp] Error de red enviando a ${to}:`, err);
  }
}
