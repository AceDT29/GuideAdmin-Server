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
