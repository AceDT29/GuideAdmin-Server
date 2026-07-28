import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { initSocketServer } from './src/sockets/socketHandler.js';
import authRoutes from './src/modules/auth/auth.routes.js';
import guidesRoutes from './src/routes/guides.routes.js';

const PORT = process.env.PORT || 5000;

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

  // Rutas de la API
  app.use('/api/auth', authRoutes);
  app.use('/api/guides', guidesRoutes);

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
