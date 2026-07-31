import { Server } from 'socket.io';
import { GuidesModel } from '../modules/guides/guides.model.js';

/**
 * Registra los eventos de conexión y lógica de Socket.IO.
 * @param {import('socket.io').Server} io
 */
export function registerSocketEvents(io) {
  io.on("connection", (socket) => {
    console.log("Usuario conectado:", socket.id);

    // Unirse a una sala / oficina
    socket.on("join", (room) => {
      socket.join(room);
      socket.officeId = room;
      console.log(`Usuario ${socket.id} se unió a la sala ${room}`);
    });

    socket.on("join_office", (officeId) => {
      socket.join(officeId);
      socket.officeId = officeId;
      console.log(`Usuario ${socket.id} se unió a la oficina ${officeId}`);
    });

    socket.on("disconnect", () => {
      console.log("Usuario desconectado:", socket.id);
    });

    socket.on("createGuide", async (guide, callback) => {
      try {
        console.log("Nueva guía recibida:", guide);
        const officeId = socket.officeId || guide.office_id || "default";
        const userId = socket.user?.id || null;

        const savedGuide = await GuidesModel.save(guide, officeId, userId);

        if (typeof callback === 'function') {
          callback({
            success: true,
            offset: savedGuide.timestamp,
          });
        }

        if (socket.officeId) {
          io.to(socket.officeId).emit("chatGuide", savedGuide);
        } else {
          io.emit("chatGuide", savedGuide);
        }
      } catch (error) {
        console.error("Error al crear la guía:", error);
        if (typeof callback === 'function') {
          callback({ error: error.message });
        }
      }
    });
  });
}

/**
 * Inicializa y configura el servidor Socket.IO integrándolo al servidor HTTP principal.
 * @param {import('node:http').Server} httpServer
 * @returns {import('socket.io').Server}
 */
export function initSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || "http://localhost:5173"
    }
  });

  registerSocketEvents(io);

  return io;
}
