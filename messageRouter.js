class MessageRouter {
  constructor(db, roomManager) {
    this.db = db;
    this.roomManager = roomManager;
  }

  handleMessage(socket, message) {
    const { type, roomId, targetUserId, ...payload } = message;
    const userId = socket.userId;

    const roomConnections = this.roomManager.activeConnections[roomId];

    if (!roomConnections || !roomConnections[userId]) {
      console.warn(`⚠️ Security Block: User ${userId} is not authorized for Room ${roomId}`);
      return; 
    }

    switch (type) {
      case 'updateVoiceStatus':
        if (payload.updates) {
          // CLEANUP: isSpeaking server-il store cheyyenda, 
          // pakshe isMicActive undengil athu mathram filter cheyyanam.
          const cleanUpdates = {};
          if (payload.updates.hasOwnProperty('isMicActive')) {
            cleanUpdates.isMicActive = payload.updates.isMicActive;
          }
          if (payload.updates.hasOwnProperty('isSpeaking')) {
            cleanUpdates.isSpeaking = payload.updates.isSpeaking;
          }

          // Pass only the necessary updates to RoomManager
          this.roomManager.updateVoiceStatus(roomId, userId, cleanUpdates);
        }
        break;

      case 'leave':
        this.roomManager.leaveRoom(socket);
        break;

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
          // Peer unreachable error
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