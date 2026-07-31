import { jest } from '@jest/globals';

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

beforeAll((done) => {
  const app = createApp();
  chatServer = app.chatServer;
  io = app.io;

  // Puerto 0 = el OS asigna un puerto libre automáticamente
  chatServer.listen(0, () => {
    port = chatServer.address().port;
    clientSocket = Client(`http://localhost:${port}`, {
      transports: ['websocket'],
    });
    clientSocket.on('connect', done);
  });
});

afterAll((done) => {
  if (clientSocket.connected) {
    clientSocket.disconnect();
  }
  io.close();
  chatServer.close(done);
});

describe('Socket.IO Server', () => {

  test('debe aceptar la conexión de un cliente', () => {
    expect(clientSocket.connected).toBe(true);
    expect(clientSocket.id).toBeDefined();
  });

  test('debe permitir unirse a una oficina con join_office', (done) => {
    const officeId = 'oficina-test-123';

    clientSocket.emit('join_office', officeId);

    setTimeout(() => {
      const serverSockets = io.sockets.sockets;
      const serverSocket = serverSockets.get(clientSocket.id);

      expect(serverSocket).toBeDefined();
      expect(serverSocket.rooms.has(officeId)).toBe(true);
      done();
    }, 100);
  });

  test('debe procesar createGuide y emitir chatGuide con offset', (done) => {
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

