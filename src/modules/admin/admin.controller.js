import { supabaseAdmin } from '../../lib/supabaseConfig.js';
import { SUPERADMIN_EMAIL, getUserRole, isUserAdmin } from '../../lib/roles.js';
import { GuidesModel } from '../guides/guides.model.js';
import { SessionService } from '../../services/session.service.js';
import jwt from 'jsonwebtoken';

// Fallback en memoria para tests y desarrollo aislado cuando supabaseAdmin es null
export const inMemoryOffices = [
  {
    id: 'superadmin-root-id',
    email: SUPERADMIN_EMAIL,
    created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    last_sign_in_at: new Date().toISOString(),
    user_metadata: {
      display_name: 'José Ángel Garcés (Super Admin)',
      location: 'Sede Principal (Falcón, VE)',
      role: 'superadmin',
      subscription_status: 'active',
      office_id: 'superadmin-root-id',
      trial_extended_days: 365,
    },
  },
];

/**
 * Helper para calcular estado y vencimiento del periodo de prueba de 5 días.
 */
function calculateTrialInfo(user) {
  let status = user.user_metadata?.subscription_status || user.user_metadata?.status;
  const isPending = status === 'pending_approval';

  // Si la oficina aún no ha sido aprobada por el administrador, el periodo de prueba no ha iniciado
  if (isPending) {
    return {
      trialDaysBase: 5,
      extendedDays: 0,
      totalTrialDays: 5,
      trialExpiresAt: null,
      daysRemaining: 5,
      isTrialExpired: false,
      status: 'pending_approval',
    };
  }

  // La fecha de cómputo inicia desde el momento en que el administrador aprobó la oficina (approved_at)
  // o desde su fecha de registro si no tiene approved_at explícito.
  const startDate = user.user_metadata?.approved_at
    ? new Date(user.user_metadata.approved_at)
    : new Date(user.created_at || Date.now());

  const trialDaysBase = 5;
  const extendedDays = Math.max(0, Number(user.user_metadata?.trial_extended_days || 0));
  const totalTrialDays = trialDaysBase + extendedDays;
  const trialExpiresAt = new Date(startDate.getTime() + totalTrialDays * 24 * 60 * 60 * 1000);
  const msRemaining = trialExpiresAt.getTime() - Date.now();
  const daysRemaining = Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
  const isTrialExpired = msRemaining <= 0;

  if (!status || status === 'trial') {
    status = isTrialExpired ? 'expired' : 'trial';
  }

  return {
    trialDaysBase,
    extendedDays,
    totalTrialDays,
    trialExpiresAt: trialExpiresAt.toISOString(),
    daysRemaining,
    isTrialExpired,
    status,
  };
}

/**
 * Obtiene métricas generales para el dashboard administrativo.
 * GET /api/admin/metrics
 */
export async function getMetrics(req, res) {
  try {
    let users = [];

    if (supabaseAdmin) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
      if (error) throw error;
      users = data?.users || [];
    } else {
      users = inMemoryOffices;
    }

    let activeAdmins = 0;
    let pendingApprovals = 0;
    let activeTrials = 0;
    let expiredTrials = 0;
    let activeSubscriptions = 0;
    let suspendedOffices = 0;

    for (const u of users) {
      if (isUserAdmin(u)) {
        activeAdmins++;
      }

      const trial = calculateTrialInfo(u);

      if (trial.status === 'pending_approval') {
        pendingApprovals++;
      } else if (trial.status === 'active') {
        activeSubscriptions++;
      } else if (trial.status === 'suspended') {
        suspendedOffices++;
      } else if (trial.status === 'expired' || trial.isTrialExpired) {
        expiredTrials++;
      } else {
        activeTrials++;
      }
    }

    // Guías totales procesadas
    let totalScannedGuides = 0;
    try {
      const guides = await GuidesModel.getAll();
      totalScannedGuides = Array.isArray(guides) ? guides.length : 0;
    } catch (gErr) {
      console.warn('[Admin Controller] No se pudieron contar guías:', gErr.message);
    }

    return res.status(200).json({
      ok: true,
      metrics: {
        totalOffices: users.length,
        pendingApprovals,
        activeAdmins,
        activeTrials,
        expiredTrials,
        activeSubscriptions,
        suspendedOffices,
        totalScannedGuides,
      },
    });
  } catch (err) {
    console.error('[Admin Controller] Error en getMetrics:', err);
    return res.status(500).json({ ok: false, message: 'INTERNAL_SERVER_ERROR', error: err.message });
  }
}

