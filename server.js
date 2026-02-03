const WebSocket = require('ws');
const ConnectionHandler = require('./connectionHandler');
const RoomManager = require('./roomManager');
const MessageRouter = require('../webrtc-signaling/messageRouter');

const PORT = process.env.PORT || 8080;

// In-memory storage
const rooms = {};

// Initialize components
const roomManager = new RoomManager(rooms);
const messageRouter = new MessageRouter(rooms, roomManager);
const connectionHandler = new ConnectionHandler(rooms, roomManager, messageRouter);

// Start WebSocket server on all network interfaces
const wss = new WebSocket.Server({ port: PORT, host: '0.0.0.0' });

console.log('====================================');
console.log(`🚀 Signaling server running on ws://0.0.0.0:${PORT}`);
console.log(`🌐 Connect from LAN: ws://<YOUR_PC_LAN_IP>:${PORT}`);
console.log('====================================');

wss.on('connection', (socket, req) => {
  const remoteIP = req.socket.remoteAddress;
  console.log('🟢 NEW CONNECTION');
  console.log('   From:', remoteIP);

  connectionHandler.handleConnection(socket);

  socket.on('close', () => {
    console.log(`🔴 SOCKET CLOSED (from ${remoteIP})`);
  });

  socket.on('error', (err) => {
    console.error(`❌ SOCKET ERROR (from ${remoteIP}):`, err.message);
  });
});
