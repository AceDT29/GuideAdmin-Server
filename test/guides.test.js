import { jest } from '@jest/globals';

// Mockear la configuración de Supabase para asegurar que los tests 
// usen siempre el fallback de memoria y no dependan de credenciales reales.
jest.unstable_mockModule('../src/lib/supabaseConfig.js', () => ({
  supabaseAdmin: null
}));

// Importar el modelo después de realizar el mock
const { GuidesModel } = await import('../src/modules/guides/guides.model.js');

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
});

