import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { db, firebaseInitialized } from './src/lib/firebaseConfig.js';
import guidesRouter from './src/routes/guides.routes.js';

const app = express();
const PORT = process.env.PORT || 5000;

// Lista de orígenes permitidos (desarrollo + producción)
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  (process.env.FRONTEND_URL || '').trim(),
].filter(Boolean);

// Middlewares
app.use(cors({
  origin: (origin, callback) => {
    // Permitir peticiones sin origin (ej: Postman, curl, same-origin)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origen no permitido → ${origin}`));
  },
  credentials: true,
}));

app.use(express.json());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(cookieParser());

// Rutas básicas
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Trade-Web Server is running',
    firebase: firebaseInitialized ? 'connected' : 'disabled (using memory fallback)',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Registrar rutas MVC
app.use('/api/guides', guidesRouter);

// Middleware de manejo de errores global
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]:', err.stack || err);
  const isProduction = process.env.NODE_ENV === 'production';
  res.status(err.status || 500).json({
    status: 'error',
    message: isProduction ? 'Internal server error' : err.message
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
