class MessageRouter {
  constructor(db, roomManager) {
    this.db = db;
    this.roomManager = roomManager;
  }

  handleMessage(socket, message) {
    const { type, roomId, targetUserId, ...payload } = message;
    const userId = socket.userId;

    // 1. Safety Check: Access the active connections in memory for this room
    const roomConnections = this.roomManager.activeConnections[roomId];

    // Verify sender is authorized and exists in the room's memory map
    if (!roomConnections || !roomConnections[userId]) {
      console.warn(`⚠️ Unauthorized: User ${userId} tried "${type}" in room ${roomId}`);
      socket.send(JSON.stringify({ type: 'error', message: 'You are not active in this room' }));
      return;
    }

    switch (type) {
      case 'leave':
        console.log(`🚪 Leave requested: ${userId} from ${roomId}`);
        this.roomManager.leaveRoom(socket);
        break;

      case 'offer':
      case 'answer':
      case 'candidate':
        // 2. Targeted Routing: Use targetUserId to find the specific recipient's socket
        const targetSocket = roomConnections[targetUserId];

        // Forward the WebRTC signal if the target is online (readyState 1 = OPEN)
        if (targetSocket && targetSocket.readyState === 1) {
          console.log(`🔁 Signal: ${type} from ${userId} → ${targetUserId}`);
          targetSocket.send(
            JSON.stringify({ 
              type, 
              fromUserId: userId, 
              ...payload 
            })
          );
        } else {
          // If the target isn't in memory, they likely disconnected or aren't in this room
          console.warn(`⚠️ Route failed: Target ${targetUserId} not found in room ${roomId}`);
          socket.send(JSON.stringify({ 
            type: 'error', 
            message: 'Target user is offline or not in this room' 
          }));
        }
        break;

      default:
        console.warn('⚠️ Unknown message type:', type);
        socket.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
    }
  }
}

module.exports = MessageRouter;