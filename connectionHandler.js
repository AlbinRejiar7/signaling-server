class ConnectionHandler {
  constructor(db, roomManager, messageRouter) {
    this.db = db;
    this.roomManager = roomManager;
    this.messageRouter = messageRouter;
  }

  handleConnection(socket) {
    console.log('👤 New raw connection established');

    socket.on('message', (data) => {
      try {
        const message = JSON.parse(data);

        // 1. Handshake: Setup the session
        if (message.type === 'join') {
          const { userId, roomId, name, isHost } = message;

          if (!userId || !roomId) {
            return socket.send(JSON.stringify({ type: 'error', message: 'Missing userId or roomId' }));
          }

          // SECURITY: Permanently link this specific socket to this UID and Room
          socket.userId = userId;
          socket.currentRoomId = roomId; 
          
          console.log(`✅ Session Linked: ${userId} joined Room: ${roomId}`);

          // Initialize persistent data (Firebase)
          this.roomManager.joinRoom(socket, roomId, { name, isHost });

        } else {
          // 2. Routing: Only allow messages if joined
          if (!socket.userId || !socket.currentRoomId) {
            return socket.send(JSON.stringify({ type: 'error', message: 'Not authorized: Join a room first' }));
          }
          
          // FORCED SECURITY: Overwrite any roomId in the message with the socket's verified ID
          // This prevents "spoofing" messages to other rooms.
          message.roomId = socket.currentRoomId;

          // Pass to Router (Handles WebRTC signals AND updateVoiceStatus)
          this.messageRouter.handleMessage(socket, message);
        }
      } catch (err) {
        console.error('❌ JSON Processing Error:', err.message);
      }
    });

    // 3. Robust Cleanup (Handles both accidental and intentional disconnects)
    const cleanup = () => {
      if (socket.userId && socket.currentRoomId) {
        console.log(`👋 User ${socket.userId} disconnected.`);
        // Remove from Firebase and Notify Peers
        this.roomManager.leaveRoom(socket);
        
        // Clear memory on the socket object
        socket.userId = null;
        socket.currentRoomId = null;
      }
    };

    socket.on('close', cleanup);
    socket.on('error', (err) => {
      console.error(`❌ Socket error:`, err.message);
      cleanup();
    });
  }
}

module.exports = ConnectionHandler;