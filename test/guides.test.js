import { jest } from '@jest/globals';

// Mockear la configuración de Supabase para asegurar que los tests 
// usen siempre el fallback de memoria y no dependan de credenciales reales.
jest.unstable_mockModule('../src/lib/supabaseConfig.js', () => ({
  supabaseAdmin: null
}));

// Importar el modelo y servicio después de realizar el mock
const { GuidesModel } = await import('../src/modules/guides/guides.model.js');
const { 
  fetchGuidesByOffice, 
  resetGuidesByOffice, 
  markGuideAsDelivered, 
  updateGuide 
} = await import('../src/modules/guides/guides.service.js');
const { createApp } = await import('../index.js');
import jwt from 'jsonwebtoken';


describe('GuidesModel (Memory Fallback)', () => {
  test('debe guardar y obtener guías usando el fallback en memoria con id, code y timestamp', async () => {
    const timestamp = new Date().toISOString();
    const guide = {
      id: 'test-guide-1',
      code: 'GUIDE1',
      timestamp
    };

    // Guardar guía
    const saved = await GuidesModel.save(guide, 'oficina-1');
    expect(saved.id).toBe(guide.id);
    expect(saved.code).toBe(guide.code);
    expect(saved.office_id).toBe('oficina-1');

    // Obtener por oficina y verificar presencia
    const officeGuides = await GuidesModel.getByOffice('oficina-1');
    expect(officeGuides).toContainEqual(saved);
  });

  test('debe actualizar una guía existente si coincide el id (Upsert)', async () => {
    const originalGuide = {
      id: 'test-upsert',
      code: 'UP1',
      timestamp: '2026-07-28T10:00:00.000Z'
    };
    await GuidesModel.save(originalGuide, 'oficina-2');

    const updatedGuide = {
      id: 'test-upsert',
      code: 'UP1-UPDATED',
      timestamp: '2026-07-28T11:00:00.000Z'
    };
    await GuidesModel.save(updatedGuide, 'oficina-2');

    const all = await GuidesModel.getByOffice('oficina-2');
    const found = all.find(g => g.id === 'test-upsert');

    expect(found).toBeDefined();
    expect(found.code).toBe('UP1-UPDATED');
  });

  test('debe purgar todas las guías con purgeAll', async () => {
    await GuidesModel.save({ id: 'purge-1', code: 'P1' }, 'oficina-1');
    await GuidesModel.save({ id: 'purge-2', code: 'P2' }, 'oficina-2');

    const result = await GuidesModel.purgeAll();
    expect(result.deletedCount).toBeGreaterThanOrEqual(2);

    const all = await GuidesModel.getAll();
    expect(all).toHaveLength(0);
  });

  test('debe eliminar guías con más de X horas de antigüedad con deleteOlderThan', async () => {
    const oldTimestamp = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString(); // 20 horas atrás
    const recentTimestamp = new Date().toISOString();

    await GuidesModel.save({ id: 'old-guide', code: 'OLD', timestamp: oldTimestamp }, 'oficina-1');
    await GuidesModel.save({ id: 'recent-guide', code: 'REC', timestamp: recentTimestamp }, 'oficina-1');

    const result = await GuidesModel.deleteOlderThan(16);
    expect(result.deletedCount).toBe(1);

    const remaining = await GuidesModel.getAll();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('recent-guide');
  });

  describe('Nuevos atributos (owner, serviceType, hasPayment, delivered)', () => {
    test('debe persistir una guía completa con dueño, tipo de servicio y cobro', async () => {
      const guideData = {
        id: 'test-zoom-1',
        code: '1716631761',
        owner: 'ABISAID CERMENO',
        serviceType: 'BCD',
        hasPayment: true,
        delivered: false,
        timestamp: new Date().toISOString()
      };

      const saved = await GuidesModel.save(guideData, 'oficina-test');
      expect(saved.owner).toBe('ABISAID CERMENO');
      expect(saved.serviceType).toBe('BCD');
      expect(saved.hasPayment).toBe(true);
      expect(saved.delivered).toBe(false);
    });

    test('debe actualizar únicamente el estado de entrega (delivered: true)', async () => {
      await GuidesModel.save({
        id: 'test-deliv-1',
        code: '1716476886',
        owner: 'JUAN PEREZ',
        delivered: false
      }, 'oficina-test');

      const updated = await GuidesModel.update('test-deliv-1', { delivered: true });
      expect(updated.delivered).toBe(true);
      expect(updated.code).toBe('1716476886');
      expect(updated.owner).toBe('JUAN PEREZ');
    });

    test('debe recuperar guías por oficina incluyendo sus nuevos atributos en camelCase', async () => {
      const guides = await GuidesModel.getByOffice('oficina-test');
      const target = guides.find(g => g.id === 'test-zoom-1');

      expect(target).toBeDefined();
      expect(target.owner).toBe('ABISAID CERMENO');
      expect(target.serviceType).toBe('BCD');
      expect(target.hasPayment).toBe(true);
      expect(target.delivered).toBe(false);
    });
  });

  describe('Módulo de reinicio de gestión de guías (clearByOffice)', () => {
    test('debe reiniciar la gestión de guías para una oficina específica sin tocar otras', async () => {
      await GuidesModel.save({ id: 'office-a-1', code: 'A1' }, 'oficina-A');
      await GuidesModel.save({ id: 'office-a-2', code: 'A2' }, 'oficina-A');
      await GuidesModel.save({ id: 'office-b-1', code: 'B1' }, 'oficina-B');

      const result = await GuidesModel.clearByOffice('oficina-A');
      expect(result.deletedCount).toBe(2);
      expect(result.officeId).toBe('oficina-A');

      const officeAGuides = await GuidesModel.getByOffice('oficina-A');
      expect(officeAGuides).toHaveLength(0);

      const officeBGuides = await GuidesModel.getByOffice('oficina-B');
      expect(officeBGuides.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('guides.service (Lógica de Negocio)', () => {
    test('markGuideAsDelivered debe marcar el paquete como entregado (delivered: true)', async () => {
      await GuidesModel.save({
        id: 'service-pkg-1',
        code: 'PKG-001',
        owner: 'MARIA LOPEZ',
        delivered: false
      }, 'oficina-service');

      const result = await markGuideAsDelivered('service-pkg-1', true);
      expect(result).toBeDefined();
      expect(result.id).toBe('service-pkg-1');
      expect(result.delivered).toBe(true);
      expect(result.owner).toBe('MARIA LOPEZ');
    });

    test('markGuideAsDelivered debe permitir desmarcar como no entregado (delivered: false)', async () => {
      const result = await markGuideAsDelivered('service-pkg-1', false);
      expect(result.delivered).toBe(false);
    });

    test('markGuideAsDelivered debe lanzar un error si no se pasa el id', async () => {
      await expect(markGuideAsDelivered(null)).rejects.toThrow('ID de guía requerido');
    });

    test('updateGuide debe actualizar múltiples campos de la guía', async () => {
      const result = await updateGuide('service-pkg-1', {
        owner: 'MARIA LOPEZ DE PEREZ',
        delivered: true
      });
      expect(result.owner).toBe('MARIA LOPEZ DE PEREZ');
      expect(result.delivered).toBe(true);
    });

    test('resetGuidesByOffice debe reiniciar las guías de la oficina especificada', async () => {
      await GuidesModel.save({ id: 'pkg-reset-1', code: 'R1' }, 'oficina-to-reset');
      const resetResult = await resetGuidesByOffice('oficina-to-reset');
      expect(resetResult.deletedCount).toBeGreaterThanOrEqual(1);

      const guides = await fetchGuidesByOffice('oficina-to-reset');
      expect(guides).toHaveLength(0);
    });
  });

  describe('Guides HTTP Controller Integration (PATCH /api/guides/:id)', () => {
    let server;
    let baseUrl;
    let token;

    beforeAll(async () => {
      const secret = process.env.JWT_SECRET || 'test-secret';
      process.env.JWT_SECRET = secret;
      token = jwt.sign(
        { uid: 'test-user-http', officeId: 'oficina-http-test' },
        secret,
        { expiresIn: '1h' }
      );

      const setup = createApp();
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

    test('PATCH /api/guides/:id debe marcar paquete como entregado vía HTTP', async () => {
      await GuidesModel.save({
        id: 'http-guide-1',
        code: 'HTTP-01',
        owner: 'ANA TORRES',
        delivered: false
      }, 'oficina-http-test');

      const response = await fetch(`${baseUrl}/api/guides/http-guide-1`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ delivered: true })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.id).toBe('http-guide-1');
      expect(data.delivered).toBe(true);
      expect(data.owner).toBe('ANA TORRES');
    });

    test('DELETE /api/guides/:id debe eliminar una guía existente vía HTTP', async () => {
      await GuidesModel.save({
        id: 'http-guide-delete',
        code: 'DEL-01',
        owner: 'MARCOS PEÑA'
      }, 'oficina-http-test');

      const response = await fetch(`${baseUrl}/api/guides/http-guide-delete`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.id).toBe('http-guide-delete');

      // Verificar que ya no exista
      const officeGuides = await GuidesModel.getByOffice('oficina-http-test');
      expect(officeGuides.some(g => g.id === 'http-guide-delete')).toBe(false);
    });

    test('DELETE /api/guides/:id debe devolver 404 si la guía no existe', async () => {
      const response = await fetch(`${baseUrl}/api/guides/inexistente-del-999`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.status).toBe('error');
    });

    test('no debe permitir modificar ni eliminar guías de otra oficina (Aislamiento IDOR)', async () => {
      // Guardar guía perteneciente a OTRA oficina distinta a la del token ('oficina-http-test')
      await GuidesModel.save({
        id: 'guide-oficina-ajena',
        code: 'AJENA-01',
        owner: 'CLIENTE AJENO',
        delivered: false
      }, 'oficina-completamente-distinta');

      // Intentar modificar con el token de 'oficina-http-test'
      const patchRes = await fetch(`${baseUrl}/api/guides/guide-oficina-ajena`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ delivered: true })
      });
      expect(patchRes.status).toBe(404);

      // Intentar eliminar con el token de 'oficina-http-test'
      const deleteRes = await fetch(`${baseUrl}/api/guides/guide-oficina-ajena`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      expect(deleteRes.status).toBe(404);

      // Verificar que la guía ajena sigue intacta en su oficina
      const foreignGuides = await GuidesModel.getByOffice('oficina-completamente-distinta');
      expect(foreignGuides.some(g => g.id === 'guide-oficina-ajena')).toBe(true);
    });
  });
});


