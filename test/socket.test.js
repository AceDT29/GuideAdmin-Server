import { jest } from '@jest/globals';

// Mockear Firebase para que use fallback en memoria
jest.unstable_mockModule('../src/lib/firebaseConfig.js', () => ({
  db: null,
  firebaseInitialized: false,
  firebaseApp: null,
  adminAuth: null
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
    // Si llegamos aquí, beforeAll ya conectó exitosamente
    expect(clientSocket.connected).toBe(true);
    expect(clientSocket.id).toBeDefined();
  });

  test('debe permitir unirse a una sala (join)', (done) => {
    const roomName = 'test-room-123';

    clientSocket.emit('join', roomName);

    // Verificamos que el servidor procesó el join
    // consultando las salas del socket en el lado del servidor
    setTimeout(() => {
      const serverSockets = io.sockets.sockets;
      const serverSocket = serverSockets.get(clientSocket.id);

      expect(serverSocket).toBeDefined();
      expect(serverSocket.rooms.has(roomName)).toBe(true);
      done();
    }, 100);
  });

  test('debe procesar createGuide y emitir chatGuide a todos', (done) => {
    const guideData = {
      id: 'guide-ws-test',
      code: 'WST1',
      title: 'Guía de prueba WebSocket',
      timestamp: Date.now(),
    };

    // Escuchar el broadcast de chatGuide
    clientSocket.on('chatGuide', (receivedGuide) => {
      expect(receivedGuide).toEqual(guideData);
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
