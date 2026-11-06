import { Router } from 'express';
import authMiddleware from '../../middleware/authMiddleware.js';
import adminMiddleware from '../../middleware/adminMiddleware.js';
import {
  getMetrics,
  getOffices,
  updateOfficeRole,
  updateOfficeStatus,
  approveOffice,
  deleteOffice,
} from './admin.controller.js';

const router = Router();

// Todas las rutas de administración requieren autenticación Y privilegios de admin
router.use(authMiddleware);
router.use(adminMiddleware);

router.get('/metrics', getMetrics);
router.get('/offices', getOffices);
router.patch('/offices/:id/role', updateOfficeRole);
router.patch('/offices/:id/status', updateOfficeStatus);
router.patch('/offices/:id/approve', approveOffice);
router.post('/offices/:id/approve', approveOffice);
router.delete('/offices/:id', deleteOffice);

export default router;

