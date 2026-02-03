class RoomManager {
  constructor(rooms) {
    this.rooms = rooms;
    this.MAX_USERS_PER_ROOM = 8;
  }

  joinRoom(socket, roomId) {
    const userId = socket.userId;

    if (!roomId) {
      socket.send(JSON.stringify({ type: 'error', message: 'Room ID required' }));
      return;
    }

    if (!this.rooms[roomId]) {
      console.log(`🆕 Creating room: ${roomId}`);
      this.rooms[roomId] = { users: {} };
    }

    const room = this.rooms[roomId];

    if (room.users[userId]) {
      console.log(`⚠️ User ${userId} already in room ${roomId}`);
      return;
    }

    if (Object.keys(room.users).length >= this.MAX_USERS_PER_ROOM) {
      console.warn(`❌ Room ${roomId} full`);
      socket.send(JSON.stringify({ type: 'error', message: 'Room is full' }));
      return;
    }

    room.users[userId] = socket;
    console.log(`✅ User ${userId} joined room ${roomId}`);

    this.broadcastToRoom(roomId, { type: 'userJoined', userId }, userId);

    socket.send(JSON.stringify({
      type: 'roomJoined',
      roomId,
      users: Object.keys(room.users),
    }));

    this.printRooms();
  }

  leaveRoom(socket) {
    const userId = socket.userId;

    for (const roomId in this.rooms) {
      const room = this.rooms[roomId];

      if (room.users[userId]) {
        delete room.users[userId];
        console.log(`👋 User ${userId} left room ${roomId}`);

        this.broadcastToRoom(roomId, { type: 'userLeft', userId });

        if (Object.keys(room.users).length === 0) {
          console.log(`🧹 Deleting empty room ${roomId}`);
          delete this.rooms[roomId];
        }

        this.printRooms();
        break;
      }
    }
  }

  handleDisconnect(socket) {
    console.log(`🔌 Handling disconnect for ${socket.userId}`);
    this.leaveRoom(socket);
  }

  broadcastToRoom(roomId, message, excludeUserId = null) {
    const room = this.rooms[roomId];
    if (!room) return;

    console.log(`📢 Broadcasting to room ${roomId}:`, message);

    for (const [userId, userSocket] of Object.entries(room.users)) {
      if (userId !== excludeUserId && userSocket.readyState === 1) {
        userSocket.send(JSON.stringify(message));
      }
    }
  }

  printRooms() {
    console.log('📦 Current rooms state:');
    console.dir(this.rooms, { depth: 3 });
  }
}

module.exports = RoomManager;
