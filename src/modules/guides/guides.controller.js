import { GuidesModel } from './guides.model.js';
import { fetchGuidesByOffice } from './guides.service.js';

/**
 * Obtiene las guías almacenadas, opcionalmente filtradas por oficina y offset (since).
 * GET /api/guides
 */
export async function getGuides(req, res, next) {
  try {
    const officeId = req.query.office_id || req.user?.office_id || req.user?.id || 'default';
    const since = req.query.since || null;
    
    const guides = await fetchGuidesByOffice(officeId, since);

    res.json({ guides });
  } catch (error) {
    next(error);
  }
}

/**
 * Guarda o actualiza una guía.
 * POST /api/guides
 */
export async function createOrUpdateGuide(req, res, next) {
  try {
    const guide = req.body;

    if (!guide?.id || !guide?.code) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Faltan campos requeridos: id, code' 
      });
    }

    const officeId = guide.office_id || req.user?.office_id || req.user?.id || 'default';
    const userId = req.user?.id || null;

    const savedGuide = await GuidesModel.save(guide, officeId, userId);

    // Notificar a los clientes mediante Socket.IO si el servidor io está configurado
    const io = req.app.get('io');
    if (io) {
      if (officeId && officeId !== 'default') {
        io.to(officeId).emit('chatGuide', savedGuide);
      } else {
        io.emit('chatGuide', savedGuide);
      }
    }

    res.status(201).json(savedGuide);
  } catch (error) {
    next(error);
  }
}
