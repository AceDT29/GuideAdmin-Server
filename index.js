import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { db } from './src/lib/firebaseConfig.js';

const app = express();
const PORT = process.env.PORT || 5000;

// Middlewares
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173', // Adjust according to frontend port
  credentials: true,
}));
app.use(express.json());
app.use(morgan('dev'));
app.use(cookieParser());

// Rutas básicas
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Trade-Web Server is running' });
});

app.post('/api/guides', async (req, res) => {
  try {
    const data = req.body;
    console.log('Data recibida:', data);
    res.json({ status: 'ok', message: 'Guias recuperadas con exito' });
  } catch (error) {
    console.log(error);
    res.status(500).json({ status: 'error', message: 'Error al recuperar las guias' });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
