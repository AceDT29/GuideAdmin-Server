import { isUserAdmin } from '../lib/roles.js';

/**
 * Middleware que verifica que la oficina esté debidamente aprobada y con estado activo
 * antes de permitir operaciones con guías (escaneo, guardado, actualización o reseteo).
 */
export default function approvedOfficeMiddleware(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ ok: false, message: 'UNAUTHORIZED' });
  }

  // Administradores y Super Administradores siempre tienen acceso
  if (isUserAdmin(req.user)) {
    return next();
  }

  const status = req.user.status;

  if (status === 'pending_approval') {
    return res.status(403).json({
      ok: false,
      code: 'ACCOUNT_PENDING_APPROVAL',
      message: 'ACCOUNT_PENDING_APPROVAL',
      error: 'Tu cuenta está en espera de aprobación por el administrador. Podrás utilizar el escáner una vez que tu cuenta sea aprobada.',
    });
  }

  if (status === 'suspended') {
    return res.status(403).json({
      ok: false,
      code: 'ACCOUNT_SUSPENDED',
      message: 'ACCOUNT_SUSPENDED',
      error: 'Tu cuenta de oficina ha sido suspendida. Contacta al administrador para más información.',
    });
  }

  return next();
}

