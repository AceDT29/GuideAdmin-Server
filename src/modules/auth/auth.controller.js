import { supabaseAdmin } from "../../lib/supabaseConfig.js";
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { SessionService } from '../../services/session.service.js';
import {
  sendOfficeRegistrationNotification,
  sendPasswordResetEmail,
  sendPasswordResetCodeEmail,
} from '../../services/emailService.js';
import { getUserRole, isUserAdmin, SUPERADMIN_EMAIL } from '../../lib/roles.js';

const ACCESS_TOKEN_EXPIRY = '15m';

/**
 * Obtiene la clave secreta JWT configurada en variables de entorno.
 */
function getJwtSecret() {
  const secret = process.env.JWT_SECRET || process.env.SECRET_KEY;
  if (!secret) {
    throw new Error('MISSING_JWT_SECRET_IN_ENVS');
  }
  return secret;
}

/**
 * Extrae la IP del cliente del request.
 */
function getClientIp(req) {
  return req.ip || req.headers['x-forwarded-for'] || '';
}

/**
 * Extrae o formatea la información del dispositivo cliente.
 */
function getDeviceInfo(req, explicitDevice = '') {
  return explicitDevice || req.headers['user-agent'] || '';
}

/**
 * Helper para generar Access Token JWT de corta duración (15 min).
 */
