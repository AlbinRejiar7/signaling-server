class RoomManager {
  constructor(db) {
    this.db = db;
    this.activeConnections = {}; 
  }

  async joinRoom(socket, roomId, userData) {
    const userId = socket.userId;
    if (!roomId) return;
    socket.currentRoomId = roomId; 

    try {
      if (!this.activeConnections[roomId]) this.activeConnections[roomId] = {};
      this.activeConnections[roomId][userId] = socket;

      // 1. PERSISTENT: Save basic join info to Firebase
      await this.db.ref(`rooms/${roomId}/voice_call/${userId}`).set({
        userId: userId,
        name: userData.name || "User",
        isMicActive: true,      
        joinedAt: Date.now()
      });

      // 2. NOTIFY: Tell others and send current user list back to joiner
      this.broadcastToRoom(roomId, { type: 'userJoined', userId }, userId);
      socket.send(JSON.stringify({
        type: 'roomJoined',
        roomId,
        users: Object.keys(this.activeConnections[roomId]),
      }));
    } catch (error) {
      console.error("❌ Join Error:", error);
    }
  }

  /**
   * HANDLES VOICE UPDATES
   * Logic: Ephemeral (Speaking) vs Persistent (Mic Status)
   */
  async updateVoiceStatus(roomId, userId, updates) {
    try {
      // PERSISTENT: Only write to Firebase if Mic state changes (Low frequency)
      if (updates.hasOwnProperty('isMicActive')) {
        await this.db.ref(`rooms/${roomId}/voice_call/${userId}`).update({
          isMicActive: updates.isMicActive
        });
      }

      // EPHEMERAL: Always broadcast via WebSocket for the UI pulsating effect
      // This is high frequency but FREE because it stays in RAM.
      this.broadcastToRoom(roomId, { 
        type: 'voiceStatusUpdate', 
        userId, 
        ...updates 
      }, userId);

    } catch (e) {
      console.warn("⚠️ Status Update failed:", e.message);
    }
  }

  async leaveRoom(socket) {
    const userId = socket.userId;
    const roomId = socket.currentRoomId;

    if (roomId && this.activeConnections[roomId]?.[userId]) {
      delete this.activeConnections[roomId][userId];
      
      // Cleanup Firebase
      await this.db.ref(`rooms/${roomId}/voice_call/${userId}`).remove();
      
      this.broadcastToRoom(roomId, { type: 'userLeft', userId });
      
      if (Object.keys(this.activeConnections[roomId]).length === 0) {
        delete this.activeConnections[roomId];
      }
    }
  }

  broadcastToRoom(roomId, message, excludeUserId = null) {
    const roomConnections = this.activeConnections[roomId];
    if (!roomConnections) return;
    const payload = JSON.stringify(message);
    for (const [userId, userSocket] of Object.entries(roomConnections)) {
      if (userId !== excludeUserId && userSocket.readyState === 1) {
        userSocket.send(payload);
      }
    }
  }
}

module.exports = RoomManager;