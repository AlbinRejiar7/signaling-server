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

        // 1. Listen for the 'join' message with the new model fields
        if (message.type === 'join') {
          // Destructure name and isHost from the message sent by Flutter
          const { userId, roomId, name, isHost } = message;

          if (!userId || !roomId) {
            socket.send(JSON.stringify({ 
              type: 'error', 
              message: 'Missing userId or roomId' 
            }));
            return;
          }

          // Attach the real Firebase UID to this socket for future reference
          socket.userId = userId;
          console.log(`✅ Linked UID: ${userId} (${name}) to Room: ${roomId}`);

          // 2. Pass the extra info (userData) to RoomManager
          // This allows RoomManager to build the participant object correctly
          this.roomManager.joinRoom(socket, roomId, { name, isHost });

        } else {
          // 3. Routing signaling messages (offers/answers/candidates)
          if (!socket.userId) {
            socket.send(JSON.stringify({ 
              type: 'error', 
              message: 'Must join room before signaling' 
            }));
            return;
          }
          
          // Pass the message to the router to find the target recipient
          this.messageRouter.handleMessage(socket, message);
        }
      } catch (err) {
        console.error('❌ Invalid JSON received:', err.message);
      }
    });

    socket.on('close', () => {
      if (socket.userId) {
        console.log(`👋 User ${socket.userId} disconnected`);
        this.roomManager.handleDisconnect(socket);
      }
    });

    socket.on('error', (err) => {
      console.error(`❌ Socket error:`, err.message);
      if (socket.userId) {
        this.roomManager.handleDisconnect(socket);
      }
    });
  }
}

module.exports = ConnectionHandler;