import { supabaseAdmin } from "../../lib/supabaseConfig.js";
import jwt from 'jsonwebtoken';
import { SessionService } from '../../services/session.service.js';

const JWT_SECRET = process.env.JWT_SECRET || process.env.SECRET_KEY;
const ACCESS_TOKEN_EXPIRY = '15m';

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
  if (!JWT_SECRET) {
    throw new Error('MISSING_JWT_SECRET_IN_ENVS');
  }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

/**
 * Construye la respuesta estandarizada de usuario con sus tokens.
 */
function buildAuthResponse({ userId, email, displayName, officeId, accessToken, refreshToken, message }) {
  return {
    ok: true,
    message: message || 'Success',
    token: accessToken,
    accessToken,
    refreshToken,
    uid: userId,
    officeId,
    user: {
      uid: userId,
      email,
      displayName,
      officeId,
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

  try {
    let createdUser = null;

    if (supabaseAdmin) {
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          display_name: displayName,
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
        email,
        user_metadata: { display_name: displayName },
      };
    }

    const userId = createdUser.id;
    const officeId = createdUser.user_metadata?.office_id || userId;
    const name = createdUser.user_metadata?.display_name || displayName;

    const accessToken = createAccessToken({
      uid: userId,
      email: createdUser.email,
      displayName: name,
      officeId,
    });

    const session = await SessionService.createSession({
      userId,
      rememberMe: Boolean(rememberMe),
      deviceInfo: getDeviceInfo(req, deviceInfo),
      ipAddress: getClientIp(req),
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
    return res.status(200).json({
      ok: true,
      user: {
        uid: user.id || user.uid,
        email: user.email,
        displayName: user.user_metadata?.display_name || req.tokenPayload?.displayName || null,
        officeId: user.office_id || user.officeId || user.user_metadata?.office_id || user.id || user.uid,
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

    const accessToken = createAccessToken({
      uid: userId,
      email: authUser.email,
      displayName: name,
      officeId,
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
          };
        }
      } catch (supaErr) {
        // Fallback a los datos básicos de la sesión
      }
    }

    const newAccessToken = createAccessToken({
      uid: userDetails.id,
      email: userDetails.email,
      displayName: userDetails.displayName,
      officeId: userDetails.office_id,
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

export {
  registerUser,
  returnUser,
  loginUser,
  refreshTokenHandler,
  logoutUser,
  logoutAllDevices,
};