/**
 * Obtiene la lista completa de oficinas registradas con sus metadatos y estado.
 * GET /api/admin/offices
 */
export async function getOffices(req, res) {
  try {
    let rawUsers = [];

    if (supabaseAdmin) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
      if (error) throw error;
      rawUsers = data?.users || [];
    } else {
      rawUsers = inMemoryOffices;
    }

    // Mapear conteo de paquetes/guías por oficina
    const guideCounts = {};
    try {
      const guides = await GuidesModel.getAll();
      for (const g of guides || []) {
        const key = g.office_id || g.user_id;
        if (key) {
          guideCounts[key] = (guideCounts[key] || 0) + 1;
        }
      }
    } catch (gErr) {
      // Ignorar fallback de guías
    }

    const offices = rawUsers.map((u) => {
      const trial = calculateTrialInfo(u);
      const computedRole = getUserRole(u);
      const email = (u.email || '').toLowerCase().trim();
      const isSuperAdmin = email === SUPERADMIN_EMAIL;
      const officeId = u.user_metadata?.office_id || u.id;

      return {
        id: u.id,
        email: u.email,
        displayName: u.user_metadata?.display_name || u.email?.split('@')[0] || 'Oficina Zoom',
        location: u.user_metadata?.location || null,
        officeId,
        role: computedRole,
        isSuperAdmin,
        status: trial.status,
        trialDaysExtended: trial.extendedDays,
        trialExpiresAt: trial.trialExpiresAt,
        trialDaysRemaining: trial.daysRemaining,
        isTrialExpired: trial.isTrialExpired,
        packagesCount: guideCounts[u.id] || guideCounts[officeId] || 0,
        createdAt: u.created_at,
        lastSignInAt: u.last_sign_in_at || null,
      };
    });

    // Ordenar: Super Admin primero, luego por fecha de creación descendente
    offices.sort((a, b) => {
      if (a.isSuperAdmin) return -1;
      if (b.isSuperAdmin) return 1;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    return res.status(200).json({
      ok: true,
      offices,
      total: offices.length,
    });
  } catch (err) {
    console.error('[Admin Controller] Error en getOffices:', err);
    return res.status(500).json({ ok: false, message: 'INTERNAL_SERVER_ERROR', error: err.message });
  }
}

/**
 * Actualiza el rol de una cuenta (promover a 'admin' o revertir a 'operator').
 * PATCH /api/admin/offices/:id/role
 */
export async function updateOfficeRole(req, res) {
  const { id } = req.params;
  const { role } = req.body;

  if (!role || !['admin', 'operator'].includes(role)) {
    return res.status(400).json({
      ok: false,
      message: 'INVALID_ROLE',
      error: 'El rol debe ser "admin" u "operator".',
    });
  }

  try {
    let targetUser = null;

    if (supabaseAdmin) {
      const { data, error } = await supabaseAdmin.auth.admin.getUserById(id);
      if (error || !data?.user) {
        return res.status(404).json({ ok: false, message: 'USER_NOT_FOUND' });
      }
      targetUser = data.user;
    } else {
      targetUser = inMemoryOffices.find((u) => u.id === id);
      if (!targetUser) {
        return res.status(404).json({ ok: false, message: 'USER_NOT_FOUND' });
      }
    }

    // Regla de oro: No se puede degradar o modificar el Super Administrador
    const targetEmail = (targetUser.email || '').toLowerCase().trim();
    if (targetEmail === SUPERADMIN_EMAIL) {
      return res.status(400).json({
        ok: false,
        message: 'CANNOT_MODIFY_SUPERADMIN',
        error: 'No se puede modificar el rol del Super Administrador principal.',
      });
    }

    if (supabaseAdmin) {
      const updatedMeta = {
        ...targetUser.user_metadata,
        role,
      };
      const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(id, {
        user_metadata: updatedMeta,
      });
      if (updateErr) throw updateErr;
    } else {
      targetUser.user_metadata = targetUser.user_metadata || {};
      targetUser.user_metadata.role = role;
    }

    return res.status(200).json({
      ok: true,
      message: `Rol de la cuenta actualizado a "${role}" con éxito`,
      office: {
        id,
        role,
      },
    });
  } catch (err) {
    console.error('[Admin Controller] Error en updateOfficeRole:', err);
    return res.status(500).json({ ok: false, message: 'INTERNAL_SERVER_ERROR', error: err.message });
  }
}

/**
 * Actualiza el estado de suscripción o extiende días de prueba de una oficina.
 * PATCH /api/admin/offices/:id/status
 */
export async function updateOfficeStatus(req, res) {
  const { id } = req.params;
  const { status, extendDays } = req.body;

  try {
    let targetUser = null;

    if (supabaseAdmin) {
      const { data, error } = await supabaseAdmin.auth.admin.getUserById(id);
      if (error || !data?.user) {
        return res.status(404).json({ ok: false, message: 'USER_NOT_FOUND' });
      }
      targetUser = data.user;
    } else {
      targetUser = inMemoryOffices.find((u) => u.id === id);
      if (!targetUser) {
        return res.status(404).json({ ok: false, message: 'USER_NOT_FOUND' });
      }
    }

    const targetEmail = (targetUser.email || '').toLowerCase().trim();
    if (targetEmail === SUPERADMIN_EMAIL && status === 'suspended') {
      return res.status(400).json({
        ok: false,
        message: 'CANNOT_SUSPEND_SUPERADMIN',
        error: 'El Super Administrador principal no puede ser suspendido.',
      });
    }

    const currentMeta = targetUser.user_metadata || {};
    const updatedMeta = { ...currentMeta };

    if (status && ['trial', 'active', 'suspended', 'pending_approval'].includes(status)) {
      updatedMeta.subscription_status = status;
      // Si la cuenta estaba en espera de aprobación y pasa a trial o activa, registrar fecha de aprobación
      if (currentMeta.subscription_status === 'pending_approval' && (status === 'trial' || status === 'active')) {
        updatedMeta.approved_at = new Date().toISOString();
      }
    }

    if (typeof extendDays === 'number' && !isNaN(extendDays)) {
      const prevExtended = Number(currentMeta.trial_extended_days || 0);
      updatedMeta.trial_extended_days = Math.max(0, prevExtended + extendDays);
    }

    if (supabaseAdmin) {
      const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(id, {
        user_metadata: updatedMeta,
      });
      if (updateErr) throw updateErr;
    } else {
      targetUser.user_metadata = updatedMeta;
    }

    return res.status(200).json({
      ok: true,
      message: 'Estado de la oficina actualizado con éxito',
      office: {
        id,
        status: updatedMeta.subscription_status || 'trial',
        trialDaysExtended: updatedMeta.trial_extended_days || 0,
        approvedAt: updatedMeta.approved_at || null,
      },
    });
  } catch (err) {
    console.error('[Admin Controller] Error en updateOfficeStatus:', err);
    return res.status(500).json({ ok: false, message: 'INTERNAL_SERVER_ERROR', error: err.message });
  }
}

/**
 * Aprueba una oficina pendiente de activación.
 * POST /api/admin/offices/:id/approve
 */
export async function approveOffice(req, res) {
  const { id } = req.params;
  const targetStatus = req.body?.status === 'active' ? 'active' : 'trial';

  req.body = { status: targetStatus };
  return updateOfficeStatus(req, res);
}

/**
 * Elimina permanentemente una cuenta de oficina.
 * DELETE /api/admin/offices/:id
 */
export async function deleteOffice(req, res) {
  const { id } = req.params;

  try {
    let targetUser = null;

    if (supabaseAdmin) {
      const { data, error } = await supabaseAdmin.auth.admin.getUserById(id);
      if (error || !data?.user) {
        return res.status(404).json({ ok: false, message: 'USER_NOT_FOUND' });
      }
      targetUser = data.user;
    } else {
      const idx = inMemoryOffices.findIndex((u) => u.id === id);
      if (idx === -1) {
        return res.status(404).json({ ok: false, message: 'USER_NOT_FOUND' });
      }
      targetUser = inMemoryOffices[idx];
    }

    // Regla de oro: No se puede eliminar el Super Administrador principal
    const targetEmail = (targetUser.email || '').toLowerCase().trim();
    if (targetEmail === SUPERADMIN_EMAIL) {
      return res.status(400).json({
        ok: false,
        message: 'CANNOT_DELETE_SUPERADMIN',
        error: 'No se puede eliminar la cuenta del Super Administrador principal.',
      });
    }

    const officeId = targetUser.user_metadata?.office_id || id;

    // 1. Eliminar de Supabase Auth o memoria
    if (supabaseAdmin) {
      const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(id);
      if (delErr) throw delErr;
    } else {
      const idx = inMemoryOffices.findIndex((u) => u.id === id);
      if (idx !== -1) inMemoryOffices.splice(idx, 1);
    }

    // 2. Revocar todas las sesiones del usuario
    try {
      await SessionService.revokeAllUserSessions(id);
    } catch (sessErr) {
      console.warn('[Admin Controller] Error revocando sesiones al eliminar:', sessErr.message);
    }

    // 3. Limpiar guías asociadas a esa oficina
    try {
      await GuidesModel.clearByOffice(officeId);
    } catch (gErr) {
      console.warn('[Admin Controller] Error limpiando guías al eliminar:', gErr.message);
    }

    return res.status(200).json({
      ok: true,
      message: `Oficina ${targetUser.email} eliminada correctamente`,
    });
  } catch (err) {
    console.error('[Admin Controller] Error en deleteOffice:', err);
    return res.status(500).json({ ok: false, message: 'INTERNAL_SERVER_ERROR', error: err.message });
  }
}

// ── Aprobación por Correo Electrónico (sin autenticación de sesión) ──────────

/**
 * Genera un token JWT de aprobación de corta duración para incluir en correos.
 * @param {string} userId - ID del usuario/oficina a aprobar.
 * @param {string} [displayName] - Nombre de la oficina (informativo en el token).
 * @returns {string} Token JWT firmado.
 */
export function generateApprovalToken(userId, displayName = '') {
  const secret = process.env.JWT_SECRET || process.env.SECRET_KEY;
  if (!secret) throw new Error('MISSING_JWT_SECRET_IN_ENVS');

  return jwt.sign(
    {
      userId,
      displayName,
      purpose: 'email_office_approval',
    },
    secret,
    { expiresIn: '48h' }
  );
}

/**
 * Aprueba una oficina pendiente directamente desde un enlace en el correo.
 * No requiere autenticación de sesión — el token firmado actúa como autorización.
 * GET /api/admin/approve-by-email?token=...
 */
export async function approveOfficeByEmail(req, res) {
  const { token } = req.query;

  if (!token) {
    return res.status(400).send(buildHtmlResponse(
      '⚠️ Enlace Inválido',
      'El enlace de aprobación no contiene un token válido.',
      'error'
    ));
  }

  // 1. Verificar y decodificar el token
  let decoded;
  try {
    const secret = process.env.JWT_SECRET || process.env.SECRET_KEY;
    if (!secret) throw new Error('MISSING_JWT_SECRET_IN_ENVS');
    decoded = jwt.verify(token, secret);
  } catch (err) {
    const isExpired = err instanceof jwt.TokenExpiredError;
    return res.status(403).send(buildHtmlResponse(
      isExpired ? '⏰ Enlace Expirado' : '🔒 Enlace Inválido',
      isExpired
        ? 'Este enlace de aprobación ha expirado (máximo 48 horas). Aprueba la oficina desde el panel administrativo.'
        : 'El token de aprobación es inválido o fue manipulado.',
      'error'
    ));
  }

  // 2. Verificar que el propósito del token sea específicamente aprobación por email
  if (decoded.purpose !== 'email_office_approval') {
    return res.status(403).send(buildHtmlResponse(
      '🔒 Token No Autorizado',
      'Este token no está autorizado para aprobar oficinas.',
      'error'
    ));
  }

  const userId = decoded.userId;
  const displayName = decoded.displayName || '';

  // 3. Buscar el usuario
  try {
    let targetUser = null;

    if (supabaseAdmin) {
      const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
      if (error || !data?.user) {
        return res.status(404).send(buildHtmlResponse(
          '❌ Oficina No Encontrada',
          `No se encontró la oficina con ID ${userId}. Es posible que ya haya sido eliminada.`,
          'error'
        ));
      }
      targetUser = data.user;
    } else {
      targetUser = inMemoryOffices.find((u) => u.id === userId);
      if (!targetUser) {
        return res.status(404).send(buildHtmlResponse(
          '❌ Oficina No Encontrada',
          `No se encontró la oficina con ID ${userId}.`,
          'error'
        ));
      }
    }

    // 4. Verificar idempotencia: si ya fue aprobada, responder sin error
    const currentStatus = targetUser.user_metadata?.subscription_status || targetUser.user_metadata?.status;
    if (currentStatus && currentStatus !== 'pending_approval') {
      const statusLabels = {
        trial: 'periodo de prueba activo (5 días)',
        active: 'suscripción activa',
        suspended: 'suspendida',
        expired: 'periodo de prueba vencido',
      };
      const statusLabel = statusLabels[currentStatus] || currentStatus;
      return res.status(200).send(buildHtmlResponse(
        'ℹ️ Oficina Ya Procesada',
        `La oficina <strong>${targetUser.user_metadata?.display_name || targetUser.email}</strong> ya tiene estado: <strong>${statusLabel}</strong>. No se requiere acción adicional.`,
        'info'
      ));
    }

    // 5. Aprobar: cambiar a trial y registrar fecha de aprobación
    const updatedMeta = {
      ...targetUser.user_metadata,
      subscription_status: 'trial',
      approved_at: new Date().toISOString(),
    };

    if (supabaseAdmin) {
      const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        user_metadata: updatedMeta,
      });
      if (updateErr) throw updateErr;
    } else {
      targetUser.user_metadata = updatedMeta;
    }

    const officeName = updatedMeta.display_name || targetUser.email;
    console.log(`[Admin] Oficina "${officeName}" aprobada por enlace de correo (trial 5 días)`);

    return res.status(200).send(buildHtmlResponse(
      '✅ Oficina Aprobada',
      `La oficina <strong>${officeName}</strong> ha sido aprobada exitosamente.<br><br>Su periodo de prueba de <strong>5 días</strong> ha iniciado a partir de este momento.`,
      'success'
    ));
  } catch (err) {
    console.error('[Admin Controller] Error en approveOfficeByEmail:', err);
    return res.status(500).send(buildHtmlResponse(
      '❌ Error Interno',
      'Ocurrió un error al procesar la aprobación. Intenta desde el panel administrativo.',
      'error'
    ));
  }
}

