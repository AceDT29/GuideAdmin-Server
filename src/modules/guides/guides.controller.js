import { GuidesModel } from './guides.model.js';
import { 
  fetchGuidesByOffice, 
  resetGuidesByOffice, 
  updateGuide as updateGuideService 
} from './guides.service.js';

/**
 * Obtiene las guías almacenadas, opcionalmente filtradas por oficina y offset (since).
 * GET /api/guides
 */
export async function getGuides(req, res, next) {
  try {
    // Aislamiento seguro: siempre forzar la oficina del usuario autenticado
    const officeId = req.user?.officeId || req.user?.office_id || req.user?.id || 'default';
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

    // Forzar oficina del token; ignorar spoofing de office_id en el body
    const officeId = req.user?.officeId || req.user?.office_id || req.user?.id || 'default';
    const userId = req.user?.uid || req.user?.id || null;

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

/**
 * Actualiza parcialmente una guía (ej: marcar delivered o cambiar dueño).
 * PATCH /api/guides/:id
 */
export async function updateGuide(req, res, next) {
  try {
    const { id } = req.params;
    const updates = req.body;
    const officeId = req.user?.officeId || req.user?.office_id;

    // Prevenir alteración maliciosa de oficina
    delete updates.office_id;
    delete updates.officeId;

    const updatedGuide = await updateGuideService(id, updates, officeId);
    if (!updatedGuide) {
      return res.status(404).json({
        status: 'error',
        message: 'Guía no encontrada'
      });
    }

    const io = req.app.get('io');
    if (io) {
      const targetOffice = updatedGuide.office_id || officeId;
      if (targetOffice && targetOffice !== 'default') {
        io.to(targetOffice).emit('updateGuide', updatedGuide);
      } else {
        io.emit('updateGuide', updatedGuide);
      }
    }

    res.json(updatedGuide);
  } catch (error) {
    next(error);
  }
}

/**
 * Reinicia la gestión de guías para una oficina o todas las guías.
 * POST /api/guides/reset o DELETE /api/guides
 */
export async function resetGuides(req, res, next) {
  try {
    // Forzar la oficina del usuario autenticado para evitar purga cruzada
    const officeId = req.user?.officeId 
      || req.user?.office_id 
      || req.user?.id 
      || 'default';

    const result = await resetGuidesByOffice(officeId);

    const payload = {
      officeId,
      purgedAt: new Date().toISOString(),
      deletedCount: result.deletedCount
    };

    const io = req.app.get('io');
    if (io) {
      if (officeId && officeId !== 'all' && officeId !== 'default') {
        io.to(officeId).emit('guidesCleared', payload);
        io.to(officeId).emit('guidesReset', payload);
      } else {
        io.emit('guidesCleared', payload);
        io.emit('guidesReset', payload);
      }
    }

    res.json({
      success: true,
      message: 'Gestión de guías reiniciada correctamente',
      ...payload
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Elimina una guía individual.
 * DELETE /api/guides/:id
 */
export async function deleteGuide(req, res, next) {
  try {
    const { id } = req.params;
    const officeId = req.user?.officeId || req.user?.office_id || 'default';

    const deleted = await GuidesModel.delete(id, officeId);
    if (!deleted) {
      return res.status(404).json({
        status: 'error',
        message: 'Guía no encontrada'
      });
    }

    const payload = { id, officeId };
    const io = req.app.get('io');
    if (io) {
      if (officeId && officeId !== 'all' && officeId !== 'default') {
        io.to(officeId).emit('guideDeleted', payload);
      } else {
        io.emit('guideDeleted', payload);
      }
    }

    res.json({
      success: true,
      message: 'Guía eliminada correctamente',
      ...payload
    });
  } catch (error) {
    next(error);
  }
}
