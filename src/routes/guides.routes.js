import express from 'express';
import { 
  getGuides, 
  createOrUpdateGuide, 
  updateGuide, 
  resetGuides,
  deleteGuide
} from '../modules/guides/guides.controller.js';
import authMiddleware from '../middleware/authMiddleware.js';
import approvedOfficeMiddleware from '../middleware/approvedOfficeMiddleware.js';

const router = express.Router();

// Todas las operaciones con guías requieren autenticación Y que la oficina esté aprobada
router.use(authMiddleware);
router.use(approvedOfficeMiddleware);

// GET /api/guides
router.get('/', getGuides);

// POST /api/guides
router.post('/', createOrUpdateGuide);

// PATCH /api/guides/:id (marcar entregado o actualizar detalles)
router.patch('/:id', updateGuide);

// DELETE /api/guides/:id (eliminar una guía individual)
router.delete('/:id', deleteGuide);

// POST /api/guides/reset o DELETE /api/guides (reiniciar gestión de guías)
router.post('/reset', resetGuides);
router.delete('/', resetGuides);

export default router;
