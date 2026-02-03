const { v4: uuidv4 } = require('uuid');

class ConnectionHandler {
  constructor(rooms, roomManager, messageRouter) {
    this.rooms = rooms;
    this.roomManager = roomManager;
    this.messageRouter = messageRouter;
  }

  handleConnection(socket) {
    const userId = uuidv4();
    socket.userId = userId;

    console.log(`👤 User connected: ${userId}`);

    // Send welcome
    socket.send(JSON.stringify({ type: 'welcome', userId }));
    console.log(`➡️ Sent welcome to ${userId}`);

    socket.on('message', (data) => {
      console.log(`📩 Message from ${userId}:`, data.toString());

      try {
        const message = JSON.parse(data);
        this.messageRouter.routeMessage(socket, message);
      } catch (err) {
        console.error('❌ Invalid JSON from', userId);
        socket.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      }
    });

    socket.on('close', () => {
      console.log(`👋 User disconnected: ${userId}`);
      this.roomManager.handleDisconnect(socket);
    });

    socket.on('error', (err) => {
      console.error(`❌ Socket error (${userId}):`, err.message);
      this.roomManager.handleDisconnect(socket);
    });
  }
}

module.exports = ConnectionHandler;
