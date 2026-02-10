require('dotenv').config(); 
const WebSocket = require('ws');
const http = require('http');
const admin = require('firebase-admin');

// 1. Initialize Firebase Admin SDK

let serviceAccount;

try {
  console.log("Checking for FIREBASE_SERVICE_ACCOUNT...");
  
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    // 1. Clean the string (sometimes Zeabur adds extra quotes)
    let rawJson = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
    
    serviceAccount = JSON.parse(rawJson);
    
    // 2. Fix the Private Key newline issue (CRITICAL)
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    
    console.log("☁️ JSON parsed successfully for Project:", serviceAccount.project_id);
  } else {
    serviceAccount = require("./serviceAccountKey.json");
    console.log("🛠️ Using local file");
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
  
  console.log("🚀 Firebase Admin Initialized!");

} catch (e) {
  // If this happens, you will see a REAL error in Zeabur logs
  console.error("❌ CRITICAL INITIALIZATION ERROR:", e.message);
  // Don't exit yet, let the logs flush
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});
// This will tell us the EXACT technical error
const testRef = admin.database().ref('.info/connected');

testRef.on('value', (snapshot) => {
    if (snapshot.val() === true) {
        console.log("✅ Firebase Connection: Verified");
    } else {
        console.log("⚠️ Firebase Connection: Disconnected/Pending");
    }
}, (error) => {
    // THIS LOGS THE REAL ERROR OBJECT
    console.error("❌ FIREBASE CRITICAL ERROR:", {
        code: error.code,
        message: error.message,
        stack: error.stack
    });
});

// Also try a test write to catch permission issues immediately
admin.database().ref('server_health_check').set({
    last_online: new Date().toISOString()
}).catch((error) => {
    console.error("❌ FIREBASE WRITE ERROR:", error.code, error.message);
});
const db = admin.database();

// 2. Import Handlers
const RoomManager = require('./roomManager');
const MessageRouter = require('./messageRouter');
const ConnectionHandler = require('./connectionHandler');

const roomManager = new RoomManager(db);
const messageRouter = new MessageRouter(db, roomManager);
const connectionHandler = new ConnectionHandler(db, roomManager, messageRouter);

const PORT = process.env.PORT || 8080;

// 3. HTTP Server (for Pings/Health Checks)
const server = http.createServer((req, res) => {
  if (req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Server is Awake 🚀');
  } else {
    res.writeHead(404);
    res.end();
  }
});

// 4. WebSocket Server
const wss = new WebSocket.Server({ server });

console.log('====================================');
console.log(`🚀 Signaling Server running on port ${PORT}`);
console.log('====================================');

wss.on('connection', (socket, req) => {
  const remoteIP = req.socket.remoteAddress;
  console.log(`🟢 NEW CONNECTION from ${remoteIP}`);

  /**
   * IMPORTANT: 
   * We hand off the ENTIRE socket lifecycle to the ConnectionHandler.
   * Do not add socket.on('message') here, because ConnectionHandler 
   * already has its own listener that passes data to the MessageRouter.
   */
  connectionHandler.handleConnection(socket);
});

// Start listening
server.listen(PORT, '0.0.0.0', () => {
  console.log(`📡 Listening at http://0.0.0.0:${PORT}`);
});

process.on('SIGINT', () => {
  console.log('🛑 Shutting down server...');
  server.close();
  process.exit();
});