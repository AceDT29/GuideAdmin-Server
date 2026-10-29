import { supabaseAdmin } from '../../lib/supabaseConfig.js';

// Almacenamiento en memoria (fallback en caso de que Supabase no esté disponible)
const guidesStore = [];

export class GuidesModel {
  /**
   * Helper para entregar al frontend las propiedades normalizadas en camelCase.
   * @param {Object} row 
   * @returns {Object}
   */
  static _formatToCamelCase(row) {
    if (!row) return row;
    return {
      id: row.id,
      code: row.code,
      owner: row.owner || '',
      serviceType: row.service_type ?? row.serviceType ?? '—',
      hasPayment: typeof row.has_payment === 'boolean'
        ? row.has_payment
        : (typeof row.hasPayment === 'boolean' ? row.hasPayment : null),
      delivered: Boolean(row.delivered),
      timestamp: row.timestamp,
      office_id: row.office_id,
      user_id: row.user_id,
    };
  }

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
        .select('id, code, owner, service_type, has_payment, delivered, timestamp, office_id, user_id')
        .eq('office_id', officeId);

      if (since) {
        query = query.gt('timestamp', since);
      }

      const { data, error } = await query.order('timestamp', { ascending: false });
      if (error) throw error;
      return (data || []).map((row) => this._formatToCamelCase(row));
    }

    console.log('[GuidesModel] Usando fallback en memoria para getByOffice');
    const filtered = guidesStore.filter((g) => {
      const matchOffice = !officeId || officeId === 'default' || g.office_id === officeId;
      const matchSince = !since || g.timestamp > since;
      return matchOffice && matchSince;
    });
    return filtered.map((row) => this._formatToCamelCase(row));
  }

  /**
   * Obtiene todas las guías.
   * @returns {Promise<Array>} Lista de guías.
   */
  static async getAll() {
    if (supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('guides')
        .select('id, code, owner, service_type, has_payment, delivered, timestamp, office_id, user_id')
        .order('timestamp', { ascending: false });

      if (error) throw error;
      return (data || []).map((row) => this._formatToCamelCase(row));
    }

    console.log('[GuidesModel] Usando fallback en memoria para getAll');
    return guidesStore.map((row) => this._formatToCamelCase(row));
  }

  /**
   * Guarda o actualiza (upsert) una guía con los nuevos metadatos.
   * @param {Object} guideData - Objeto guía.
   * @param {string} [officeId] - ID de la oficina asociada.
   * @param {string} [userId] - ID del usuario.
   * @returns {Promise<Object>} La guía guardada en formato camelCase.
   */
  static async save(guideData, officeId = 'default', userId = null) {
    const record = {
      id: guideData.id,
      code: guideData.code,
      owner: guideData.owner || null,
      service_type: guideData.serviceType || guideData.service_type || '—',
      has_payment: typeof guideData.hasPayment === 'boolean'
        ? guideData.hasPayment
        : (typeof guideData.has_payment === 'boolean' ? guideData.has_payment : null),
      delivered: Boolean(guideData.delivered),
      timestamp: guideData.timestamp || new Date().toISOString(),
      office_id: officeId || guideData.office_id || 'default',
      user_id: userId || guideData.user_id || null,
      updated_at: new Date().toISOString()
    };

    if (supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('guides')
        .upsert(record)
        .select('id, code, owner, service_type, has_payment, delivered, timestamp, office_id, user_id')
        .single();

      if (error) throw error;
      return this._formatToCamelCase(data);
    }

    console.log('[GuidesModel] Usando fallback en memoria para save');
    const index = guidesStore.findIndex((g) => g.id === record.id);
    if (index !== -1) {
      guidesStore[index] = { ...guidesStore[index], ...record };
    } else {
      guidesStore.push(record);
    }
    return this._formatToCamelCase(record);
  }

  /**
   * Actualización parcial rápida (para marcar entregado, cambiar dueño, etc.).
   * @param {string} id - ID de la guía.
   * @param {Object} updates - Propiedades a actualizar.
   * @param {string} [officeId] - ID de la oficina para asegurar aislamiento multi-inquilino.
   * @returns {Promise<Object|null>} Guía actualizada en formato camelCase.
   */
  static async update(id, updates = {}, officeId = null) {
    const allowed = {};
    if ('owner' in updates) allowed.owner = updates.owner;
    if ('serviceType' in updates) allowed.service_type = updates.serviceType;
    if ('service_type' in updates) allowed.service_type = updates.service_type;
    if ('hasPayment' in updates) allowed.has_payment = updates.hasPayment;
    if ('has_payment' in updates) allowed.has_payment = updates.has_payment;
    if ('delivered' in updates) allowed.delivered = Boolean(updates.delivered);
    if ('code' in updates) allowed.code = updates.code;
    allowed.updated_at = new Date().toISOString();

    if (supabaseAdmin) {
      let queryById = supabaseAdmin
        .from('guides')
        .update(allowed)
        .eq('id', id);

      if (officeId && officeId !== 'all' && officeId !== 'default') {
        queryById = queryById.eq('office_id', officeId);
      }

      let { data, error } = await queryById
        .select('id, code, owner, service_type, has_payment, delivered, timestamp, office_id, user_id')
        .maybeSingle();

      if (error) throw error;

      // Si no se encontró por ID, intentar buscar por código (trackingNumber)
      if (!data) {
        let queryByCode = supabaseAdmin
          .from('guides')
          .update(allowed)
          .eq('code', id);

        if (officeId && officeId !== 'all' && officeId !== 'default') {
          queryByCode = queryByCode.eq('office_id', officeId);
        }

        const { data: dataByCode, error: errCode } = await queryByCode
          .select('id, code, owner, service_type, has_payment, delivered, timestamp, office_id, user_id')
          .maybeSingle();

        if (errCode) throw errCode;
        data = dataByCode;
      }

      return data ? this._formatToCamelCase(data) : null;
    }

    console.log('[GuidesModel] Usando fallback en memoria para update');
    const item = guidesStore.find((g) => {
      const matchId = g.id === id || g.code === id;
      const matchOffice = !officeId || officeId === 'all' || officeId === 'default' || g.office_id === officeId;
      return matchId && matchOffice;
    });

    if (item) {
      Object.assign(item, allowed);
      return this._formatToCamelCase(item);
    }
    return null;
  }

  /**
   * Marca una guía como entregada.
   * @param {string} trackingNumberOrId - ID o código de seguimiento.
   * @returns {Promise<Object|null>}
   */
  static async markDelivered(trackingNumberOrId) {
    return this.update(trackingNumberOrId, { delivered: true });
  }

  /**
   * Elimina una guía individual por su ID o código de seguimiento.
   * @param {string} id - ID o código de la guía.
   * @param {string} [officeId] - ID de la oficina.
   * @returns {Promise<boolean>} True si fue eliminada, false en caso contrario.
   */
  static async delete(id, officeId = null) {
    if (!id) return false;

    if (supabaseAdmin) {
      let query = supabaseAdmin
        .from('guides')
        .delete({ count: 'exact' });

      if (officeId && officeId !== 'all' && officeId !== 'default') {
        query = query.eq('office_id', officeId);
      }

      const { data, error, count } = await query
        .or(`id.eq.${id},code.eq.${id}`)
        .select('id');

      if (error) {
        console.error(`[GuidesModel] Error al eliminar guía ${id} en Supabase:`, error);
        throw error;
      }

      return (count || (data ? data.length : 0)) > 0;
    }

    console.log(`[GuidesModel] Eliminando guía ${id} del fallback en memoria`);
    const index = guidesStore.findIndex((g) => {
      const matchId = g.id === id || g.code === id;
      const matchOffice = !officeId || officeId === 'all' || officeId === 'default' || g.office_id === officeId;
      return matchId && matchOffice;
    });

    if (index !== -1) {
      guidesStore.splice(index, 1);
      return true;
    }

    return false;
  }


  /**
   * Reinicia la gestión de guías para una oficina específica (o purga total si officeId es 'all' o no se especifica).
   * @param {string} [officeId] - ID de la oficina.
   * @returns {Promise<{ deletedCount: number, officeId: string }>}
   */
  static async clearByOffice(officeId = 'default') {
    if (!officeId || officeId === 'all') {
      const purgeResult = await this.purgeAll();
      return { deletedCount: purgeResult.deletedCount, officeId: 'all' };
    }

    if (supabaseAdmin) {
      const { error, count } = await supabaseAdmin
        .from('guides')
        .delete({ count: 'exact' })
        .eq('office_id', officeId);

      if (error) {
        console.error(`[GuidesModel] Error al purgar guías de oficina ${officeId} en Supabase:`, error);
        throw error;
      }
      return { deletedCount: count || 0, officeId };
    }

    console.log(`[GuidesModel] Limpiando guías de la oficina ${officeId} del fallback en memoria`);
    const initialCount = guidesStore.length;
    for (let i = guidesStore.length - 1; i >= 0; i--) {
      if (guidesStore[i].office_id === officeId) {
        guidesStore.splice(i, 1);
      }
    }
    const deletedCount = initialCount - guidesStore.length;
    return { deletedCount, officeId };
  }

  /**
   * Elimina todos los registros de guías (purga total).
   * @returns {Promise<{ deletedCount: number }>}
   */
  static async purgeAll() {
    if (supabaseAdmin) {
      // Supabase / PostgREST requiere una condición de filtro para DELETE masivo
      const { error, count } = await supabaseAdmin
        .from('guides')
        .delete({ count: 'exact' })
        .not('id', 'is', null);

      if (error) {
        console.error('[GuidesModel] Error al purgar la tabla de guías en Supabase:', error);
        throw error;
      }
      return { deletedCount: count || 0 };
    }

    console.log('[GuidesModel] Purgando guías del fallback en memoria');
    const deletedCount = guidesStore.length;
    guidesStore.length = 0;
    return { deletedCount };
  }

  /**
   * Elimina guías con más de X horas de antigüedad.
   * @param {number} hours Horas de antigüedad.
   * @returns {Promise<{ deletedCount: number }>}
   */
  static async deleteOlderThan(hours = 16) {
    const cutoffDate = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    if (supabaseAdmin) {
      const { error, count } = await supabaseAdmin
        .from('guides')
        .delete({ count: 'exact' })
        .lt('timestamp', cutoffDate);

      if (error) {
        console.error('[GuidesModel] Error al eliminar guías antiguas en Supabase:', error);
        throw error;
      }
      return { deletedCount: count || 0 };
    }

    console.log('[GuidesModel] Limpiando guías antiguas del fallback en memoria');
    const initialCount = guidesStore.length;
    for (let i = guidesStore.length - 1; i >= 0; i--) {
      if (guidesStore[i].timestamp < cutoffDate) {
        guidesStore.splice(i, 1);
      }
    }
    const deletedCount = initialCount - guidesStore.length;
    return { deletedCount };
  }
}

