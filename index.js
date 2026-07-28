import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { initSocketServer } from './src/sockets/socketHandler.js';
import { adminAuth } from './src/lib/firebaseConfig.js';
import authMiddleware from "./src/middleware/authMiddleware.js"

const PORT = process.env.PORT || 5000;
const galleta_secret = process.env.JWT_SECRET || process.env.SECRET_KEY;

/**
 * Crea y configura la aplicación Express + Socket.IO.
 * @returns {{ app: import('express').Express, chatServer: import('http').Server, io: import('socket.io').Server }}
 */
export function createApp() {
  const app = express();
  const chatServer = createServer(app);

  // Inicializar Socket.IO modularizado
  const io = initSocketServer(chatServer);

  // Lista de orígenes permitidos (desarrollo + producción)
  const ALLOWED_ORIGINS = [
    'http://localhost:5173',
    (process.env.FRONTEND_URL || '').trim(),
  ].filter(origin => origin.length > 0); // filter Boolean no elimina strings vacíos

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origen no permitido → ${origin}`));
    },
    credentials: true,
  }));

  app.use(express.json());
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
  app.use(cookieParser());


  // Test endpoints
  app.get('/api/test', (req, res) => {
    console.log("Test cors pasado con exito")
    res.status(200).json({ message: 'Prueba para futuros endpoints' });

  });

  app.post('/api/register', async function registerUser(req, res) {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ ok: false, message: 'MISSING_EMAIL_OR_PASSWORD' });
    }

    try {
      // Verifica si el usuario ya existe
      await adminAuth.getUserByEmail(email);
      return res.status(409).json({ ok: false, message: 'USER_ALREADY_EXISTS' });
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        // El correo no existe, se puede proceder a crear el usuario
        try {
          const userID = await adminAuth.createUser({
            email,
            password,
          });
          const decodedToken = jwt.sign({ uid: userID.uid, email: userID.email }, galleta_secret, { expiresIn: '7d' });
          return res.send({ ok: true, message: 'User registered successfully in firebase', token: decodedToken });
        } catch (createErr) {
          console.error('Error while creating the user:', createErr);
          return res.status(500).json({ ok: false, error: createErr.message });
        }
      } else {
        console.error('Unexpected error during user creation:', err);
        return res.status(500).json({ ok: false, error: err.message });
      }
    }
  })

  app.get('/api/return-user', authMiddleware, async function returnUser(req, res) {
    try {
      if (!req.user) return res.status(404).json({ ok: false, message: 'USER_NOT_FOUND' });
      return res.status(200).json({ ok: true, user: { uid: req.user.uid, email: req.user.email } });
    } catch (err) {
      console.error('Error returning user:', err);
      return res.status(500).json({ ok: false, message: 'INTERNAL_SERVER_ERROR' });
    }
  })

  return { app, chatServer, io };

}

// Solo iniciar el servidor cuando se ejecuta directamente (no al importar desde tests)
const isMainModule = process.argv[1]
  && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  const { chatServer } = createApp();
  chatServer.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}
