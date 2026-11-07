import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key-1234567890';

// Mock de Supabase para ejecutar en memoria
jest.unstable_mockModule('../src/lib/supabaseConfig.js', () => ({
  supabaseAdmin: null,
}));

const { createApp } = await import('../index.js');
const { _getRecoveryCode, _clearRecoveryCodes } = await import('../src/modules/auth/auth.controller.js');

describe('Password Reset Endpoints Tests', () => {
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

  describe('POST /api/auth/forgot-password', () => {
    test('rechaza solicitud sin email con 400', async () => {
      const res = await fetch(`${baseUrl}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: '' }),
      });
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.message).toBe('MISSING_EMAIL');
    });

    test('acepta solicitud con email válido y responde mensaje seguro', async () => {
      const res = await fetch(`${baseUrl}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'oficina@test.com' }),
      });
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.message).toContain('código de verificación');
      expect(_getRecoveryCode('oficina@test.com')).toHaveLength(6);
    });

    test('rechaza con 429 si se solicita otro correo inmediatamente para el mismo email (cooldown activo)', async () => {
      // Primera solicitud
      await fetch(`${baseUrl}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'cooldown.user@test.com' }),
      });

      // Segunda solicitud inmediata para el mismo email
      const res = await fetch(`${baseUrl}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'cooldown.user@test.com' }),
      });

      const data = await res.json();
      expect(res.status).toBe(429);
      expect(data.ok).toBe(false);
      expect(data.code).toBe('COOLDOWN_ACTIVE');
      expect(data.retryAfter).toBeGreaterThan(0);
      expect(data.message).toContain('segundo');
    });

    test('permite solicitar para otro correo distinto sin verse afectado por el cooldown previo', async () => {
      const res = await fetch(`${baseUrl}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'otro.usuario@test.com' }),
      });
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
    });
  });

  describe('GET /api/auth/verify-reset-token', () => {
    test('rechaza solicitud sin token con 400', async () => {
      const res = await fetch(`${baseUrl}/api/auth/verify-reset-token`);
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.message).toBe('MISSING_TOKEN');
    });

    test('rechaza token corrupto o inválido con 400', async () => {
      const res = await fetch(`${baseUrl}/api/auth/verify-reset-token?token=token-invalido-xyz`);
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.message).toBe('INVALID_TOKEN');
    });

    test('valida exitosamente token firmado legítimo', async () => {
      const validToken = jwt.sign(
        { uid: 'user-reset-test', email: 'oficina@test.com', purpose: 'pwd_reset' },
        process.env.JWT_SECRET,
        { expiresIn: '15m' }
      );

      const res = await fetch(`${baseUrl}/api/auth/verify-reset-token?token=${encodeURIComponent(validToken)}`);
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.email).toBe('oficina@test.com');
    });
  });

  describe('POST /api/auth/verify-reset-code', () => {
    test('rechaza si falta email o código con 400', async () => {
      const res = await fetch(`${baseUrl}/api/auth/verify-reset-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'oficina@test.com' }),
      });
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.message).toBe('MISSING_EMAIL_OR_CODE');
    });

    test('rechaza código incorrecto con 400', async () => {
      // Generar código
      await fetch(`${baseUrl}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-skip-cooldown': 'true' },
        body: JSON.stringify({ email: 'oficina@test.com' }),
      });

      const res = await fetch(`${baseUrl}/api/auth/verify-reset-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'oficina@test.com', code: '000000' }),
      });
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.message).toContain('incorrecto');
    });

    test('verifica exitosamente código legítimo y emite verificationToken', async () => {
      // Solicitar código
      await fetch(`${baseUrl}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-skip-cooldown': 'true' },
        body: JSON.stringify({ email: 'oficina@test.com' }),
      });

      const code = _getRecoveryCode('oficina@test.com');
      expect(code).toBeTruthy();

      const res = await fetch(`${baseUrl}/api/auth/verify-reset-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'oficina@test.com', code }),
      });
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.verificationToken).toBeTruthy();
    });
  });

  describe('POST /api/auth/reset-password', () => {
    test('rechaza si la nueva contraseña tiene menos de 6 caracteres', async () => {
      const validToken = jwt.sign(
        { uid: 'user-reset-test', email: 'oficina@test.com', purpose: 'pwd_reset' },
        process.env.JWT_SECRET,
        { expiresIn: '15m' }
      );

      const res = await fetch(`${baseUrl}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: validToken, newPassword: '123' }),
      });
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.message).toBe('PASSWORD_TOO_SHORT');
    });

    test('actualiza contraseña exitosamente con token válido', async () => {
      const validToken = jwt.sign(
        { uid: 'user-reset-test', email: 'oficina@test.com', purpose: 'pwd_reset' },
        process.env.JWT_SECRET,
        { expiresIn: '15m' }
      );

      const res = await fetch(`${baseUrl}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: validToken, newPassword: 'nuevaContraseñaSegura123' }),
      });
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.message).toContain('restablecida con éxito');
    });

    test('actualiza contraseña exitosamente con código OTP directo', async () => {
      // Solicitar código
      await fetch(`${baseUrl}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-skip-cooldown': 'true' },
        body: JSON.stringify({ email: 'oficina@test.com' }),
      });

      const code = _getRecoveryCode('oficina@test.com');
      expect(code).toBeTruthy();

      const res = await fetch(`${baseUrl}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'oficina@test.com',
          code,
          newPassword: 'miNuevaClaveSegura2026',
        }),
      });
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.message).toContain('restablecida con éxito');

      // Verificar que el código se haya consumido
      expect(_getRecoveryCode('oficina@test.com')).toBeNull();
    });
  });
});