/**
 * Genera una página HTML de respuesta para el navegador del administrador.
 */
function buildHtmlResponse(title, message, type = 'success') {
  const colors = {
    success: { bg: '#ecfdf5', border: '#6ee7b7', icon: '✅', accent: '#059669' },
    error:   { bg: '#fef2f2', border: '#fca5a5', icon: '❌', accent: '#dc2626' },
    info:    { bg: '#eff6ff', border: '#93c5fd', icon: 'ℹ️', accent: '#2563eb' },
  };
  const c = colors[type] || colors.info;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Guides Admin</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f1f5f9; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { max-width: 480px; width: 100%; background: #fff; border-radius: 16px; border: 1px solid #e2e8f0; box-shadow: 0 4px 14px rgba(0,0,0,0.06); overflow: hidden; }
    .card-header { background: linear-gradient(135deg, #0ea5e9, #0284c7); padding: 20px 24px; text-align: center; }
    .card-header h1 { color: #fff; font-size: 18px; font-weight: 800; }
    .card-body { padding: 28px 24px; text-align: center; }
    .status-box { background: ${c.bg}; border: 1px solid ${c.border}; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
    .status-icon { font-size: 36px; margin-bottom: 8px; }
    .status-title { font-size: 16px; font-weight: 700; color: ${c.accent}; margin-bottom: 8px; }
    .status-msg { font-size: 13px; color: #475569; line-height: 1.6; }
    .status-msg strong { color: #0f172a; }
    .footer { padding: 14px 24px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #f1f5f9; }
    a.btn { display: inline-block; margin-top: 12px; padding: 10px 20px; background: #0284c7; color: #fff; text-decoration: none; border-radius: 8px; font-size: 13px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <div class="card-header"><h1>Guides Admin</h1></div>
    <div class="card-body">
      <div class="status-box">
        <div class="status-icon">${c.icon}</div>
        <div class="status-title">${title}</div>
        <div class="status-msg">${message}</div>
      </div>
      <a href="https://tradeexpressguides.netlify.app/admin" class="btn">Ir al Panel Administrativo</a>
    </div>
    <div class="footer">Guides Admin Server — Aprobación por correo electrónico</div>
  </div>
</body>
</html>`;
}


