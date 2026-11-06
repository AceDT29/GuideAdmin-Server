import { isUserAdmin } from '../lib/roles.js';

/**
 * Middleware para restringir acceso exclusivo a Administradores y Super Administradores.
 * Requiere que se haya ejecutado previamente authMiddleware.
 */
export default function adminMiddleware(req, res, next) {
  try {
    if (!req.user || !isUserAdmin(req.user)) {
      return res.status(403).json({
        ok: false,
        message: 'FORBIDDEN_ADMIN_ACCESS_REQUIRED',
        error: 'Acceso denegado: se requieren privilegios de administrador para realizar esta operación.'
      });
    }
    return next();
  } catch (err) {
    console.error('[Admin Middleware] Error:', err);
    return res.status(500).json({
      ok: false,
      message: 'INTERNAL_SERVER_ERROR',
      error: err.message
    });
  }
}

