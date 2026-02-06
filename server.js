require('dotenv').config(); 
const WebSocket = require('ws');
const http = require('http');
const admin = require('firebase-admin');

// 1. Initialize Firebase Admin SDK
let serviceAccount;
try {
  serviceAccount = require("./serviceAccountKey.json");
  console.log("🛠️ Using local serviceAccountKey.json");
} catch (e) {
  console.log("☁️ File not found, using Environment Variables");
  serviceAccount = {
    type: "service_account",
    project_id: process.env.FIREBASE_PROJECT_ID,
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  };
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.database();

// 2. Import Updated Handlers
const RoomManager = require('./roomManager');
const MessageRouter = require('./messageRouter');
const ConnectionHandler = require('./connectionHandler');

// Initialize modules with the database instance
const roomManager = new RoomManager(db);
const messageRouter = new MessageRouter(db, roomManager);
const connectionHandler = new ConnectionHandler(db, roomManager, messageRouter);

const PORT = process.env.PORT || 8080;

// 3. Create HTTP Server (Handles /ping for Render/uptime services)
const server = http.createServer((req, res) => {
  if (req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Server is Awake 🚀');
  } else {
    res.writeHead(404);
    res.end();
  }
});

// 4. Attach WebSocket to the HTTP server
const wss = new WebSocket.Server({ server });

console.log('====================================');
console.log(`🚀 Firebase Signaling Server [New Model] running on port ${PORT}`);
console.log('====================================');

wss.on('connection', (socket, req) => {
  const remoteIP = req.socket.remoteAddress;
  console.log(`🟢 NEW CONNECTION from ${remoteIP}`);

  // connectionHandler now expects messages with 'name' and 'isHost'
  connectionHandler.handleConnection(socket);

  socket.on('close', () => {
    // roomManager.leaveRoom is called inside connectionHandler.on('close')
    console.log(`🔴 SOCKET CLOSED for a user`);
  });

  socket.on('error', (err) => {
    console.error(`❌ SOCKET ERROR:`, err.message);
  });
});

// 5. Start the server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`📡 Listening at http://0.0.0.0:${PORT}`);
});

// Optional: Handle process termination to clean up (useful for local dev)
process.on('SIGINT', () => {
  console.log("Shutting down...");
  server.close();
  process.exit();
});