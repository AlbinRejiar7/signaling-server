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
const DEFAULT_ISSUE_FETCH_LIMIT = parsePositiveInt(process.env.ISSUE_DASHBOARD_DEFAULT_LIMIT, 100);
const MAX_ISSUE_FETCH_LIMIT = 500;
const ISSUES_COLLECTION_ENV = (process.env.ISSUES_COLLECTION || '').trim();
const HOME_FILE_PATH = path.join(__dirname, 'home.html');
const ISSUE_DASHBOARD_FILE_PATH = path.join(__dirname, 'issue-dashboard.html');
const ACCOUNT_DELETION_FILE_PATH = path.join(__dirname, 'account-deletion.html');
const PRIVACY_POLICY_FILE_PATH = path.join(__dirname, 'privacy-policy.html');
const TERMS_AND_CONDITIONS_FILE_PATH = path.join(__dirname, 'terms-and-conditions.html');
const WELL_KNOWN_DIR = path.join(__dirname, '.well-known');
const ASSET_LINKS_PATH = path.join(WELL_KNOWN_DIR, 'assetlinks.json');
const APPLE_ASSOCIATION_PATH = path.join(WELL_KNOWN_DIR, 'apple-app-site-association');
const DEFAULT_ISSUE_COLLECTION_CANDIDATES = ISSUES_COLLECTION_ENV
  ? [ISSUES_COLLECTION_ENV]
  : ['issue_reports', 'issueReports', 'issues', 'support_reports', 'reports'];

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

const parseBoundedInt = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const sanitizeToken = (value, maxLen = 64) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.slice(0, maxLen);
};

const sanitizeCollectionName = (value) => {
  const token = sanitizeToken(value, 120);
  if (!token) return '';
  return token.replace(/[^A-Za-z0-9_-]/g, '');
};

const toMillis = (value) => {
  if (!value) return 0;

  if (typeof value === 'object') {
    if (typeof value.seconds === 'number') {
      const nanos = typeof value.nanoseconds === 'number' ? value.nanoseconds : 0;
      return value.seconds * 1000 + Math.floor(nanos / 1_000_000);
    }

    if (typeof value.iso === 'string') {
      const millis = Date.parse(value.iso);
      return Number.isFinite(millis) ? millis : 0;
    }
  }

  if (typeof value === 'string') {
    const millis = Date.parse(value);
    return Number.isFinite(millis) ? millis : 0;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  return 0;
};

const normalizeFirestoreValue = (value) => {
  if (value === undefined) return null;
  if (value === null) return null;

  if (value instanceof Date) {
    return {
      iso: value.toISOString()
    };
  }

  if (
    value &&
    typeof value === 'object' &&
    typeof value.toDate === 'function' &&
    typeof value.seconds === 'number'
  ) {
    const asDate = value.toDate();
    return {
      iso: asDate.toISOString(),
      seconds: value.seconds,
      nanoseconds: value.nanoseconds
    };
  }

  if (Array.isArray(value)) {
    return value.map(normalizeFirestoreValue);
  }

  if (typeof value === 'object') {
    const output = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      output[key] = normalizeFirestoreValue(nestedValue);
    }
    return output;
  }

  return value;
};

