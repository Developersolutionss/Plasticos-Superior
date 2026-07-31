import { Router } from "express";
import { prisma } from "../prisma";
import { parseProductionFile } from "../services/importExcel";

/**
 * Receptor de eventos de WhatsApp Business API (Meta Graph API).
 *
 * Pendiente de configuración en Meta for Developers cuando la cuenta esté aprobada:
 *  1. Crear app en developers.facebook.com y habilitar el producto "WhatsApp".
 *  2. Configurar este endpoint como Webhook URL: https://<tu-dominio>/webhook/whatsapp
 *  3. Usar WHATSAPP_VERIFY_TOKEN (.env) como "Verify Token" en la configuración del webhook.
 *  4. Suscribirse al campo "messages".
 *  5. Completar WHATSAPP_ACCESS_TOKEN y WHATSAPP_PHONE_NUMBER_ID en .env para poder
 *     descargar el media (documento adjunto) vía Graph API (GET /{media-id}).
 *
 * Una vez configurado, cada Excel/CSV enviado al grupo de WhatsApp se descarga aquí
 * y se procesa con el mismo parser que usa la carga manual (parseProductionFile),
 * dejando el resultado en import_logs con source = "whatsapp_bot" para revisión posterior.
 */
export const whatsappWebhookRouter = Router();

// Verificación del webhook (handshake inicial de Meta)
whatsappWebhookRouter.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Recepción de eventos (mensajes con documento adjunto)
whatsappWebhookRouter.post("/", async (req, res) => {
  // Responder rápido: Meta espera 200 en <20s o reintenta el evento.
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const message = change?.messages?.[0];

    if (!message || message.type !== "document") return;

    const mediaId = message.document.id;
    const filename = message.document.filename ?? "whatsapp-import.xlsx";

    if (!process.env.WHATSAPP_ACCESS_TOKEN) {
      console.warn("WHATSAPP_ACCESS_TOKEN no configurado; no se puede descargar el media.");
      return;
    }

    const buffer = await downloadWhatsappMedia(mediaId);
    const rows = await parseProductionFile(buffer, filename);
    const validRows = rows.filter((r) => !r.error);

    await prisma.importLog.create({
      data: {
        filename,
        source: "whatsapp_bot",
        rowsProcessed: validRows.length,
        rowsFailed: rows.length - validRows.length,
      },
    });

    // Nota: en esta fase inicial solo se deja el archivo registrado para
    // revisión manual del encargado de despacho en la pantalla de "Carga de
    // Producción" (import_logs). La confirmación de alta a producción se
    // hace igual que con un archivo subido manualmente, para mantener
    // control humano sobre qué entra al inventario.
  } catch (err) {
    console.error("Error procesando webhook de WhatsApp", err);
  }
});

async function downloadWhatsappMedia(mediaId: string): Promise<Buffer> {
  const metaResponse = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
  });
  const { url } = (await metaResponse.json()) as { url: string };

  const fileResponse = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
  });
  const arrayBuffer = await fileResponse.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
