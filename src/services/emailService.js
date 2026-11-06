import nodemailer from 'nodemailer';

/**
 * Servicio de envío de notificaciones por correo electrónico.
 * Configurado para operar sin necesidad de dominio propio utilizando
 * una cuenta de Gmail con Contraseña de Aplicación de Google (App Password)
 * o cualquier servidor SMTP estándar.
 */

let cachedTransporter = null;

/**
 * Obtiene o inicializa la instancia del transportador de Nodemailer.
 */
function getTransporter() {
  if (cachedTransporter) return cachedTransporter;

  const user = (process.env.SMTP_EMAIL || process.env.EMAIL_USER || '').trim();
  const rawPass = (process.env.SMTP_APP_PASSWORD || process.env.EMAIL_PASS || '').trim();
  const pass = rawPass.replace(/\s+/g, '');

  if (!user || !pass) {
    return null;
  }

  // Si se configuran variables explícitas de host/puerto se usan,
  // de lo contrario se usa el servicio predefinido de Gmail.
  if (process.env.SMTP_HOST) {
    cachedTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST.trim(),
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user, pass },
    });
  } else {
    cachedTransporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    });
  }

  return cachedTransporter;
}

/**
 * Envía una notificación por correo al administrador cuando una nueva oficina se registra.
 *
 * @param {Object} params
 * @param {string} params.displayName - Nombre de la oficina u operador.
 * @param {string} params.email - Correo de la oficina registrada.
 * @param {string} params.officeId - Identificador de la oficina.
 * @param {string} [params.userId] - ID de usuario en Supabase/BD.
 * @param {string} [params.deviceInfo] - Información del dispositivo o navegador.
 * @param {string} [params.ipAddress] - Dirección IP de origen.
 * @param {Date|string} [params.createdAt] - Fecha del registro.
 * @returns {Promise<{ success: boolean, messageId?: string, reason?: string }>}
 */
