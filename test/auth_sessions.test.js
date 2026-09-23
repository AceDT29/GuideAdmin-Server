import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key-1234567890';

// Mockear la configuración de Supabase para asegurar que los tests 
// usen siempre el fallback de memoria y no dependan de credenciales reales ni fallen en CI.
jest.unstable_mockModule('../src/lib/supabaseConfig.js', () => ({
  supabaseAdmin: null,
}));

const { createApp } = await import('../index.js');
const { SessionService } = await import('../src/services/session.service.js');

describe('Auth & Multi-Device Session System Tests', () => {
  let app;
  let server;
  let baseUrl;

  beforeAll(async () => {
    const setup = createApp();
    app = setup.app;
    server = setup.chatServer;
    await new Promise((resolve) => {
      server.listen(0, () => {
        const address = server.address();
        baseUrl = `http://localhost:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  describe('SessionService Unit Tests', () => {
    test('createSession handles rememberMe true (90 days) and false (24 hours)', async () => {
      const sessionShort = await SessionService.createSession({
        userId: 'user-unit-1',
        rememberMe: false,
        deviceInfo: 'Scanner Gun 1',
      });

      const sessionLong = await SessionService.createSession({
        userId: 'user-unit-1',
        rememberMe: true,
        deviceInfo: 'Desktop PC Office',
      });

      expect(sessionShort.refreshToken).toBeDefined();
      expect(sessionLong.refreshToken).toBeDefined();

      const diffShortHours = (sessionShort.expiresAt - Date.now()) / (1000 * 60 * 60);
      const diffLongDays = (sessionLong.expiresAt - Date.now()) / (1000 * 60 * 60 * 24);

      expect(Math.round(diffShortHours)).toBe(24);
      expect(Math.round(diffLongDays)).toBe(90);
    });

    test('validateAndRotateRefreshToken rotates token and invalidates old token', async () => {
      const initialSession = await SessionService.createSession({
        userId: 'user-unit-rot',
        rememberMe: true,
        deviceInfo: 'Tablet 1',
      });

      const firstRefreshToken = initialSession.refreshToken;

      // Primera rotación
      const { session: rotatedSession, newRefreshToken } =
        await SessionService.validateAndRotateRefreshToken({
          refreshToken: firstRefreshToken,
          deviceInfo: 'Tablet 1 Updated',
        });

      expect(newRefreshToken).toBeDefined();
      expect(newRefreshToken).not.toBe(firstRefreshToken);
      expect(rotatedSession.device_info).toBe('Tablet 1 Updated');

      // Intentar reusar el token antiguo debe fallar
      await expect(
        SessionService.validateAndRotateRefreshToken({
          refreshToken: firstRefreshToken,
        })
      ).rejects.toThrow('INVALID_OR_REVOKED_REFRESH_TOKEN');

      // Usar el nuevo token debe funcionar
      const { newRefreshToken: secondNewToken } =
        await SessionService.validateAndRotateRefreshToken({
          refreshToken: newRefreshToken,
        });
      expect(secondNewToken).toBeDefined();
    });

    test('revokeSession revokes only the specific device session', async () => {
      const device1 = await SessionService.createSession({
        userId: 'user-multi-unit',
        deviceInfo: 'Device A',
      });
      const device2 = await SessionService.createSession({
        userId: 'user-multi-unit',
        deviceInfo: 'Device B',
      });

      // Revocar solo Device A
      const revoked = await SessionService.revokeSession(device1.refreshToken);
      expect(revoked).toBe(true);

      // Device A debe fallar
      await expect(
        SessionService.validateAndRotateRefreshToken({ refreshToken: device1.refreshToken })
      ).rejects.toThrow('INVALID_OR_REVOKED_REFRESH_TOKEN');

      // Device B debe seguir funcionando
      const rotationB = await SessionService.validateAndRotateRefreshToken({
        refreshToken: device2.refreshToken,
      });
      expect(rotationB.newRefreshToken).toBeDefined();
    });

    test('revokeAllUserSessions revokes all sessions for that user', async () => {
      const userMultiId = 'user-to-revoke-all';
      const dev1 = await SessionService.createSession({ userId: userMultiId });
      const dev2 = await SessionService.createSession({ userId: userMultiId });

      const count = await SessionService.revokeAllUserSessions(userMultiId);
      expect(count).toBeGreaterThanOrEqual(2);

      await expect(
        SessionService.validateAndRotateRefreshToken({ refreshToken: dev1.refreshToken })
      ).rejects.toThrow('INVALID_OR_REVOKED_REFRESH_TOKEN');

      await expect(
        SessionService.validateAndRotateRefreshToken({ refreshToken: dev2.refreshToken })
      ).rejects.toThrow('INVALID_OR_REVOKED_REFRESH_TOKEN');
    });
  });

  describe('Auth HTTP Endpoints Integration Tests', () => {
    test('POST /api/auth/refresh without refreshToken returns 400', async () => {
      const res = await fetch(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.message).toBe('MISSING_REFRESH_TOKEN');
    });

    test('POST /api/auth/refresh rotates active session and returns new accessToken', async () => {
      const userTestId = 'user-http-refresh-test';
      const session = await SessionService.createSession({
        userId: userTestId,
        rememberMe: true,
        deviceInfo: 'Office Scanner Test',
      });

      const refreshRes = await fetch(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refreshToken: session.refreshToken,
          deviceInfo: 'Office Scanner Test (Refreshed)',
        }),
      });

      expect(refreshRes.status).toBe(200);
      const refreshData = await refreshRes.json();
      expect(refreshData.ok).toBe(true);
      expect(refreshData.accessToken).toBeDefined();
      expect(refreshData.refreshToken).toBeDefined();
      expect(refreshData.refreshToken).not.toBe(session.refreshToken);

      // El access token retornado debe ser válido
      const decoded = jwt.decode(refreshData.accessToken);
      expect(decoded.uid).toBe(userTestId);

      // Reusar el refreshToken original debe retornar 401
      const reuseRes = await fetch(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refreshToken: session.refreshToken,
        }),
      });
      expect(reuseRes.status).toBe(401);
      const reuseData = await reuseRes.json();
      expect(reuseData.message).toBe('INVALID_OR_REVOKED_REFRESH_TOKEN');
    });

    test('POST /api/auth/logout revokes current device session', async () => {
      const userTestId = 'user-http-logout-test';
      const session = await SessionService.createSession({
        userId: userTestId,
        deviceInfo: 'Device to logout',
      });

      const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });

      expect(logoutRes.status).toBe(200);
      const logoutData = await logoutRes.json();
      expect(logoutData.ok).toBe(true);

      // Intentar refrescar tras logout debe fallar con 401
      const checkRes = await fetch(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
      expect(checkRes.status).toBe(401);
    });

    test('POST /api/auth/logout-all revokes all sessions of the authenticated user', async () => {
      const userTestId = 'user-shared-all-devices';
      const s1 = await SessionService.createSession({ userId: userTestId, deviceInfo: 'PC 1' });
      const s2 = await SessionService.createSession({ userId: userTestId, deviceInfo: 'PC 2' });

      const authHeader = `Bearer ${jwt.sign(
        { uid: userTestId, email: 'all@test.com', officeId: 'office-123' },
        process.env.JWT_SECRET,
        { expiresIn: '15m' }
      )}`;

      const logoutAllRes = await fetch(`${baseUrl}/api/auth/logout-all`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
      });

      expect(logoutAllRes.status).toBe(200);
      const logoutAllData = await logoutAllRes.json();
      expect(logoutAllData.ok).toBe(true);
      expect(logoutAllData.message).toBe('ALL_SESSIONS_REVOKED');

      // Ambas sesiones deben estar invalidadas
      const testDev1 = await fetch(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: s1.refreshToken }),
      });
      expect(testDev1.status).toBe(401);

      const testDev2 = await fetch(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: s2.refreshToken }),
      });
      expect(testDev2.status).toBe(401);
    });

    test('GET /api/guides rejects expired access token with TOKEN_EXPIRED (401)', async () => {
      const expiredToken = jwt.sign(
        { uid: 'user-expired', email: 'exp@test.com', officeId: 'office-exp' },
        process.env.JWT_SECRET,
        { expiresIn: -10 } // ya expirado
      );

      const res = await fetch(`${baseUrl}/api/guides`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${expiredToken}`,
        },
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.message).toBe('TOKEN_EXPIRED');
    });
  });
});
