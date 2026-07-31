import { supabaseAdmin } from '../../lib/supabaseConfig.js';

// Almacenamiento en memoria (fallback en caso de que Supabase no esté disponible)
const guidesStore = [];

export class GuidesModel {
  /**
   * Obtiene guías filtradas por oficina y opcionalmente desde una fecha/timestamp específica (offset).
   * @param {string} officeId - ID de la oficina.
   * @param {string} [since] - Timestamp offset para recuperar eventos posteriores.
   * @returns {Promise<Array>} Lista de guías.
   */
  static async getByOffice(officeId = 'default', since = null) {
    if (supabaseAdmin) {
      let query = supabaseAdmin
        .from('guides')
        .select('id, code, timestamp, office_id, user_id')
        .eq('office_id', officeId);

      if (since) {
        query = query.gt('timestamp', since);
      }

      const { data, error } = await query.order('timestamp', { ascending: false });
      if (error) throw error;
      return data || [];
    }

    console.log('[GuidesModel] Usando fallback en memoria para getByOffice');
    return guidesStore.filter((g) => {
      const matchOffice = !officeId || officeId === 'default' || g.office_id === officeId;
      const matchSince = !since || g.timestamp > since;
      return matchOffice && matchSince;
    });
  }

  /**
   * Obtiene todas las guías.
   * @returns {Promise<Array>} Lista de guías.
   */
  static async getAll() {
    if (supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('guides')
        .select('id, code, timestamp, office_id, user_id')
        .order('timestamp', { ascending: false });

      if (error) throw error;
      return data || [];
    }

    console.log('[GuidesModel] Usando fallback en memoria para getAll');
    return guidesStore;
  }

  /**
   * Guarda o actualiza (upsert) una guía conservando la nomenclatura del frontend (id, code, timestamp).
   * @param {Object} guideData - Objeto guía con id, code, timestamp.
   * @param {string} [officeId] - ID de la oficina asociada.
   * @param {string} [userId] - ID del usuario.
   * @returns {Promise<Object>} La guía guardada.
   */
  static async save(guideData, officeId = 'default', userId = null) {
    const record = {
      id: guideData.id,
      code: guideData.code,
      timestamp: guideData.timestamp || new Date().toISOString(),
      office_id: officeId || guideData.office_id || 'default',
      user_id: userId || guideData.user_id || null,
      updated_at: new Date().toISOString()
    };

    if (supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('guides')
        .upsert(record)
        .select('id, code, timestamp, office_id, user_id')
        .single();

      if (error) throw error;
      return data;
    }

    console.log('[GuidesModel] Usando fallback en memoria para save');
    const index = guidesStore.findIndex((g) => g.id === record.id);
    if (index !== -1) {
      guidesStore[index] = record;
    } else {
      guidesStore.push(record);
    }
    return record;
  }
}