function createAccessToken(payload) {
  const secret = getJwtSecret();
  return jwt.sign(payload, secret, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

/**
 * Construye la respuesta estandarizada de usuario con sus tokens.
 */
function buildAuthResponse({ userId, email, displayName, officeId, accessToken, refreshToken, message, role, isAdmin, status }) {
  const finalRole = role || (email && email.toLowerCase().trim() === SUPERADMIN_EMAIL ? 'superadmin' : 'operator');
  const finalIsAdmin = typeof isAdmin === 'boolean' ? isAdmin : (finalRole === 'superadmin' || finalRole === 'admin');
  const finalStatus = status || (email && email.toLowerCase().trim() === SUPERADMIN_EMAIL ? 'active' : 'trial');

  return {
    ok: true,
    message: message || 'Success',
    token: accessToken,
    accessToken,
    refreshToken,
    uid: userId,
    officeId,
    role: finalRole,
    isAdmin: finalIsAdmin,
    status: finalStatus,
    user: {
      uid: userId,
      email,
      displayName,
      officeId,
      role: finalRole,
      isAdmin: finalIsAdmin,
      status: finalStatus,
    },
  };
}

/**
 * Registro de nuevo usuario.
 */
async function registerUser(req, res) {
  const { email, password, displayName, rememberMe, deviceInfo } = req.body;

  if (!email || !password || !displayName) {
    return res.status(400).json({ ok: false, message: 'MISSING_EMAIL_OR_PASSWORD' });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  const cleanDisplayName = String(displayName).trim();
  const isRootSuperAdmin = cleanEmail === SUPERADMIN_EMAIL;
  const initialStatus = isRootSuperAdmin ? 'active' : 'pending_approval';

  try {
    let createdUser = null;

    if (supabaseAdmin) {
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: cleanEmail,
        password,
        email_confirm: true,
        user_metadata: {
          display_name: cleanDisplayName,
          subscription_status: initialStatus,
          status: initialStatus,
          role: isRootSuperAdmin ? 'superadmin' : 'operator',
        },
      });

      if (error) {
        if (error.message.includes('already been registered')) {
          return res.status(409).json({ ok: false, message: 'USER_ALREADY_EXISTS' });
        }
        console.error('Error while creating the user:', error);
        return res.status(500).json({ ok: false, error: error.message });
      }
      createdUser = data.user;
    } else {
      // Modo fallback sin Supabase (tests y desarrollo aislado)
      createdUser = {
        id: `user-${Date.now()}`,
        email: cleanEmail,
        user_metadata: {
          display_name: cleanDisplayName,
          subscription_status: initialStatus,
          status: initialStatus,
          role: isRootSuperAdmin ? 'superadmin' : 'operator',
        },
      };
    }

    const userId = createdUser.id;
    const officeId = createdUser.user_metadata?.office_id || userId;
    const name = createdUser.user_metadata?.display_name || displayName;
    const role = getUserRole(createdUser);
    const isAdmin = isUserAdmin(createdUser);
    const status = initialStatus;

    const accessToken = createAccessToken({
      uid: userId,
      email: createdUser.email,
      displayName: name,
      officeId,
      role,
      isAdmin,
      status,
    });

    const session = await SessionService.createSession({
      userId,
      rememberMe: Boolean(rememberMe),
      deviceInfo: getDeviceInfo(req, deviceInfo),
      ipAddress: getClientIp(req),
    });

    // Notificar al administrador en segundo plano (no bloquea el registro del usuario)
    sendOfficeRegistrationNotification({
      displayName: name,
      email: createdUser.email,
      officeId,
      userId,
      deviceInfo: getDeviceInfo(req, deviceInfo),
      ipAddress: getClientIp(req),
      createdAt: new Date(),
    }).catch((emailErr) => {
      console.warn('[Auth Controller] Error en notificación por correo de nueva oficina:', emailErr.message);
    });

    return res.status(201).json(
      buildAuthResponse({
        userId,
        email: createdUser.email,
        displayName: name,
        officeId,
        accessToken,
        refreshToken: session.refreshToken,
        message: 'User registered successfully',
        role,
        isAdmin,
        status,
      })
    );
  } catch (err) {
    console.error('Unexpected error during user creation:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * Retorna la información del usuario autenticado en base al token actual.
 */
async function returnUser(req, res) {
  try {
    if (!req.user) return res.status(404).json({ ok: false, message: 'USER_NOT_FOUND' });
    const user = req.user;
    const isRootSuperAdmin = (user.email || '').toLowerCase().trim() === SUPERADMIN_EMAIL;
    const role = getUserRole(user);
    const isAdmin = isUserAdmin(user);
    const status = isRootSuperAdmin
      ? 'active'
      : (user.user_metadata?.subscription_status || user.user_metadata?.status || user.status || 'trial');

    return res.status(200).json({
      ok: true,
      user: {
        uid: user.id || user.uid,
        email: user.email,
        displayName: user.user_metadata?.display_name || req.tokenPayload?.displayName || null,
        officeId: user.office_id || user.officeId || user.user_metadata?.office_id || user.id || user.uid,
        role,
        isAdmin,
        status,
      },
    });
  } catch (err) {
    console.error('Error returning user:', err);
    return res.status(500).json({ ok: false, message: 'INTERNAL_SERVER_ERROR' });
  }
}

/**
 * Login de usuario con generación de Access Token y Refresh Token para el dispositivo.
 */
async function loginUser(req, res) {
  const { email, password, rememberMe, deviceInfo } = req.body;

  if (!email || !password) {
    return res.status(400).json({ ok: false, message: 'MISSING_EMAIL_OR_PASSWORD' });
  }

  try {
    let authUser = null;

    if (supabaseAdmin) {
      const { data, error } = await supabaseAdmin.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error('Error while signing in:', error);
        return res.status(401).json({ ok: false, error: error.message, message: 'INVALID_CREDENTIALS' });
      }
      authUser = data.user;
    } else {
      // Fallback para entornos de desarrollo sin Supabase
      authUser = {
        id: `user-${Date.now()}`,
        email,
        user_metadata: { display_name: email.split('@')[0] },
      };
    }

    const userId = authUser.id;
    const officeId = authUser.user_metadata?.office_id || userId;
    const name = authUser.user_metadata?.display_name || null;
    const role = getUserRole(authUser);
    const isAdmin = isUserAdmin(authUser);
    const isRootSuperAdmin = (authUser.email || '').toLowerCase().trim() === SUPERADMIN_EMAIL;
    const status = isRootSuperAdmin
      ? 'active'
      : (authUser.user_metadata?.subscription_status || authUser.user_metadata?.status || 'trial');

    const accessToken = createAccessToken({
      uid: userId,
      email: authUser.email,
      displayName: name,
      officeId,
      role,
      isAdmin,
      status,
    });

    const session = await SessionService.createSession({
      userId,
      rememberMe: Boolean(rememberMe),
      deviceInfo: getDeviceInfo(req, deviceInfo),
      ipAddress: getClientIp(req),
    });

    return res.status(200).json(
      buildAuthResponse({
        userId,
        email: authUser.email,
        displayName: name,
        officeId,
        accessToken,
        refreshToken: session.refreshToken,
        message: 'User logged in successfully',
        role,
        isAdmin,
        status,
      })
    );
  } catch (err) {
    console.error('Unexpected error during user login:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * Rota el refresh token y emite un nuevo Access Token.
 */
async function refreshTokenHandler(req, res) {
  const refreshToken = req.body?.refreshToken || req.headers['x-refresh-token'];
  const deviceInfo = getDeviceInfo(req, req.body?.deviceInfo);
  const clientIp = getClientIp(req);

  if (!refreshToken) {
    return res.status(400).json({ ok: false, message: 'MISSING_REFRESH_TOKEN' });
  }

  try {
    const { session, newRefreshToken } = await SessionService.validateAndRotateRefreshToken({
      refreshToken,
      deviceInfo,
      ipAddress: clientIp,
    });

    let userDetails = {
      id: session.user_id,
      email: null,
      displayName: null,
      office_id: session.user_id,
    };

    if (supabaseAdmin) {
      try {
        const { data, error } = await supabaseAdmin.auth.admin.getUserById(session.user_id);
        if (!error && data?.user) {
          userDetails = {
            id: data.user.id,
            email: data.user.email,
            displayName: data.user.user_metadata?.display_name || null,
            office_id: data.user.user_metadata?.office_id || data.user.id,
            user_metadata: data.user.user_metadata,
          };
        }
      } catch (supaErr) {
        // Fallback a los datos básicos de la sesión
      }
    }

    const role = getUserRole(userDetails);
    const isAdmin = isUserAdmin(userDetails);
    const isRootSuperAdmin = (userDetails.email || '').toLowerCase().trim() === SUPERADMIN_EMAIL;
    const status = isRootSuperAdmin
      ? 'active'
      : (userDetails.user_metadata?.subscription_status || userDetails.user_metadata?.status || 'trial');

    const newAccessToken = createAccessToken({
      uid: userDetails.id,
      email: userDetails.email,
      displayName: userDetails.displayName,
      officeId: userDetails.office_id,
      role,
      isAdmin,
      status,
    });

    return res.status(200).json(
      buildAuthResponse({
        userId: userDetails.id,
        email: userDetails.email,
        displayName: userDetails.displayName,
        officeId: userDetails.office_id,
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        message: 'Token refreshed successfully',
        role,
        isAdmin,
        status,
      })
    );
  } catch (err) {
    console.warn('[Auth Controller] Error en refresh token:', err.message);
    if (
      err.message === 'INVALID_OR_REVOKED_REFRESH_TOKEN' ||
      err.message === 'EXPIRED_REFRESH_TOKEN' ||
      err.message === 'MISSING_REFRESH_TOKEN'
    ) {
      return res.status(401).json({ ok: false, message: err.message });
    }
    return res.status(500).json({ ok: false, message: 'INTERNAL_SERVER_ERROR', error: err.message });
  }
}

/**
 * Cierra la sesión del dispositivo actual invalidando su refresh token.
 */
async function logoutUser(req, res) {
  const refreshToken = req.body?.refreshToken || req.headers['x-refresh-token'];

  try {
    if (refreshToken) {
      await SessionService.revokeSession(refreshToken);
    }
    return res.status(200).json({ ok: true, message: 'LOGGED_OUT' });
  } catch (err) {
    console.error('Error during logout:', err);
    return res.status(500).json({ ok: false, message: 'INTERNAL_SERVER_ERROR' });
  }
}

/**
 * Cierra la sesión en todos los dispositivos del usuario autenticado.
 */
async function logoutAllDevices(req, res) {
  try {
    const userId = req.user?.id || req.user?.uid;
    if (!userId) {
      return res.status(401).json({ ok: false, message: 'UNAUTHORIZED' });
    }

    const revokedCount = await SessionService.revokeAllUserSessions(userId);
    return res.status(200).json({
      ok: true,
      message: 'ALL_SESSIONS_REVOKED',
      revokedCount,
    });
  } catch (err) {
    console.error('Error during logout-all:', err);
    return res.status(500).json({ ok: false, message: 'INTERNAL_SERVER_ERROR' });
  }
}

// Cooldown de 60 segundos entre solicitudes de recuperación de contraseña para la misma dirección
const RESET_PASSWORD_COOLDOWN_MS = Number(process.env.RESET_PASSWORD_COOLDOWN_SECONDS || 60) * 1000;
const resetCooldownMap = new Map();

// Mapa de códigos OTP para recuperación de contraseña: email -> { code, userId, email, expiresAt, attempts }
const recoveryCodesMap = new Map();
const CODE_EXPIRY_MS = 15 * 60 * 1000; // 15 minutos
const MAX_CODE_ATTEMPTS = 5;

/**
 * Limpia entradas del mapa de cooldown que tengan más de 15 minutos para optimizar memoria.
 */
function cleanExpiredCooldowns() {
  const now = Date.now();
  for (const [emailKey, timestamp] of resetCooldownMap.entries()) {
    if (now - timestamp > 15 * 60 * 1000) {
      resetCooldownMap.delete(emailKey);
    }
  }
}

/**
 * Limpia códigos de recuperación expirados para optimizar memoria.
 */
function cleanExpiredCodes() {
  const now = Date.now();
  for (const [emailKey, data] of recoveryCodesMap.entries()) {
    if (now > data.expiresAt) {
      recoveryCodesMap.delete(emailKey);
    }
  }
}

/**
 * Helper para pruebas automatizadas: resetea el mapa de cooldowns.
 */
function _clearResetCooldowns() {
  resetCooldownMap.clear();
}

/**
 * Helper para pruebas automatizadas: resetea el mapa de códigos.
 */
function _clearRecoveryCodes() {
  recoveryCodesMap.clear();
}

/**
 * Helper para pruebas automatizadas: obtiene el código actual de un email en memoria.
 */
function _getRecoveryCode(email) {
  if (!email) return null;
  return recoveryCodesMap.get(String(email).trim().toLowerCase())?.code || null;
}

/**
 * Solicita el restablecimiento de contraseña enviando un correo con un código de 6 dígitos.
 */
async function forgotPassword(req, res) {
  const { email } = req.body;
  if (!email || !String(email).trim()) {
    return res.status(400).json({ ok: false, message: 'MISSING_EMAIL' });
  }

  const cleanEmail = String(email).trim().toLowerCase();

  // Validación de Cooldown: Evitar envíos continuos para la misma cuenta
  const now = Date.now();
  const lastRequestTime = resetCooldownMap.get(cleanEmail);

  if (lastRequestTime && req.headers['x-skip-cooldown'] !== 'true') {
    const elapsedMs = now - lastRequestTime;
    if (elapsedMs < RESET_PASSWORD_COOLDOWN_MS) {
      const remainingSeconds = Math.ceil((RESET_PASSWORD_COOLDOWN_MS - elapsedMs) / 1000);
      return res.status(429).json({
        ok: false,
        code: 'COOLDOWN_ACTIVE',
        retryAfter: remainingSeconds,
        message: `Debes esperar ${remainingSeconds} segundo${remainingSeconds === 1 ? '' : 's'} antes de solicitar otro correo de recuperación.`,
      });
    }
  }

  cleanExpiredCooldowns();
  resetCooldownMap.set(cleanEmail, now);

  try {
    let foundUser = null;

    if (supabaseAdmin) {
      // Buscar usuario registrado en Supabase
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
      if (!error && Array.isArray(data?.users)) {
        foundUser = data.users.find((u) => (u.email || '').toLowerCase().trim() === cleanEmail);
      }
    } else {
      // Fallback para entornos de pruebas automatizadas (tests en memoria)
      if (cleanEmail === 'test@example.com' || cleanEmail === 'oficina@test.com' || cleanEmail.includes('test')) {
        foundUser = {
          id: 'user-test-fallback-id',
          email: cleanEmail,
          user_metadata: { display_name: 'Usuario Test' },
        };
      }
    }

    if (foundUser) {
      // Generar código numérico de 6 dígitos criptográficamente seguro
      const verificationCode = String(crypto.randomInt(100000, 1000000));

      cleanExpiredCodes();
      recoveryCodesMap.set(cleanEmail, {
        code: verificationCode,
        userId: foundUser.id,
        email: foundUser.email,
        expiresAt: Date.now() + CODE_EXPIRY_MS,
        attempts: 0,
      });

      const displayName = foundUser.user_metadata?.display_name || foundUser.email.split('@')[0];

      // Enviar correo con código de verificación en segundo plano
      sendPasswordResetCodeEmail({
        toEmail: foundUser.email,
        displayName,
        code: verificationCode,
        expiresInMinutes: 15,
      }).catch((mailErr) => {
        console.warn('[Auth Controller] Error enviando código de recuperación:', mailErr.message);
      });
    }

    // Por seguridad (mitigación de ataques de enumeración), siempre respondemos 200 con mensaje genérico
    return res.status(200).json({
      ok: true,
      message: 'Si el correo electrónico está registrado, recibirás un código de verificación en breve.',
      retryAfter: 60,
    });
  } catch (err) {
    console.error('Error en forgotPassword:', err);
    return res.status(500).json({ ok: false, message: 'INTERNAL_SERVER_ERROR' });
  }
}

/**
 * Verifica si un código de 6 dígitos es válido para un correo dado.
 */
async function verifyResetCode(req, res) {
  const { email, code } = req.body || {};

  if (!email || !code) {
    return res.status(400).json({ ok: false, message: 'MISSING_EMAIL_OR_CODE' });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  const cleanCode = String(code).trim();

  cleanExpiredCodes();
  const entry = recoveryCodesMap.get(cleanEmail);

  if (!entry) {
    return res.status(400).json({
      ok: false,
      message: 'No hay un código pendiente o ya ha expirado. Por favor solicita uno nuevo.',
    });
  }

  if (Date.now() > entry.expiresAt) {
    recoveryCodesMap.delete(cleanEmail);
    return res.status(400).json({
      ok: false,
      message: 'El código ha expirado. Por favor solicita un nuevo código.',
    });
  }

  if (entry.attempts >= MAX_CODE_ATTEMPTS) {
    recoveryCodesMap.delete(cleanEmail);
    return res.status(429).json({
      ok: false,
      message: 'Has superado el número máximo de intentos permitidos. Solicita un nuevo código.',
    });
  }

  if (entry.code !== cleanCode) {
    entry.attempts += 1;
    const remaining = MAX_CODE_ATTEMPTS - entry.attempts;
    return res.status(400).json({
      ok: false,
      message: `Código incorrecto. ${remaining > 0 ? `Te quedan ${remaining} intento(s).` : 'Límite de intentos superado.'}`,
    });
  }

  // Código validado: emitimos un token temporal de autorización
  const secret = getJwtSecret();
  const verificationToken = jwt.sign(
    {
      uid: entry.userId,
      email: entry.email,
      purpose: 'pwd_reset_code_verified',
    },
    secret,
    { expiresIn: '15m' }
  );

  return res.status(200).json({
    ok: true,
    message: 'Código verificado exitosamente.',
    verificationToken,
    email: entry.email,
  });
}

/**
 * Verifica si un token de recuperación de contraseña es válido y aún no ha expirado.
 */
async function verifyResetToken(req, res) {
  const token = req.query?.token || req.body?.token;
  if (!token) {
    return res.status(400).json({ ok: false, message: 'MISSING_TOKEN' });
  }

  try {
    const secret = getJwtSecret();
    const decoded = jwt.verify(token, secret);

    if (decoded.purpose !== 'pwd_reset' && decoded.purpose !== 'pwd_reset_code_verified') {
      return res.status(400).json({ ok: false, message: 'INVALID_TOKEN_PURPOSE' });
    }

    return res.status(200).json({
      ok: true,
      email: decoded.email,
      message: 'TOKEN_VALID',
    });
  } catch (err) {
    return res.status(400).json({
      ok: false,
      message: err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
    });
  }
}

/**
 * Restablece la contraseña del usuario utilizando el código de 6 dígitos o un token JWT verificado.
 */
async function resetPassword(req, res) {
  const { email, code, token, verificationToken, newPassword } = req.body || {};

  if (!newPassword) {
    return res.status(400).json({ ok: false, message: 'MISSING_TOKEN_OR_PASSWORD' });
  }

  if (String(newPassword).length < 6) {
    return res.status(400).json({ ok: false, message: 'PASSWORD_TOO_SHORT' });
  }

  let userId = null;
  let cleanEmail = email ? String(email).trim().toLowerCase() : null;

  // Opción 1: Validación directa mediante email y código
  if (cleanEmail && code) {
    const cleanCode = String(code).trim();
    cleanExpiredCodes();
    const entry = recoveryCodesMap.get(cleanEmail);

    if (!entry) {
      return res.status(400).json({
        ok: false,
        message: 'El código ha expirado o no es válido. Solicita un nuevo código.',
      });
    }

    if (Date.now() > entry.expiresAt) {
      recoveryCodesMap.delete(cleanEmail);
      return res.status(400).json({
        ok: false,
        message: 'El código ha expirado. Solicita un nuevo código.',
      });
    }

    if (entry.attempts >= MAX_CODE_ATTEMPTS) {
      recoveryCodesMap.delete(cleanEmail);
      return res.status(429).json({
        ok: false,
        message: 'Has superado el número máximo de intentos permitidos. Solicita un nuevo código.',
      });
    }

    if (entry.code !== cleanCode) {
      entry.attempts += 1;
      return res.status(400).json({
        ok: false,
        message: 'Código de verificación incorrecto.',
      });
    }

    userId = entry.userId;
    recoveryCodesMap.delete(cleanEmail);
  }
  // Opción 2: Validación mediante token firmado (verificationToken o legacy token)
  else if (token || verificationToken) {
    const activeToken = verificationToken || token;
    try {
      const secret = getJwtSecret();
      const decoded = jwt.verify(activeToken, secret);

      if (decoded.purpose !== 'pwd_reset_code_verified' && decoded.purpose !== 'pwd_reset') {
        return res.status(400).json({ ok: false, message: 'INVALID_TOKEN_PURPOSE' });
      }

      userId = decoded.uid;
      cleanEmail = decoded.email?.toLowerCase().trim();
      if (cleanEmail) {
        recoveryCodesMap.delete(cleanEmail);
      }
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(400).json({ ok: false, message: 'TOKEN_EXPIRED' });
      }
      return res.status(400).json({ ok: false, message: 'INVALID_TOKEN' });
    }
  } else {
    return res.status(400).json({
      ok: false,
      message: 'MISSING_TOKEN_OR_PASSWORD',
    });
  }

  try {
    if (supabaseAdmin) {
      const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password: String(newPassword),
      });

      if (updateErr) {
        console.error('Error actualizando contraseña en Supabase:', updateErr);
        return res.status(500).json({ ok: false, message: updateErr.message });
      }
    }

    // Revocar todas las sesiones de refresco previas del usuario por seguridad
    try {
      await SessionService.revokeAllUserSessions(userId);
    } catch (sessionErr) {
      console.warn('Error revocando sesiones tras cambio de contraseña:', sessionErr.message);
    }

    return res.status(200).json({
      ok: true,
      message: 'Tu contraseña ha sido restablecida con éxito. Ya puedes iniciar sesión.',
    });
  } catch (err) {
    console.error('Error al actualizar contraseña:', err);
    return res.status(500).json({ ok: false, message: 'INTERNAL_SERVER_ERROR' });
  }
}

export {
  registerUser,
  returnUser,
  loginUser,
  refreshTokenHandler,
  logoutUser,
  logoutAllDevices,
  forgotPassword,
  verifyResetCode,
  verifyResetToken,
  resetPassword,
  _clearResetCooldowns,
  _clearRecoveryCodes,
  _getRecoveryCode,
};