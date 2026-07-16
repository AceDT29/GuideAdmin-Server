import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { db, firebaseInitialized } from './src/lib/firebaseConfig.js';
import { createServer } from 'node:http';
import { Server } from 'socket.io';

const app = express();
const PORT = process.env.PORT || 5000;
const chatServer = createServer(app);

const io = new Server(chatServer, {
  cors: {
    origin: "*"
  }
});

// Lista de orígenes permitidos (desarrollo + producción)
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'https://tradeexpressguides.netlify.app', // Agrégalo explícitamente mientras debugueas
  (process.env.FRONTEND_URL || '').trim(),
].filter(origin => origin.length > 0); // filter Boolean no elimina strings vacíos

console.log('[CORS] Orígenes permitidos:', ALLOWED_ORIGINS); // Para debuguear

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    console.error(`[CORS] Origen rechazado: ${origin}`); // Log para debuguear
    callback(new Error(`CORS: origen no permitido → ${origin}`));
  },
  credentials: true,
}));

app.use(express.json());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(cookieParser());

// Chat connection
io.on("connection", (socket) => {
  console.log("Usuario conectado:", socket.id);
  // join a room
  socket.on("join", (room) => {
    socket.join(room);
    console.log(`Usuario ${socket.id} se unió a la sala ${room}`);
  });
  socket.on("disconnect", () => {
    console.log("Usuario desconectado:", socket.id);
  });
  socket.on("createGuide", (guide, callback) => {
    try {
      console.log("Nueva guía recibida:", guide);
      callback({
        success: true,
        offset: guide.timestamp,
      });
    } catch (error) {
      console.error("Error al crear la guía:", error);
      callback({ error: error.message });
    }
    io.emit("chatGuide", guide);
  });

});

// Iniciar servidor
chatServer.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
