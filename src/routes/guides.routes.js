import express from 'express';
import { 
  getGuides, 
  createOrUpdateGuide, 
  updateGuide, 
  resetGuides,
  deleteGuide
} from '../modules/guides/guides.controller.js';
import authMiddleware from '../middleware/authMiddleware.js';

const router = express.Router();

// GET /api/guides
router.get('/', authMiddleware, getGuides);

// POST /api/guides
router.post('/', authMiddleware, createOrUpdateGuide);

// PATCH /api/guides/:id (marcar entregado o actualizar detalles)
router.patch('/:id', authMiddleware, updateGuide);

// DELETE /api/guides/:id (eliminar una guía individual)
router.delete('/:id', authMiddleware, deleteGuide);

// POST /api/guides/reset o DELETE /api/guides (reiniciar gestión de guías)
router.post('/reset', authMiddleware, resetGuides);
router.delete('/', authMiddleware, resetGuides);

export default router;
