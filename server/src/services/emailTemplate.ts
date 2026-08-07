/**
 * Plantilla HTML compartida para los correos del sistema (recuperación de
 * contraseña hoy, notificaciones más adelante). Todo el CSS va inline
 * porque la mayoría de los clientes de correo (Gmail incluido) ignora o
 * recorta las hojas de estilo en el <head>.
 */
export function renderEmailLayout(params: { title: string; bodyHtml: string }) {
  return `
<!DOCTYPE html>
<html lang="es">
  <body style="margin:0; padding:0; background-color:#f1f5f9; font-family:Segoe UI, Arial, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.08);">
            <tr>
              <td style="background-color:#0f172a; padding:24px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width:32px; height:32px; background-color:#0ea5e9; border-radius:8px; text-align:center; vertical-align:middle; font-weight:800; color:#ffffff; font-size:16px;">P</td>
                    <td style="padding-left:12px; color:#ffffff; font-size:16px; font-weight:700;">Plásticos Superior</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px; font-size:18px; color:#0f172a;">${params.title}</h1>
                <div style="font-size:14px; line-height:1.6; color:#334155;">
                  ${params.bodyHtml}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px; background-color:#f8fafc; border-top:1px solid #e2e8f0;">
                <p style="margin:0; font-size:12px; color:#94a3b8;">
                  Este es un correo automático del sistema de Plásticos Superior. Si no esperabas este mensaje, podés ignorarlo.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function renderButton(url: string, label: string) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
      <tr>
        <td style="background-color:#0f172a; border-radius:8px;">
          <a href="${url}" style="display:inline-block; padding:12px 24px; color:#ffffff; text-decoration:none; font-size:14px; font-weight:600;">
            ${label}
          </a>
        </td>
      </tr>
    </table>
  `;
}
