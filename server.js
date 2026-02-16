require('dotenv').config(); 
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

// 1. Initialize Firebase Admin SDK
let serviceAccount;

const parsePositiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const PORT = parsePositiveInt(process.env.PORT, 8080);
const MAX_WS_PAYLOAD_BYTES = parsePositiveInt(process.env.MAX_WS_PAYLOAD_BYTES, 64 * 1024);
const HOME_FILE_PATH = path.join(__dirname, 'home.html');
const ACCOUNT_DELETION_FILE_PATH = path.join(__dirname, 'account-deletion.html');
const PRIVACY_POLICY_FILE_PATH = path.join(__dirname, 'privacy-policy.html');
const TERMS_AND_CONDITIONS_FILE_PATH = path.join(__dirname, 'terms-and-conditions.html');
const WELL_KNOWN_DIR = path.join(__dirname, '.well-known');
const ASSET_LINKS_PATH = path.join(WELL_KNOWN_DIR, 'assetlinks.json');
const APPLE_ASSOCIATION_PATH = path.join(WELL_KNOWN_DIR, 'apple-app-site-association');

const serveFile = (res, filePath, contentType) => {
  fs.readFile(filePath, 'utf8', (error, content) => {
    if (error) {
      const fileName = path.basename(filePath);
      console.error(`❌ Failed to load ${fileName}:`, error.message);
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=300'
    });
    res.end(content);
  });
};

const normalizePathname = (pathname) => {
  if (!pathname || pathname === '/') {
    return '/';
  }

  const trimmed = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return trimmed.toLowerCase();
};

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    // If on Zeabur, use the full JSON string from ENV
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    console.log("☁️ Using FIREBASE_SERVICE_ACCOUNT from Environment Variables");
  } else {
    // If on Local, use your file
    serviceAccount = require("./serviceAccountKey.json");
    console.log("🛠️ Using local serviceAccountKey.json");
  }
} catch (e) {
  console.error("❌ FATAL: Could not initialize Firebase credentials", e.message);
  process.exit(1);
}

if (!process.env.FIREBASE_DATABASE_URL) {
  console.error("❌ FATAL: Missing FIREBASE_DATABASE_URL");
  process.exit(1);
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
const auth = admin.auth();

// 2. Import Handlers
const RoomManager = require('./roomManager');
const MessageRouter = require('./messageRouter');
const ConnectionHandler = require('./connectionHandler');

const roomManager = new RoomManager(db);
const messageRouter = new MessageRouter(db, roomManager);
const connectionHandler = new ConnectionHandler(db, roomManager, messageRouter, auth);

// 3. HTTP Server (for Pings/Health Checks)
const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = normalizePathname(requestUrl.pathname);

  if (pathname === '/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Server is Awake 🚀');
    return;
  }

  if (pathname === '/.well-known/assetlinks.json') {
    serveFile(res, ASSET_LINKS_PATH, 'application/json; charset=utf-8');
    return;
  }

  if (pathname === '/.well-known/apple-app-site-association') {
    serveFile(res, APPLE_ASSOCIATION_PATH, 'application/json; charset=utf-8');
    return;
  }

  if (pathname === '/' || pathname === '/join') {
    serveFile(res, HOME_FILE_PATH, 'text/html; charset=utf-8');
    return;
  }

  if (pathname === '/account-deletion' || pathname === '/account-deletion.html') {
    serveFile(res, ACCOUNT_DELETION_FILE_PATH, 'text/html; charset=utf-8');
    return;
  }

  if (pathname === '/privacy-policy' || pathname === '/privacy-policy.html') {
    serveFile(res, PRIVACY_POLICY_FILE_PATH, 'text/html; charset=utf-8');
    return;
  }

  if (
    pathname === '/terms-and-conditions' ||
    pathname === '/terms-and-condition' ||
    pathname === '/terms-and-conditions.html' ||
    pathname === '/terms-and-condition.html'
  ) {
    serveFile(res, TERMS_AND_CONDITIONS_FILE_PATH, 'text/html; charset=utf-8');
    return;
  }

  if (pathname === '/favicon.ico') {
    res.writeHead(204);
    res.end();
  } else {
    console.warn(`⚠️ Unknown HTTP route: ${req.method || 'GET'} ${requestUrl.pathname}`);
    res.writeHead(404);
    res.end();
  }
});

// 4. WebSocket Server
const wss = new WebSocket.Server({
  server,
  maxPayload: MAX_WS_PAYLOAD_BYTES,
  perMessageDeflate: false
});

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

let isShuttingDown = false;

const shutdown = (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`🛑 Received ${signal}. Shutting down server...`);

  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.close(1001, 'Server shutting down');
    }
  }

  const forcedExit = setTimeout(() => {
    console.error('❌ Forced shutdown timeout reached');
    process.exit(1);
  }, 10_000);
  forcedExit.unref();

  server.close((error) => {
    clearTimeout(forcedExit);
    if (error) {
      console.error('❌ Error while closing server:', error.message);
      process.exit(1);
      return;
    }
    console.log('✅ Server closed cleanly');
    process.exit(0);
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
