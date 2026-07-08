import { GuidesModel } from './guides.model.js';

/**
 * Obtiene todas las guías almacenadas.
 * GET /api/guides
 */
export async function getGuides(req, res, next) {
  try {
    const guides = await GuidesModel.getAll();
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

    const savedGuide = await GuidesModel.save(guide);
    res.status(201).json(savedGuide);
  } catch (error) {
    next(error);
  }
}
