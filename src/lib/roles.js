/**
 * Definición central de roles y utilidades de autorización.
 */

export const SUPERADMIN_EMAIL = 'joseangelgarces123@gmail.com';

/**
 * Normaliza y determina el rol del usuario:
 * - 'superadmin' para la cuenta principal joseangelgarces123@gmail.com
 * - 'admin' para operadores promovidos a administradores
 * - 'operator' para oficinas estándar
 *
 * @param {Object} user - Objeto usuario con email y user_metadata
 * @returns {'superadmin' | 'admin' | 'operator'}
 */
export function getUserRole(user) {
  if (!user) return 'operator';
  const email = (user.email || '').toLowerCase().trim();
  if (email === SUPERADMIN_EMAIL) return 'superadmin';

  const role = user.user_metadata?.role || user.role;
  if (role === 'superadmin' || role === 'admin') return role;
  return 'operator';
}

/**
 * Verifica si el usuario tiene privilegios administrativos (superadmin o admin).
 * @param {Object} user
 * @returns {boolean}
 */
export function isUserAdmin(user) {
  const role = getUserRole(user);
  return role === 'superadmin' || role === 'admin';
}

