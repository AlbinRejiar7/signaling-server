class MessageRouter {
  constructor(db, roomManager) {
    this.db = db;
    this.roomManager = roomManager;
  }

  handleMessage(socket, message) {
    // Destructure the message. 
    // Note: roomId is now guaranteed correct by the ConnectionHandler.
    const { type, roomId, targetUserId, ...payload } = message;
    const userId = socket.userId;

    // 1. Memory Check: Access the active connections for this specific room
    const roomConnections = this.roomManager.activeConnections[roomId];

    // Security check: Ensure the room exists and the sender is actually in it
    if (!roomConnections || !roomConnections[userId]) {
      console.warn(`⚠️ Security Block: User ${userId} is not authorized for Room ${roomId}`);
      return; 
    }

    switch (type) {
      // Broadcast voice/mic status to everyone else in the room
      case 'updateVoiceStatus':
        if (payload.updates) {
          // Pass to RoomManager for optimized (No-Firebase-Speaking) logic
          this.roomManager.updateVoiceStatus(roomId, userId, payload.updates);
        }
        break;

      case 'leave':
        this.roomManager.leaveRoom(socket);
        break;

      // WebRTC Signaling: Forward message directly to a specific user
      case 'offer':
      case 'answer':
      case 'candidate':
        const targetSocket = roomConnections[targetUserId];

        if (targetSocket && targetSocket.readyState === 1) {
          targetSocket.send(
            JSON.stringify({ 
              type, 
              fromUserId: userId, 
              ...payload 
            })
          );
        } else {
          console.warn(`⚠️ Signal target ${targetUserId} not found in room ${roomId}`);
          socket.send(JSON.stringify({ 
            type: 'error', 
            message: 'Peer is unreachable' 
          }));
        }
        break;

      default:
        console.warn('⚠️ Unknown message type:', type);
    }
  }
}

module.exports = MessageRouter;