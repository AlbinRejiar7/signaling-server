class MessageRouter {
  constructor(rooms, roomManager) {
    this.rooms = rooms;
    this.roomManager = roomManager;
  }

  routeMessage(socket, message) {
    const { type, roomId, targetUserId, ...payload } = message;
    const userId = socket.userId;

    console.log(`➡️ Routing message type="${type}" from ${userId}`);

    // JOIN must be allowed first
    if (type === 'join') {
      console.log(`🚪 Join request: user=${userId}, room=${roomId}`);
      this.roomManager.joinRoom(socket, roomId);
      return;
    }

    // All other messages require room membership
    if (!this.rooms[roomId] || !this.rooms[roomId].users[userId]) {
      console.warn(`⚠️ User ${userId} tried "${type}" without joining room`);
      socket.send(JSON.stringify({ type: 'error', message: 'Not in room' }));
      return;
    }

    switch (type) {
      case 'leave':
        console.log(`🚪 Leave room: user=${userId}`);
        this.roomManager.leaveRoom(socket);
        break;

      case 'offer':
      case 'answer':
      case 'candidate':
        console.log(`🔁 Forwarding ${type} from ${userId} → ${targetUserId}`);

        if (targetUserId && this.rooms[roomId].users[targetUserId]) {
          const targetSocket = this.rooms[roomId].users[targetUserId];
          targetSocket.send(
            JSON.stringify({ type, fromUserId: userId, ...payload })
          );
        } else {
          console.warn('⚠️ Target user not found:', targetUserId);
          socket.send(JSON.stringify({ type: 'error', message: 'Target user not found' }));
        }
        break;

      default:
        console.warn('⚠️ Unknown message type:', type);
        socket.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
    }
  }
}

module.exports = MessageRouter;
