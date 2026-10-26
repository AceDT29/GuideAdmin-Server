import { GuidesModel } from './guides.model.js';

/**
 * Obtiene guías por oficina (lógica de negocio pura, sin dependencia de Express).
 * @param {string} officeId - ID de la oficina.
 * @param {string|null} [since] - Timestamp offset para recuperar eventos posteriores.
 * @returns {Promise<Array>} Lista de guías.
 */
export async function fetchGuidesByOffice(officeId, since = null) {
  if (!officeId || officeId === 'default') {
    return GuidesModel.getAll();
  }
  return GuidesModel.getByOffice(officeId, since);
}

/**
 * Marca una guía como entregada o pendiente (soporta ID o número de seguimiento).
 * @param {string} trackingNumberOrId - ID o número de seguimiento.
 * @param {boolean} [delivered=true] - Estado de entrega del paquete.
 * @returns {Promise<Object|null>} Guía actualizada.
 */
export async function markGuideAsDelivered(trackingNumberOrId, delivered = true) {
  if (!trackingNumberOrId) {
    throw new Error('ID de guía requerido');
  }
  return GuidesModel.update(trackingNumberOrId, { delivered: Boolean(delivered) });
}

/**
 * Marca una guía como entregada (alias / compatibilidad).
 * @param {string} trackingNumber - Número de seguimiento o ID.
 * @returns {Promise<Object|null>}
 */
export async function deliverGuide(trackingNumber) {
  try {
    return await markGuideAsDelivered(trackingNumber, true);
  } catch (error) {
    console.error('Error en el servicio al entregar guía:', error);
    throw error;
  }
}

/**
 * Actualiza parcialmente los datos de una guía (entregado, dueño, cobro, etc.).
 * @param {string} id - ID o código de la guía.
 * @param {Object} updates - Datos a actualizar.
 * @returns {Promise<Object|null>} Guía actualizada.
 */
export async function updateGuide(id, updates = {}) {
  if (!id) {
    throw new Error('ID de guía requerido');
  }
  return GuidesModel.update(id, updates);
}

/**
 * Reinicia la gestión de guías para una oficina determinada.
 * @param {string} officeId - ID de la oficina.
 * @returns {Promise<{ deletedCount: number, officeId: string }>}
 */
export async function resetGuidesByOffice(officeId) {
  return GuidesModel.clearByOffice(officeId);
}
