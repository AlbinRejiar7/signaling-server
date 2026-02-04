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

        // 1. Listen for the 'join' message which contains the real UID
        if (message.type === 'join') {
          const { userId, roomId } = message;

          if (!userId || !roomId) {
            socket.send(JSON.stringify({ type: 'error', message: 'Missing userId or roomId' }));
            return;
          }

          // Attach the real Firebase UID to this socket
          socket.userId = userId;
          console.log(`✅ Linked UID: ${userId} to Room: ${roomId}`);

          // Let the RoomManager handle the Firebase logic
          this.roomManager.joinRoom(socket, roomId);

        } else {
          // 2. All other messages (offers/answers) are routed normally
          if (!socket.userId) {
            socket.send(JSON.stringify({ type: 'error', message: 'Must join room before signaling' }));
            return;
          }
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
      this.roomManager.handleDisconnect(socket);
    });
  }
}

module.exports = ConnectionHandler;