import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';
const secret = process.env.JWT_SECRET;

// Mockear Supabase para que use fallback en memoria
jest.unstable_mockModule('../src/lib/supabaseConfig.js', () => ({
  supabaseAdmin: null
}));

// Importar createApp después del mock
const { createApp } = await import('../index.js');
const { io: Client } = await import('socket.io-client');

let chatServer, io;
let clientSocket;
let port;

const testOfficeId = 'oficina-test-123';
const testUserId = 'user-test-456';
const validToken = jwt.sign(
  { uid: testUserId, email: 'oficina@test.com', officeId: testOfficeId },
  secret,
  { expiresIn: '1h' }
);

beforeAll((done) => {
  const app = createApp();
  chatServer = app.chatServer;
  io = app.io;

  // Puerto 0 = el OS asigna un puerto libre automáticamente
  chatServer.listen(0, () => {
    port = chatServer.address().port;
    clientSocket = Client(`http://localhost:${port}`, {
      transports: ['websocket'],
      auth: { token: validToken }
    });
    clientSocket.on('connect', done);
  });
});

afterAll((done) => {
  if (clientSocket && clientSocket.connected) {
    clientSocket.disconnect();
  }
  io.close();
  chatServer.close(done);
});

describe('Socket.IO Server (con Autenticación JWT y Auto-Join de Oficina)', () => {

  test('debe aceptar la conexión de un cliente autenticado y unirlo automáticamente a su sala de oficina', (done) => {
    expect(clientSocket.connected).toBe(true);
    expect(clientSocket.id).toBeDefined();

    setTimeout(() => {
      const serverSocket = io.sockets.sockets.get(clientSocket.id);
      expect(serverSocket).toBeDefined();
      expect(serverSocket.officeId).toBe(testOfficeId);
      expect(serverSocket.rooms.has(testOfficeId)).toBe(true);
      done();
    }, 50);
  });

  test('debe rechazar la conexión si no se provee un token JWT válido', (done) => {
    const unauthSocket = Client(`http://localhost:${port}`, {
      transports: ['websocket'],
      auth: { token: 'invalid-token' }
    });

    unauthSocket.on('connect_error', (err) => {
      expect(err.message).toContain('AUTHENTICATION_ERROR');
      unauthSocket.disconnect();
      done();
    });
  });

  test('debe rechazar la conexión si el officeId del cliente no coincide con el del token', (done) => {
    const mismatchSocket = Client(`http://localhost:${port}`, {
      transports: ['websocket'],
      auth: { token: validToken, officeId: 'oficina-diferente' }
    });

    mismatchSocket.on('connect_error', (err) => {
      expect(err.message).toContain('officeId mismatch');
      mismatchSocket.disconnect();
      done();
    });
  });

  test('debe procesar createGuide y emitir chatGuide a la sala de la oficina', (done) => {
    const timestamp = new Date().toISOString();
    const guideData = {
      id: 'guide-ws-test',
      code: 'WST1',
      timestamp,
    };

    // Escuchar el broadcast de chatGuide
    clientSocket.on('chatGuide', (receivedGuide) => {
      expect(receivedGuide.id).toBe(guideData.id);
      expect(receivedGuide.code).toBe(guideData.code);
      expect(receivedGuide.office_id).toBe(testOfficeId);
      clientSocket.off('chatGuide'); // limpiar listener
      done();
    });

    // Emitir createGuide con callback de acknowledgement
    clientSocket.emit('createGuide', guideData, (response) => {
      expect(response.success).toBe(true);
      expect(response.offset).toBe(guideData.timestamp);
    });
  });

});


