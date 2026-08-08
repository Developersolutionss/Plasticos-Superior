import { Resend } from "resend";
import { renderButton, renderEmailLayout } from "./emailTemplate";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";

/**
 * Envía el email de recuperación de contraseña. Si no hay RESEND_API_KEY
 * configurada (todavía no tenemos cuenta de Resend), el link queda
 * impreso en la consola del servidor para poder probar el flujo en local
 * sin depender de un proveedor real.
 */
export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  if (!resend) {
    console.log(`\n[email no enviado, falta RESEND_API_KEY] Link de reseteo para ${to}:\n${resetUrl}\n`);
    return;
  }

  const html = renderEmailLayout({
    title: "Recuperar tu contraseña",
    bodyHtml: `
      <p style="margin:0 0 8px;">Recibimos una solicitud para restablecer la contraseña de tu cuenta.</p>
      <p style="margin:0;">Hacé clic en el botón para elegir una nueva. El link vence en <strong>1 hora</strong>.</p>
      ${renderButton(resetUrl, "Elegir nueva contraseña")}
      <p style="margin:0; font-size:12px; color:#94a3b8;">
        Si el botón no funciona, copiá y pegá este link en tu navegador:<br />
        <a href="${resetUrl}" style="color:#0ea5e9; word-break:break-all;">${resetUrl}</a>
      </p>
      <p style="margin:16px 0 0;">Si no fuiste vos quien lo pidió, podés ignorar este correo sin problema.</p>
    `,
  });

  // El SDK de Resend NO tira excepción si el envío falla a nivel API (ej.
  // dominio sin verificar) — devuelve { data, error }. Si no revisamos
  // `error`, un envío fallido queda en silencio como si hubiese salido bien.
  const { data, error } = await resend.emails.send({
    from: `Plásticos Superior <${FROM_EMAIL}>`,
    to,
    subject: "Recuperar contraseña — Plásticos Superior",
    html,
  });

  if (error) {
    console.error(`[Resend] No se pudo enviar el email a ${to}:`, error);
  } else {
    console.log(`[Resend] Email de reseteo enviado a ${to} (id: ${data?.id})`);
  }
}
