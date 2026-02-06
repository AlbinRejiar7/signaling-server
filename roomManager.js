class RoomManager {
  constructor(db) {
    this.db = db;
    this.MAX_USERS_PER_ROOM = 8;
    this.activeConnections = {}; // { roomId: { userId: socket } }
  }

  async joinRoom(socket, roomId, userData) {
    const userId = socket.userId;

    if (!roomId) {
      socket.send(JSON.stringify({ type: 'error', message: 'Room ID required' }));
      return;
    }

    try {
      const roomRef = this.db.ref(`rooms/${roomId}`);
      let roomSnapshot = await roomRef.once('value');

      // 1. If room doesn't exist, create it with your NEW model fields
      if (!roomSnapshot.exists()) {
        console.log(`✨ Room ${roomId} not found. Creating with new model...`);
        await roomRef.set({
          id: roomId,
          actedBy: userData.name || "Unknown",
          isPlaying: true,
          lastAction: "play",
          position: 0,
          roomStatus: "active",
          updatedAt: Date.now(),
          participants: {} 
        });
        roomSnapshot = await roomRef.once('value');
      }

      // 2. Initialize memory tracking
      if (!this.activeConnections[roomId]) {
        this.activeConnections[roomId] = {};
      }
      const roomConnections = this.activeConnections[roomId];

      // 3. Capacity check using the nested participants object
      const participantsData = roomSnapshot.val().participants || {};
      const participantCount = Object.keys(participantsData).length;

      if (participantCount >= this.MAX_USERS_PER_ROOM) {
        socket.send(JSON.stringify({ type: 'error', message: 'Room is full' }));
        return;
      }

      // 4. Update memory AND Firebase with the detailed participant model
      roomConnections[userId] = socket;

      await roomRef.child(`participants/${userId}`).set({
        id: userId,
        name: userData.name || "Guest",
        isHost: userData.isHost || false,
        isVideoLoaded: true,
        lastStatusUpdate: Date.now(),
        roommateStatus: "watching"
      });

      // Update room-level timestamp
      await roomRef.update({ updatedAt: Date.now() });

      console.log(`✅ User ${userData.name} linked to Room ${roomId}`);

      // 5. Broadcast arrival to others
      this.broadcastToRoom(roomId, { type: 'userJoined', userId }, userId);

      // 6. Send the list of ALL active signaling IDs back to the joiner
      socket.send(JSON.stringify({
        type: 'roomJoined',
        roomId,
        users: Object.keys(roomConnections),
      }));

    } catch (error) {
      console.error("❌ Firebase Error:", error);
      socket.send(JSON.stringify({ type: 'error', message: 'Database error' }));
    }
  }

  async leaveRoom(socket) {
    const userId = socket.userId;

    for (const roomId in this.activeConnections) {
      const roomConnections = this.activeConnections[roomId];

      if (roomConnections[userId]) {
        // Remove from memory
        delete roomConnections[userId];
        
        // Remove from Firebase participants
        await this.db.ref(`rooms/${roomId}/participants/${userId}`).remove();

        console.log(`👋 User ${userId} left room ${roomId}`);
        this.broadcastToRoom(roomId, { type: 'userLeft', userId });

        // If the room is now empty, delete the whole room object
        if (Object.keys(roomConnections).length === 0) {
          console.log(`🗑️ Room ${roomId} empty. Deleting...`);
          await this.db.ref(`rooms/${roomId}`).remove();
          delete this.activeConnections[roomId];
        } else {
          // Update timestamp for remaining users
          await this.db.ref(`rooms/${roomId}`).update({ updatedAt: Date.now() });
        }
        break;
      }
    }
  }

  handleDisconnect(socket) {
    this.leaveRoom(socket);
  }

  broadcastToRoom(roomId, message, excludeUserId = null) {
    const roomConnections = this.activeConnections[roomId];
    if (!roomConnections) return;

    for (const [userId, userSocket] of Object.entries(roomConnections)) {
      if (userId !== excludeUserId && userSocket.readyState === 1) {
        userSocket.send(JSON.stringify(message));
      }
    }
  }
}

module.exports = RoomManager;