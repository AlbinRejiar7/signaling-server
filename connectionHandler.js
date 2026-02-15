const parsePositiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

class ConnectionHandler {
  constructor(db, roomManager, messageRouter, auth) {
    this.db = db;
    this.roomManager = roomManager;
    this.messageRouter = messageRouter;
    this.auth = auth;
  }

  safeSend(socket, payload) {
    if (!socket || socket.readyState !== 1) return;
    try {
      socket.send(JSON.stringify(payload));
    } catch (error) {
      console.warn('⚠️ Failed to send socket response:', error.message);
    }
  }

  isValidRoomId(roomId) {
    return typeof roomId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(roomId);
  }

  handleConnection(socket) {
    console.log('👤 New raw connection established');

    const AUTH_TIMEOUT_MS = parsePositiveInt(process.env.AUTH_TIMEOUT_MS, 10_000);
    const RATE_LIMIT_WINDOW_MS = parsePositiveInt(process.env.RATE_LIMIT_WINDOW_MS, 10_000);
    const MAX_MESSAGES_PER_WINDOW = parsePositiveInt(process.env.MAX_MESSAGES_PER_WINDOW, 120);
    const MAX_MESSAGE_BYTES = parsePositiveInt(process.env.MAX_MESSAGE_BYTES, 64 * 1024);

    let messageCount = 0;
    let rateWindowStart = Date.now();
    let cleanupStarted = false;

    const authTimeout = setTimeout(() => {
      if (!socket.userId) {
        this.safeSend(socket, { type: 'error', message: 'Authentication timeout' });
        socket.close(4001, 'Authentication timeout');
      }
    }, AUTH_TIMEOUT_MS);
    if (typeof authTimeout.unref === 'function') authTimeout.unref();

    const cleanup = async () => {
      if (cleanupStarted) return;
      cleanupStarted = true;
      clearTimeout(authTimeout);

      if (socket.userId && socket.currentRoomId) {
        console.log(`👋 User ${socket.userId} disconnected.`);
        await this.roomManager.leaveRoom(socket);
      }

      socket.userId = null;
      socket.currentRoomId = null;
    };

    const runCleanup = () => {
      cleanup().catch((error) => {
        console.error('❌ Cleanup error:', error.message);
      });
    };

    socket.on('message', async (rawData, isBinary) => {
      try {
        const now = Date.now();
        if (now - rateWindowStart >= RATE_LIMIT_WINDOW_MS) {
          rateWindowStart = now;
          messageCount = 0;
        }

        messageCount += 1;
        if (messageCount > MAX_MESSAGES_PER_WINDOW) {
          this.safeSend(socket, { type: 'error', message: 'Rate limit exceeded' });
          socket.close(4008, 'Rate limit exceeded');
          return;
        }

        if (isBinary) {
          this.safeSend(socket, { type: 'error', message: 'Binary messages are not supported' });
          socket.close(1003, 'Binary payload not supported');
          return;
        }

        let textPayload = rawData;
        if (Buffer.isBuffer(textPayload)) {
          if (textPayload.length > MAX_MESSAGE_BYTES) {
            socket.close(1009, 'Message too large');
            return;
          }
          textPayload = textPayload.toString('utf8');
        }

        if (typeof textPayload !== 'string') {
          this.safeSend(socket, { type: 'error', message: 'Invalid payload type' });
          return;
        }

        if (Buffer.byteLength(textPayload, 'utf8') > MAX_MESSAGE_BYTES) {
          socket.close(1009, 'Message too large');
          return;
        }

        const message = JSON.parse(textPayload);

        if (message.type === 'join') {
          const { roomId, idToken, token } = message;
          const firebaseIdToken = idToken || token;

          if (!this.isValidRoomId(roomId)) {
            this.safeSend(socket, { type: 'error', message: 'Invalid roomId format' });
            return;
          }

          if (!firebaseIdToken || typeof firebaseIdToken !== 'string') {
            this.safeSend(socket, { type: 'error', message: 'Missing Firebase ID token' });
            return;
          }

          if (socket.userId || socket.currentRoomId) {
            this.safeSend(socket, { type: 'error', message: 'Already joined. Reconnect to switch room.' });
            return;
          }

          let decodedToken;
          try {
            decodedToken = await this.auth.verifyIdToken(firebaseIdToken);
          } catch (error) {
            console.warn('⚠️ Token verification failed:', error.message);
            this.safeSend(socket, { type: 'error', message: 'Authentication failed' });
            socket.close(4003, 'Authentication failed');
            return;
          }

          socket.userId = decodedToken.uid;
          socket.currentRoomId = roomId;

          console.log(`✅ Session Linked: ${socket.userId} joined Room: ${roomId}`);

          await this.roomManager.joinRoom(socket, roomId, {
            userId: socket.userId,
            isMicActive: true
          });
          return;
        }

        if (!socket.userId || !socket.currentRoomId) {
          this.safeSend(socket, {
            type: 'error',
            message: 'Not authorized: Join a room first'
          });
          return;
        }

        message.roomId = socket.currentRoomId;
        this.messageRouter.handleMessage(socket, message);
      } catch (error) {
        console.error('❌ JSON Processing Error:', error.message);
        this.safeSend(socket, { type: 'error', message: 'Invalid message format' });
      }
    });

    socket.on('close', runCleanup);
    socket.on('error', (error) => {
      console.error('❌ Socket error:', error.message);
      runCleanup();
    });
  }
}

module.exports = ConnectionHandler;