export async function sendOfficeRegistrationNotification({
  displayName,
  email,
  officeId,
  userId,
  deviceInfo = 'No especificado',
  ipAddress = 'No especificada',
  createdAt = new Date(),
}) {
  // En entorno de pruebas automatizadas no se envía correo real
  if (process.env.NODE_ENV === 'test') {
    return { success: true, reason: 'TEST_ENVIRONMENT_SKIPPED' };
  }

  const transporter = getTransporter();
  const fromEmail = (process.env.SMTP_EMAIL || process.env.EMAIL_USER || '').trim();

  // Soporta uno o múltiples correos destinatarios separados por comas o punto y coma
  const rawTo = (process.env.ADMIN_NOTIFICATION_EMAIL || fromEmail || 'hola@gmail.com').trim();
  const recipients = rawTo
    .split(/[,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const toList = recipients.length > 0 ? recipients : [fromEmail];
  const toDisplay = toList.join(', ');

  if (!transporter || !fromEmail) {
    console.warn(
      '[EmailService] Notificación de nueva oficina omitida: ' +
      'Configura SMTP_EMAIL y SMTP_APP_PASSWORD en el archivo .env para activar el envío.'
    );
    return { success: false, reason: 'SMTP_CREDENTIALS_MISSING' };
  }

  const registrationDate = new Date(createdAt).toLocaleString('es-VE', {
    timeZone: 'America/Caracas',
    dateStyle: 'full',
    timeStyle: 'medium',
  });

  const subject = `⏳ Nueva Oficina Registrada (En Espera de Aprobación): ${displayName} (${email})`;

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #f4f6f8; margin: 0; padding: 20px; color: #1e293b; }
        .container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 14px rgba(0,0,0,0.06); }
        .header { background: linear-gradient(135deg, #0ea5e9, #0284c7); padding: 24px; text-align: center; color: #ffffff; }
        .header h1 { margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -0.3px; }
        .header p { margin: 6px 0 0; font-size: 13px; opacity: 0.95; }
        .content { padding: 24px; }
        .badge { display: inline-block; background-color: #fef3c7; color: #b45309; border: 1px solid #fcd34d; padding: 5px 12px; border-radius: 9999px; font-size: 11px; font-weight: 700; text-transform: uppercase; margin-bottom: 16px; }
        .info-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        .info-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
        .info-table td.label { font-weight: 600; color: #64748b; width: 38%; }
        .info-table td.value { font-weight: 500; color: #0f172a; word-break: break-word; }
        .highlight { font-family: Consolas, monospace; background: #f8fafc; padding: 2px 6px; border-radius: 4px; border: 1px solid #e2e8f0; color: #0284c7; font-weight: 600; }
        .btn { display: inline-block; background-color: #0284c7; color: #ffffff !important; padding: 12px 24px; border-radius: 10px; font-weight: 700; font-size: 13px; text-decoration: none; box-shadow: 0 2px 6px rgba(2, 132, 199, 0.35); }
        .footer { background: #f8fafc; padding: 16px 24px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Guides Admin</h1>
          <p>Notificación de Registro de Nueva Oficina</p>
        </div>
        <div class="content">
          <div style="text-align: center;">
            <span class="badge">⏳ En Espera de Aprobación</span>
          </div>
          <p style="font-size: 14px; margin-top: 0; line-height: 1.5;">
            Una nueva oficina u operador se ha registrado y <strong>requiere tu aprobación</strong> en el panel administrativo antes de poder utilizar la aplicación:
          </p>
          <table class="info-table">
            <tr>
              <td class="label">🏢 Oficina / Operador:</td>
              <td class="value"><strong>${displayName}</strong></td>
            </tr>
            <tr>
              <td class="label">✉️ Correo Electrónico:</td>
              <td class="value"><a href="mailto:${email}" style="color: #0284c7; text-decoration: none;">${email}</a></td>
            </tr>
            <tr>
              <td class="label">🆔 ID de Oficina:</td>
              <td class="value"><span class="highlight">${officeId}</span></td>
            </tr>
            ${userId ? `
            <tr>
              <td class="label">👤 ID de Usuario:</td>
              <td class="value"><span class="highlight">${userId}</span></td>
            </tr>` : ''}
            <tr>
              <td class="label">📅 Fecha de Registro:</td>
              <td class="value">${registrationDate}</td>
            </tr>
            <tr>
              <td class="label">💻 Dispositivo:</td>
              <td class="value">${deviceInfo}</td>
            </tr>
            <tr>
              <td class="label">🌐 Dirección IP:</td>
              <td class="value">${ipAddress}</td>
            </tr>
          </table>

          <div style="text-align: center; margin: 24px 0 8px 0;">
            <a href="https://tradeexpressguides.netlify.app/admin" class="btn">
              👑 Ir al Panel Administrativo y Aprobar Cuenta
            </a>
          </div>
        </div>
        <div class="footer">
          Mensaje automático generado por Guides Admin Server para ${toDisplay}
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"Guides Admin" <${fromEmail}>`,
      to: toList,
      subject,
      priority: 'high',
      headers: {
        'X-Priority': '1',
        'X-MSMail-Priority': 'High',
        'Importance': 'High',
      },
      text: `Nueva oficina registrada en Guides Admin:\n\n` +
            `Oficina: ${displayName}\n` +
            `Correo: ${email}\n` +
            `ID Oficina: ${officeId}\n` +
            `Fecha: ${registrationDate}\n` +
            `Dispositivo: ${deviceInfo}\n` +
            `IP: ${ipAddress}\n`,
      html: htmlContent,
    });

    console.log(`[EmailService] Notificación de nueva oficina enviada a [${toDisplay}] (ID: ${info.messageId})`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('[EmailService] Error al enviar correo de notificación:', err.message);
    return { success: false, reason: err.message };
  }
}

