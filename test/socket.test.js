import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';
const secret = process.env.JWT_SECRET;

// Mockear Supabase para que use fallback en memoria
jest.unstable_mockModule('../src/lib/supabaseConfig.js', () => ({
  supabaseAdmin: null
}));

// Importar createApp y GuidesModel después del mock
const { createApp } = await import('../index.js');
const { GuidesModel } = await import('../src/modules/guides/guides.model.js');
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

  test('debe procesar updateGuide y emitir el evento a la sala de la oficina', (done) => {
    clientSocket.on('updateGuide', (updatedGuide) => {
      expect(updatedGuide.id).toBe('guide-ws-test');
      expect(updatedGuide.delivered).toBe(true);
      expect(updatedGuide.owner).toBe('CARLOS RUIZ');
      clientSocket.off('updateGuide');
      done();
    });

    clientSocket.emit('updateGuide', {
      id: 'guide-ws-test',
      delivered: true,
      owner: 'CARLOS RUIZ'
    }, (response) => {
      expect(response.success).toBe(true);
      expect(response.guide.delivered).toBe(true);
    });
  });

  test('debe procesar deleteGuide y emitir guideDeleted a la sala de la oficina', async () => {
    // Guardar una guía adicional para probar el borrado sin vaciar la oficina
    await GuidesModel.save({ id: 'guide-ws-delete', code: 'WSDEL1' }, testOfficeId);

    await new Promise((resolve) => {
      clientSocket.on('guideDeleted', (payload) => {
        expect(payload.id).toBe('guide-ws-delete');
        expect(payload.officeId).toBe(testOfficeId);
        clientSocket.off('guideDeleted');
        resolve();
      });

      clientSocket.emit('deleteGuide', { id: 'guide-ws-delete' }, (response) => {
        expect(response.success).toBe(true);
        expect(response.id).toBe('guide-ws-delete');
      });
    });
  });

  test('debe procesar resetGuides y emitir guidesCleared y guidesReset a la sala de la oficina', (done) => {
    let clearedReceived = false;
    let resetReceived = false;

    const checkDone = () => {
      if (clearedReceived && resetReceived) {
        clientSocket.off('guidesCleared');
        clientSocket.off('guidesReset');
        done();
      }
    };

    clientSocket.on('guidesCleared', (payload) => {
      expect(payload.officeId).toBe(testOfficeId);
      expect(payload.deletedCount).toBeGreaterThanOrEqual(1);
      clearedReceived = true;
      checkDone();
    });

    clientSocket.on('guidesReset', (payload) => {
      expect(payload.officeId).toBe(testOfficeId);
      resetReceived = true;
      checkDone();
    });

    clientSocket.emit('resetGuides', {}, (response) => {
      expect(response.success).toBe(true);
      expect(response.officeId).toBe(testOfficeId);
    });
  });

});


