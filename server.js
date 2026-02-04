require('dotenv').config(); // Load variables from .env for local testing
const WebSocket = require('ws');
const http = require('http');
const admin = require('firebase-admin');
let serviceAccount;
// 1. Initialize Firebase Admin SDK using Environment Variables
try {
  // 1. Try to load from the local file first
  serviceAccount = require("./serviceAccountKey.json");
  console.log("🛠️ Using local serviceAccountKey.json");
} catch (e) {
  // 2. If file doesn't exist (on Render), use environment variables
  console.log("☁️ File not found, using Environment Variables");
  serviceAccount = {
    type: "service_account",
    project_id: process.env.FIREBASE_PROJECT_ID,
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  };
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.database();

// 2. Import Handlers (passing 'db' instead of 'rooms')
const RoomManager = require('./roomManager');
const MessageRouter = require('./messageRouter');
const ConnectionHandler = require('./connectionHandler');

const roomManager = new RoomManager(db);
const messageRouter = new MessageRouter(db, roomManager);
const connectionHandler = new ConnectionHandler(db, roomManager, messageRouter);

const PORT = process.env.PORT || 8080;

// 3. Create HTTP Server to handle both WebSocket and Cron-job Pings
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
console.log(`🚀 Firebase Signaling Server running on port ${PORT}`);
console.log(`📡 Ping Route: http://your-app.onrender.com/ping`);
console.log('====================================');

wss.on('connection', (socket, req) => {
  const remoteIP = req.socket.remoteAddress;
  console.log(`🟢 NEW CONNECTION from ${remoteIP}`);

  connectionHandler.handleConnection(socket);

  socket.on('close', () => {
    console.log(`🔴 SOCKET CLOSED`);
  });

  socket.on('error', (err) => {
    console.error(`❌ SOCKET ERROR:`, err.message);
  });
});

server.listen(PORT);