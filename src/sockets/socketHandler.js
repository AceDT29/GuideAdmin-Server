import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { GuidesModel } from '../modules/guides/guides.model.js';

/**
 * Registra los eventos de conexión y lógica de Socket.IO.
 * @param {import('socket.io').Server} io
 */
export function registerSocketEvents(io) {
  io.on("connection", (socket) => {
    // Unir automáticamente a la sala de la oficina autenticada
    if (socket.officeId) {
      socket.join(socket.officeId);
      console.log(`[Socket] Usuario ${socket.user?.uid || socket.id} (${socket.user?.email || 'N/A'}) se unió automáticamente a la sala de oficina: ${socket.officeId}`);
    } else {
      console.log(`[Socket] Conexión establecida sin officeId para socket: ${socket.id}`);
    }

    // Unirse manualmente a una sala / oficina adicional si fuera necesario
    socket.on("join", (room) => {
      socket.join(room);
      socket.officeId = room;
      console.log(`[Socket] Usuario ${socket.id} se unió manualmente a la sala ${room}`);
    });

    socket.on("join_office", (officeId) => {
      socket.join(officeId);
      socket.officeId = officeId;
      console.log(`[Socket] Usuario ${socket.id} se unió manualmente a la oficina ${officeId}`);
    });

    socket.on("disconnect", () => {
      console.log(`[Socket] Usuario desconectado: ${socket.id} (Oficina: ${socket.officeId})`);
    });

    socket.on("createGuide", async (guide, callback) => {
      try {
        console.log("Nueva guía recibida:", guide);
        const officeId = socket.officeId || guide.office_id || "default";
        const userId = socket.user?.uid || socket.user?.id || null;

        const savedGuide = await GuidesModel.save(guide, officeId, userId);

        if (typeof callback === 'function') {
          callback({
            success: true,
            offset: savedGuide.timestamp,
          });
        }

        if (officeId) {
          io.to(officeId).emit("chatGuide", savedGuide);
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

  // Middleware de autenticación JWT para Socket.IO
  // El cliente envía { token, officeId } opcionalmente — el servidor valida el token y
  // cross-valida que si se declara officeId coincida con el del token firmado.
  io.use((socket, next) => {
    const { token: rawToken, officeId: rawOfficeId } = socket.handshake.auth || {};
    const token = rawToken ? rawToken.replace(/^Bearer\s+/i, '').trim() : null;

    if (!token) {
      console.warn(`[Socket Auth] Rehusada conexión ${socket.id}: falta token.`);
      return next(new Error('AUTHENTICATION_ERROR: Token required'));
    }

    const secret = process.env.JWT_SECRET || process.env.SECRET_KEY;
    if (!secret) {
      console.error('[Socket Auth] JWT_SECRET o SECRET_KEY no configurado en entorno.');
      return next(new Error('SERVER_ERROR: Missing JWT secret configuration'));
    }

    try {
      const decoded = jwt.verify(token, secret);

      const tokenOfficeId = decoded.officeId || decoded.uid;
      const effectiveOfficeId = rawOfficeId || tokenOfficeId;

      // Cross-validación si el cliente envió officeId explícito
      if (rawOfficeId && rawOfficeId !== tokenOfficeId) {
        console.warn(`[Socket Auth] officeId inválido para socket ${socket.id}: cliente="${rawOfficeId}" token="${tokenOfficeId}"`);
        return next(new Error('AUTHENTICATION_ERROR: officeId mismatch'));
      }

      if (!effectiveOfficeId) {
        console.warn(`[Socket Auth] Rehusada conexión ${socket.id}: falta officeId.`);
        return next(new Error('AUTHENTICATION_ERROR: officeId required'));
      }

      socket.user = decoded;
      socket.officeId = effectiveOfficeId; // confirmado y validado contra el token
      next();
    } catch (err) {
      console.warn(`[Socket Auth] Token inválido para socket ${socket.id}: ${err.message}`);
      if (err instanceof jwt.TokenExpiredError) {
        return next(new Error('AUTHENTICATION_ERROR: Token expired'));
      }
      return next(new Error('AUTHENTICATION_ERROR: Invalid token'));
    }
  });

  registerSocketEvents(io);

  return io;
}