const sendJson = (res, statusCode, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
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
const firestore = admin.firestore();

const doesIssueMatchSearch = (issueData, searchText) => {
  if (!searchText) return true;

  const haystack = [
    issueData.title,
    issueData.description,
    issueData.status,
    issueData.source,
    issueData.authUid,
    issueData?.app?.appName,
    issueData?.app?.packageName,
    issueData?.reporter?.name,
    issueData?.reporter?.email,
    issueData?.reporter?.username,
    issueData?.reporter?.uid,
    issueData?.device?.brand,
    issueData?.device?.manufacturer,
    issueData?.device?.model,
    issueData?.device?.platform
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase())
    .join(' ');

  return haystack.includes(searchText);
};

const fetchIssueReports = async ({ collectionOverride, status, source, search, limit }) => {
  const requestedCollection = sanitizeCollectionName(collectionOverride);
  const statusFilter = sanitizeToken(status, 40).toLowerCase();
  const sourceFilter = sanitizeToken(source, 80).toLowerCase();
  const searchFilter = sanitizeToken(search, 160).toLowerCase();
  const fetchLimit = parseBoundedInt(limit, DEFAULT_ISSUE_FETCH_LIMIT, 1, MAX_ISSUE_FETCH_LIMIT);

  const collectionCandidates = requestedCollection
    ? [requestedCollection]
    : DEFAULT_ISSUE_COLLECTION_CANDIDATES;

  let selectedCollection = collectionCandidates[0];
  let selectedDocs = [];
  let fallbackError = null;

  for (const candidate of collectionCandidates) {
    try {
      const snapshot = await firestore
        .collection(candidate)
        .orderBy('createdAt', 'desc')
        .limit(fetchLimit)
        .get();

      selectedCollection = candidate;
      selectedDocs = snapshot.docs;

      if (requestedCollection || !snapshot.empty) {
        break;
      }
    } catch (error) {
      fallbackError = error;

      try {
        const snapshotWithoutOrder = await firestore.collection(candidate).limit(fetchLimit).get();
        selectedCollection = candidate;
        selectedDocs = snapshotWithoutOrder.docs;

        if (requestedCollection || !snapshotWithoutOrder.empty) {
          break;
        }
      } catch (secondaryError) {
        fallbackError = secondaryError;
      }
    }
  }

  if (!selectedCollection) {
    throw fallbackError || new Error('Could not determine issue collection');
  }

  let issues = selectedDocs.map((doc) => {
    const normalizedData = normalizeFirestoreValue(doc.data());
    return {
      id: doc.id,
      path: doc.ref.path,
      data: normalizedData
    };
  });

  issues = issues.sort((left, right) => {
    const leftMillis = toMillis(left.data?.createdAt);
    const rightMillis = toMillis(right.data?.createdAt);
    return rightMillis - leftMillis;
  });

  if (statusFilter && statusFilter !== 'all') {
    issues = issues.filter((issue) => String(issue.data?.status || '').toLowerCase() === statusFilter);
  }

  if (sourceFilter && sourceFilter !== 'all') {
    issues = issues.filter((issue) => String(issue.data?.source || '').toLowerCase() === sourceFilter);
  }

  if (searchFilter) {
    issues = issues.filter((issue) => doesIssueMatchSearch(issue.data || {}, searchFilter));
  }

  const statusCounts = {};
  for (const issue of issues) {
    const key = String(issue.data?.status || 'unknown').toLowerCase();
    statusCounts[key] = (statusCounts[key] || 0) + 1;
  }

  return {
    collection: selectedCollection,
    requestedCollection: requestedCollection || null,
    count: issues.length,
    limit: fetchLimit,
    statusCounts,
    issues
  };
};

const handleIssuesApiRequest = async (res, requestUrl) => {
  try {
    const result = await fetchIssueReports({
      collectionOverride: requestUrl.searchParams.get('collection'),
      status: requestUrl.searchParams.get('status'),
      source: requestUrl.searchParams.get('source'),
      search: requestUrl.searchParams.get('search'),
      limit: requestUrl.searchParams.get('limit')
    });

    sendJson(res, 200, {
      ok: true,
      generatedAt: new Date().toISOString(),
      collection: result.collection,
      requestedCollection: result.requestedCollection,
      count: result.count,
      limit: result.limit,
      statusCounts: result.statusCounts,
      items: result.issues
    });
  } catch (error) {
    console.error('❌ Failed to load issue reports:', error.message);
    sendJson(res, 500, {
      ok: false,
      error: 'Failed to load issue reports',
      details: error.message
    });
  }
};

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

  if (pathname === '/api/issues') {
    handleIssuesApiRequest(res, requestUrl);
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

  if (pathname === '/issues-dashboard' || pathname === '/issues-dashboard.html') {
    serveFile(res, ISSUE_DASHBOARD_FILE_PATH, 'text/html; charset=utf-8');
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
