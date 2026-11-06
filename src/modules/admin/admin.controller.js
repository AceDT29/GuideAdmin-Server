import { supabaseAdmin } from '../../lib/supabaseConfig.js';
import { SUPERADMIN_EMAIL, getUserRole, isUserAdmin } from '../../lib/roles.js';
import { GuidesModel } from '../guides/guides.model.js';
import { SessionService } from '../../services/session.service.js';

// Fallback en memoria para tests y desarrollo aislado cuando supabaseAdmin es null
const inMemoryOffices = [
  {
    id: 'superadmin-root-id',
    email: SUPERADMIN_EMAIL,
    created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    last_sign_in_at: new Date().toISOString(),
    user_metadata: {
      display_name: 'José Ángel Garcés (Super Admin)',
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

