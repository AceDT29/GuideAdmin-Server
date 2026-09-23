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

const router = express.Router();

// Registro y Login (emiten Access Token + Refresh Token de dispositivo)
router.post('/register', registerUser);
router.post('/login', loginUser);

// Datos del usuario autenticado
router.get('/return-user', authMiddleware, returnUser);

// Refresco y rotación de sesión multi-dispositivo
router.post('/refresh', refreshTokenHandler);

// Cierre de sesión individual (este dispositivo)
router.post('/logout', logoutUser);

// Cierre de sesión global (todos los dispositivos de la cuenta/oficina)
router.post('/logout-all', authMiddleware, logoutAllDevices);

export default router;