import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key-1234567890';

// Mockear Supabase para tests en memoria
jest.unstable_mockModule('../src/lib/supabaseConfig.js', () => ({
  supabaseAdmin: null,
}));

const { createApp } = await import('../index.js');
const { SUPERADMIN_EMAIL, getUserRole, isUserAdmin } = await import('../src/lib/roles.js');

describe('Admin Panel API & Role Management Tests', () => {
  let app;
  let server;
  let baseUrl;

  // Tokens para pruebas
  const superAdminToken = jwt.sign(
    { uid: 'superadmin-root-id', email: SUPERADMIN_EMAIL, displayName: 'José Ángel' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  const adminToken = jwt.sign(
    { uid: 'admin-secondary-id', email: 'secondadmin@zoom.com', displayName: 'Admin 2', role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  const operatorToken = jwt.sign(
    { uid: 'operator-user-id', email: 'operator@zoom.com', displayName: 'Operador 1', role: 'operator', status: 'trial' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  const pendingOfficeToken = jwt.sign(
    { uid: 'pending-user-id', officeId: 'pending-office', email: 'pending@zoom.com', displayName: 'Oficina Pendiente', role: 'operator', status: 'pending_approval' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

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

  describe('Role Utilities (Unit)', () => {
    test('Identifies joseangelgarces123@gmail.com permanently as superadmin', () => {
      expect(getUserRole({ email: 'joseangelgarces123@gmail.com' })).toBe('superadmin');
      expect(getUserRole({ email: '  JOSEANGELGARCES123@GMAIL.COM  ' })).toBe('superadmin');
      expect(isUserAdmin({ email: 'joseangelgarces123@gmail.com' })).toBe(true);
    });

    test('Identifies admin role correctly', () => {
      expect(getUserRole({ email: 'other@zoom.com', user_metadata: { role: 'admin' } })).toBe('admin');
      expect(isUserAdmin({ email: 'other@zoom.com', user_metadata: { role: 'admin' } })).toBe(true);
    });

    test('Identifies operator role correctly', () => {
      expect(getUserRole({ email: 'operator@zoom.com' })).toBe('operator');
      expect(isUserAdmin({ email: 'operator@zoom.com' })).toBe(false);
    });
  });

  describe('Access Control Security (Middleware)', () => {
    test('Rejects unauthenticated request with 401', async () => {
      const res = await fetch(`${baseUrl}/api/admin/metrics`);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.ok).toBe(false);
    });

    test('Rejects operator user request with 403 Forbidden', async () => {
      const res = await fetch(`${baseUrl}/api/admin/metrics`, {
        headers: { Authorization: `Bearer ${operatorToken}` },
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.message).toBe('FORBIDDEN_ADMIN_ACCESS_REQUIRED');
    });

    test('Permits Super Admin user to access metrics', async () => {
      const res = await fetch(`${baseUrl}/api/admin/metrics`, {
        headers: { Authorization: `Bearer ${superAdminToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.metrics).toHaveProperty('totalOffices');
      expect(data.metrics).toHaveProperty('activeAdmins');
      expect(data.metrics).toHaveProperty('pendingApprovals');
    });

    test('Blocks pending_approval office from accessing guides API with 403', async () => {
      const res = await fetch(`${baseUrl}/api/guides`, {
        headers: { Authorization: `Bearer ${pendingOfficeToken}` },
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.code).toBe('ACCOUNT_PENDING_APPROVAL');
    });
  });

  describe('Admin Operations (Offices, Roles & Subscriptions)', () => {
    test('GET /api/admin/offices lists offices with computed trial days and role', async () => {
      const res = await fetch(`${baseUrl}/api/admin/offices`, {
        headers: { Authorization: `Bearer ${superAdminToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.offices)).toBe(true);
      expect(data.offices.length).toBeGreaterThan(0);

      const superAdminEntry = data.offices.find((o) => o.isSuperAdmin);
      expect(superAdminEntry).toBeDefined();
      expect(superAdminEntry.email).toBe(SUPERADMIN_EMAIL);
      expect(superAdminEntry.role).toBe('superadmin');
      expect(superAdminEntry.location).toBe('Sede Principal (Falcón, VE)');
    });

    test('Guards Super Admin against role modification', async () => {
      const res = await fetch(`${baseUrl}/api/admin/offices/superadmin-root-id/role`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${superAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: 'operator' }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.message).toBe('CANNOT_MODIFY_SUPERADMIN');
    });

    test('Guards Super Admin against deletion', async () => {
      const res = await fetch(`${baseUrl}/api/admin/offices/superadmin-root-id`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${superAdminToken}`,
        },
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.message).toBe('CANNOT_DELETE_SUPERADMIN');
    });

    test('Allows extending trial days via status endpoint', async () => {
      const res = await fetch(`${baseUrl}/api/admin/offices/superadmin-root-id/status`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${superAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ extendDays: 10 }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.office.trialDaysExtended).toBeGreaterThan(0);
    });
  });
});

