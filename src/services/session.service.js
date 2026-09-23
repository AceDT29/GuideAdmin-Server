import crypto from 'node:crypto';
import { supabaseAdmin } from '../lib/supabaseConfig.js';

// Almacenamiento en memoria (fallback en caso de que Supabase no esté disponible o la tabla no haya sido creada aún)
const inMemorySessions = [];

/**
 * Genera un token aleatorio criptográficamente seguro en formato hexadecimal.
 * @returns {string}
 */
export function generateRefreshToken() {
  return crypto.randomBytes(40).toString('hex');
}

/**
 * Calcula el hash SHA-256 de un token para almacenamiento seguro.
 * @param {string} token
 * @returns {string}
 */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export class SessionService {
  /**
   * Crea una nueva sesión para un usuario.
   * @param {Object} params
   * @param {string} params.userId
   * @param {boolean} [params.rememberMe=false]
   * @param {string} [params.deviceInfo='']
   * @param {string} [params.ipAddress='']
   * @returns {Promise<{ sessionId: string, refreshToken: string, expiresAt: Date }>}
   */
  static async createSession({ userId, rememberMe = false, deviceInfo = '', ipAddress = '' }) {
    const isRemembered = Boolean(rememberMe);
    // 90 días si rememberMe es true, 24 horas si es false
    const durationMs = isRemembered
      ? 90 * 24 * 60 * 60 * 1000
      : 24 * 60 * 60 * 1000;
    
    const expiresAt = new Date(Date.now() + durationMs);
    const refreshToken = generateRefreshToken();
    const refreshTokenHash = hashToken(refreshToken);

    const sessionRecord = {
      id: crypto.randomUUID(),
      user_id: userId,
      refresh_token_hash: refreshTokenHash,
      device_info: deviceInfo || 'Unknown Device',
      ip_address: ipAddress || 'Unknown IP',
      remember_me: isRemembered,
      expires_at: expiresAt.toISOString(),
      created_at: new Date().toISOString(),
      last_used_at: new Date().toISOString(),
      is_revoked: false,
    };

    if (supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('user_sessions')
        .insert(sessionRecord)
        .select()
        .single();

      if (!error && data) {
        return {
          sessionId: data.id,
          refreshToken,
          expiresAt,
        };
      }

      if (error && error.code === 'PGRST205') {
        console.warn('[SessionService] Tabla user_sessions no encontrada en Supabase. Usando fallback en memoria temporal.');
      } else if (error) {
        console.error('[SessionService] Error al crear sesión en Supabase:', error);
      }
    }

    // Fallback en memoria
    inMemorySessions.push(sessionRecord);
    return {
      sessionId: sessionRecord.id,
      refreshToken,
      expiresAt,
    };
  }

  /**
   * Valida un Refresh Token y realiza su rotación atómica por uno nuevo.
   * @param {Object} params
   * @param {string} params.refreshToken
   * @param {string} [params.deviceInfo]
   * @param {string} [params.ipAddress]
   * @returns {Promise<{ session: Object, newRefreshToken: string }>}
   */
  static async validateAndRotateRefreshToken({ refreshToken, deviceInfo = '', ipAddress = '' }) {
    if (!refreshToken) {
      throw new Error('MISSING_REFRESH_TOKEN');
    }

    const tokenHash = hashToken(refreshToken);
    const now = new Date();

    if (supabaseAdmin) {
      const { data: session, error } = await supabaseAdmin
        .from('user_sessions')
        .select('*')
        .eq('refresh_token_hash', tokenHash)
        .eq('is_revoked', false)
        .maybeSingle();

      if (!error && session) {
        if (new Date(session.expires_at) <= now) {
          // Marcar como revocada por expiración
          await supabaseAdmin
            .from('user_sessions')
            .update({ is_revoked: true })
            .eq('id', session.id);
          throw new Error('EXPIRED_REFRESH_TOKEN');
        }

        // Rotación: Generar nuevo token y actualizar registro
        const newRefreshToken = generateRefreshToken();
        const newHash = hashToken(newRefreshToken);

        const updateData = {
          refresh_token_hash: newHash,
          last_used_at: now.toISOString(),
        };
        if (deviceInfo) updateData.device_info = deviceInfo;
        if (ipAddress) updateData.ip_address = ipAddress;

        const { data: updatedSession, error: updateError } = await supabaseAdmin
          .from('user_sessions')
          .update(updateData)
          .eq('id', session.id)
          .select()
          .single();

        if (updateError) {
          console.error('[SessionService] Error al rotar token en Supabase:', updateError);
          throw updateError;
        }

        return {
          session: updatedSession,
          newRefreshToken,
        };
      }

      if (error && error.code !== 'PGRST205') {
        console.error('[SessionService] Error al buscar sesión en Supabase:', error);
      }
    }

    // Fallback en memoria
    const sessionIndex = inMemorySessions.findIndex(
      (s) => s.refresh_token_hash === tokenHash && !s.is_revoked
    );

    if (sessionIndex === -1) {
      throw new Error('INVALID_OR_REVOKED_REFRESH_TOKEN');
    }

    const session = inMemorySessions[sessionIndex];
    if (new Date(session.expires_at) <= now) {
      session.is_revoked = true;
      throw new Error('EXPIRED_REFRESH_TOKEN');
    }

    const newRefreshToken = generateRefreshToken();
    const newHash = hashToken(newRefreshToken);

    session.refresh_token_hash = newHash;
    session.last_used_at = now.toISOString();
    if (deviceInfo) session.device_info = deviceInfo;
    if (ipAddress) session.ip_address = ipAddress;

    return {
      session,
      newRefreshToken,
    };
  }

  /**
   * Revoca una sesión específica mediante su refresh token actual.
   * @param {string} refreshToken
   * @returns {Promise<boolean>}
   */
  static async revokeSession(refreshToken) {
    if (!refreshToken) return false;
    const tokenHash = hashToken(refreshToken);
    let revokedInDb = false;

    if (supabaseAdmin) {
      try {
        const { data, error } = await supabaseAdmin
          .from('user_sessions')
          .update({ is_revoked: true })
          .eq('refresh_token_hash', tokenHash)
          .select('id');

        if (!error && data && data.length > 0) {
          revokedInDb = true;
        }
      } catch (e) {
        // Fallback
      }
    }

    // Actualizar también en memoria
    const session = inMemorySessions.find((s) => s.refresh_token_hash === tokenHash);
    if (session) {
      session.is_revoked = true;
      return true;
    }
    return revokedInDb;
  }

  /**
   * Revoca todas las sesiones activas de un usuario (logout en todos los dispositivos).
   * @param {string} userId
   * @returns {Promise<number>} Cantidad de sesiones revocadas.
   */
  static async revokeAllUserSessions(userId) {
    if (!userId) return 0;
    let countInDb = 0;

    if (supabaseAdmin) {
      try {
        const { data, error, count } = await supabaseAdmin
          .from('user_sessions')
          .update({ is_revoked: true }, { count: 'exact' })
          .eq('user_id', userId)
          .eq('is_revoked', false)
          .select('id');

        if (!error) {
          countInDb = count || (data ? data.length : 0);
        }
      } catch (e) {
        // Fallback
      }
    }

    // Actualizar también en memoria
    let memCount = 0;
    for (const session of inMemorySessions) {
      if (session.user_id === userId && !session.is_revoked) {
        session.is_revoked = true;
        memCount++;
      }
    }
    return countInDb + memCount;
  }

  /**
   * Elimina sesiones expiradas o revocadas de la base de datos (mantenimiento periódico).
   * @returns {Promise<{ deletedCount: number }>}
   */
  static async cleanupExpiredSessions() {
    const nowIso = new Date().toISOString();

    if (supabaseAdmin) {
      const { error, count } = await supabaseAdmin
        .from('user_sessions')
        .delete({ count: 'exact' })
        .lt('expires_at', nowIso);

      if (!error) {
        return { deletedCount: count || 0 };
      }
      if (error && error.code !== 'PGRST205') {
        console.error('[SessionService] Error al limpiar sesiones expiradas en Supabase:', error);
      }
    }

    // Fallback en memoria
    const initialCount = inMemorySessions.length;
    for (let i = inMemorySessions.length - 1; i >= 0; i--) {
      if (new Date(inMemorySessions[i].expires_at) < new Date()) {
        inMemorySessions.splice(i, 1);
      }
    }
    return { deletedCount: initialCount - inMemorySessions.length };
  }
}
