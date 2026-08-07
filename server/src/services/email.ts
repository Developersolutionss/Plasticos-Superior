import { Resend } from "resend";

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

  await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject: "Recuperar contraseña — Plásticos Superior",
    html: `
      <p>Recibimos una solicitud para restablecer tu contraseña.</p>
      <p><a href="${resetUrl}">Hacé clic acá para elegir una nueva contraseña</a> (válido por 1 hora).</p>
      <p>Si no fuiste vos, podés ignorar este correo.</p>
    `,
  });
}
