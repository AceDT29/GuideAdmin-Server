import { jest } from '@jest/globals';

// Mockear la configuración de Firebase para asegurar que los tests 
// usen siempre el fallback de memoria y no dependan de credenciales reales.
jest.unstable_mockModule('../../lib/firebaseConfig.js', () => ({
  db: null,
  firebaseInitialized: false,
  firebaseApp: null,
  adminAuth: null
}));

// Importar el modelo después de realizar el mock
const { GuidesModel } = await import('./guides.model.js');

describe('GuidesModel (Memory Fallback)', () => {
  test('debe guardar y obtener guías usando el fallback en memoria', async () => {
    const guide = { 
      id: 'test-guide-1', 
      code: 'GUIDE1', 
      title: 'Guía de Pruebas Jest' 
    };

    // Guardar guía
    const saved = await GuidesModel.save(guide);
    expect(saved).toEqual(guide);

    // Obtener todas y verificar presencia
    const all = await GuidesModel.getAll();
    expect(all).toContainEqual(guide);
  });

  test('debe actualizar una guía existente si coincide el id (Upsert)', async () => {
    const originalGuide = { 
      id: 'test-upsert', 
      code: 'UP1', 
      title: 'Título Original' 
    };
    await GuidesModel.save(originalGuide);

    const updatedGuide = { 
      id: 'test-upsert', 
      code: 'UP1', 
      title: 'Título Actualizado' 
    };
    await GuidesModel.save(updatedGuide);

    const all = await GuidesModel.getAll();
    const found = all.find(g => g.id === 'test-upsert');
    
    expect(found).toBeDefined();
    expect(found.title).toBe('Título Actualizado');
  });
});
