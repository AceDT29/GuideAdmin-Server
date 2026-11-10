import { Router } from 'express';
import authMiddleware from '../../middleware/authMiddleware.js';
import adminMiddleware from '../../middleware/adminMiddleware.js';
import { rateLimit } from 'express-rate-limit';
import {
  getMetrics,
  getOffices,
  updateOfficeRole,
  updateOfficeStatus,
  approveOffice,
  deleteOffice,
  approveOfficeByEmail,
} from './admin.controller.js';

const router = Router();

// Limitador de tasa para prevenir ataques de fuerza bruta al enlace de aprobación por correo
const emailApprovalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 20, // 20 intentos por IP
  message: 'Demasiadas solicitudes de aprobación desde esta IP. Intenta más tarde.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

// Ruta pública protegida por token JWT firmado en query string (sin middleware de sesión)
router.get('/approve-by-email', emailApprovalLimiter, approveOfficeByEmail);

// Todas las demás rutas de administración requieren autenticación Y privilegios de admin
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

