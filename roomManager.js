class RoomManager {
  constructor(db) {
    this.db = db;
    this.activeConnections = {}; 
    // New: Store user metadata in RAM for fast access
    this.userMetadata = {}; 
  }

async joinRoom(socket, roomId, userData) {
    const userId = socket.userId;
    if (!roomId) return;
    socket.currentRoomId = roomId; 

    try {
      if (!this.activeConnections[roomId]) this.activeConnections[roomId] = {};
      if (!this.userMetadata[roomId]) this.userMetadata[roomId] = {};

      this.activeConnections[roomId][userId] = socket;
      
      // MODIFIED: Only userId and isMicActive
      const minimalUserData = {
        userId: userId,
        isMicActive: true
      };
      
      // RAM-ilum Firebase-ilum ippo ithu mathrame pogo
      this.userMetadata[roomId][userId] = minimalUserData;

      // 1. PERSISTENT: Firebase-lekkum minimal data mathram vidunnu
      await this.db.ref(`rooms/${roomId}/voice_call/${userId}`).set(minimalUserData);

      // 2. NOTIFY OTHERS: Baakkiyullavarkkum minimal data ayakkunnu
      this.broadcastToRoom(roomId, { 
        type: 'userJoined', 
        ...minimalUserData 
      }, userId);

      // 3. SEND CURRENT USER LIST BACK
      socket.send(JSON.stringify({
        type: 'roomJoined',
        roomId,
        users: Object.values(this.userMetadata[roomId]), // [{userId, isMicActive}, ...]
      }));

    } catch (error) {
      console.error("❌ Join Error:", error);
    }
  }

  async updateVoiceStatus(roomId, userId, updates) {
    try {
      if (updates.hasOwnProperty('isMicActive')) {
        await this.db.ref(`rooms/${roomId}/voice_call/${userId}`).update({
          isMicActive: updates.isMicActive
        });
        // Update local memory too
        if (this.userMetadata[roomId]?.[userId]) {
          this.userMetadata[roomId][userId].isMicActive = updates.isMicActive;
        }
      }

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
      
      // Cleanup Metadata memory
      if (this.userMetadata[roomId]) {
        delete this.userMetadata[roomId][userId];
      }
      
      await this.db.ref(`rooms/${roomId}/voice_call/${userId}`).remove();
      this.broadcastToRoom(roomId, { type: 'userLeft', userId });
      
      if (Object.keys(this.activeConnections[roomId]).length === 0) {
        delete this.activeConnections[roomId];
        delete this.userMetadata[roomId];
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