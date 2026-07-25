import { Server } from 'socket.io';
/**
 * Registra los eventos de conexión y lógica de Socket.IO.
 * @param {import('socket.io').Server} io
 */
export function registerSocketEvents(io) {
  io.on("connection", (socket) => {
    console.log("Usuario conectado:", socket.id);

    // Unirse a una sala
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
        if (typeof callback === 'function') {
          callback({
            success: true,
            offset: guide.timestamp,
          });
        }
      } catch (error) {
        console.error("Error al crear la guía:", error);
        if (typeof callback === 'function') {
          callback({ error: error.message });
        }
      }
      io.emit("chatGuide", guide);
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
