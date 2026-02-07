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
          // ADDED: profileImageUrl from the client message
          const { userId, roomId, name, isHost, profileImageUrl } = message;

          if (!userId || !roomId) {
            return socket.send(JSON.stringify({ 
              type: 'error', 
              message: 'Missing userId or roomId' 
            }));
          }

          // SECURITY: Permanently link this specific socket to this UID and Room
          socket.userId = userId;
          socket.currentRoomId = roomId; 
          
          console.log(`✅ Session Linked: ${userId} (${name}) joined Room: ${roomId}`);

          // Pass the profileImageUrl to the roomManager so it can be saved in Firebase
          // and broadcasted to other participants.
          this.roomManager.joinRoom(socket, roomId, { 
            name, 
            isHost, 
            profileImageUrl: profileImageUrl || "", // Default to empty string if missing
            isMicActive: false, // Initial mic state as per your model
            joinedAt: Date.now()
          });

        } else {
          // 2. Routing logic (Verification)
          if (!socket.userId || !socket.currentRoomId) {
            return socket.send(JSON.stringify({ 
              type: 'error', 
              message: 'Not authorized: Join a room first' 
            }));
          }
          
          message.roomId = socket.currentRoomId;
          this.messageRouter.handleMessage(socket, message);
        }
      } catch (err) {
        console.error('❌ JSON Processing Error:', err.message);
      }
    });

    // 3. Robust Cleanup
    const cleanup = () => {
      if (socket.userId && socket.currentRoomId) {
        console.log(`👋 User ${socket.userId} disconnected.`);
        this.roomManager.leaveRoom(socket);
        
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