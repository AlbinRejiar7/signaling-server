class MessageRouter {
  constructor(db, roomManager) {
    this.db = db;
    this.roomManager = roomManager;
  }

  handleMessage(socket, message) {
    const { type, roomId, targetUserId, ...payload } = message;
    const userId = socket.userId;

    // 1. Safety Check: Verify the room exists in our active connections
    const roomConnections = this.roomManager.activeConnections[roomId];

    if (!roomConnections || !roomConnections[userId]) {
      console.warn(`⚠️ User ${userId} tried "${type}" without being in room ${roomId}`);
      socket.send(JSON.stringify({ type: 'error', message: 'Not in room' }));
      return;
    }

    switch (type) {
      case 'leave':
        console.log(`🚪 Leave room requested: user=${userId}`);
        this.roomManager.leaveRoom(socket);
        break;

      case 'offer':
      case 'answer':
      case 'candidate':
        console.log(`🔁 Forwarding ${type} from ${userId} → ${targetUserId}`);

        // 2. Find the target's live socket connection
        const targetSocket = roomConnections[targetUserId];

        if (targetSocket && targetSocket.readyState === 1) { // 1 = OPEN
          targetSocket.send(
            JSON.stringify({ 
              type, 
              fromUserId: userId, 
              ...payload 
            })
          );
        } else {
          console.warn(`⚠️ Target user ${targetUserId} not active in room ${roomId}`);
          socket.send(JSON.stringify({ type: 'error', message: 'Target user not found or offline' }));
        }
        break;

      default:
        console.warn('⚠️ Unknown message type:', type);
        socket.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
    }
  }
}

module.exports = MessageRouter;