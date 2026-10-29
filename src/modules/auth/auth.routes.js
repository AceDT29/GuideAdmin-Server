import {
  registerUser,
  returnUser,
  loginUser,
  refreshTokenHandler,
  logoutUser,
  logoutAllDevices,
} from './auth.controller.js';
import authMiddleware from '../../middleware/authMiddleware.js';
import express from 'express';
import { rateLimit } from 'express-rate-limit';

const router = express.Router();

// Limitador de tasa para mitigar ataques de fuerza bruta en autenticación
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // Ventana de 15 minutos
  max: 30, // Límite de 30 solicitudes por IP por ventana
  message: {
    ok: false,
    status: 'error',
    message: 'Demasiadas solicitudes de autenticación desde esta dirección IP. Intenta de nuevo más tarde.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test', // No bloquear ejecuciones de prueba Jest
});

// Registro y Login (emiten Access Token + Refresh Token de dispositivo)
router.post('/register', authLimiter, registerUser);
router.post('/login', authLimiter, loginUser);

// Datos del usuario autenticado
router.get('/return-user', authMiddleware, returnUser);

// Refresco y rotación de sesión multi-dispositivo
router.post('/refresh', authLimiter, refreshTokenHandler);

// Cierre de sesión individual (este dispositivo)
router.post('/logout', logoutUser);

// Cierre de sesión global (todos los dispositivos de la cuenta/oficina)
router.post('/logout-all', authMiddleware, logoutAllDevices);

export default router;