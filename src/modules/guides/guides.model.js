import { db } from '../../lib/firebaseConfig.js';

// Almacenamiento en memoria (fallback en caso de que Firebase no esté disponible)
const guidesStore = [];

export class GuidesModel {
  /**
   * Obtiene todas las guías.
   * @returns {Promise<Array>} Lista de guías.
   */
  static async getAll() {
    if (db) {
      const snapshot = await db.ref('guides').once('value');
      const val = snapshot.val();
      return val ? Object.values(val) : [];
    }
    
    console.log('[GuidesModel] Usando fallback en memoria para getAll');
    return guidesStore;
  }

  /**
   * Guarda o actualiza (upsert) una guía.
   * @param {Object} guide - Objeto de la guía a guardar.
   * @returns {Promise<Object>} La guía guardada.
   */
  static async save(guide) {
    if (db) {
      await db.ref(`guides/${guide.id}`).set(guide);
      return guide;
    }

    console.log('[GuidesModel] Usando fallback en memoria para save');
    const index = guidesStore.findIndex((g) => g.id === guide.id);
    if (index !== -1) {
      guidesStore[index] = guide;
    } else {
      guidesStore.push(guide);
    }
    return guide;
  }
}
