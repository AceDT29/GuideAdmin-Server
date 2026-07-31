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
});

