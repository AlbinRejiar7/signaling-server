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

        if (message.type === 'join') {
          const { userId, roomId } = message; // ProfileImage, name ellam ignore cheyyaam

          if (!userId || !roomId) {
            return socket.send(JSON.stringify({ 
              type: 'error', 
              message: 'Missing userId or roomId' 
            }));
          }

          socket.userId = userId;
          socket.currentRoomId = roomId; 
          
          console.log(`✅ Session Linked: ${userId} joined Room: ${roomId}`);

        
          this.roomManager.joinRoom(socket, roomId, { 
            userId: userId,
            isMicActive: true // Default starting state
          });

        } else {
          // Routing logic
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