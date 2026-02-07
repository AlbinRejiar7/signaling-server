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
      
      // Store metadata (name, image) in server memory
      const fullUserData = {
        userId: userId,
        name: userData.name || "User",
        profileImageUrl: userData.profileImageUrl || "",
        isMicActive: true,      
        joinedAt: Date.now()
      };
      this.userMetadata[roomId][userId] = fullUserData;

      // 1. PERSISTENT: Save join info to Firebase (includes image URL)
      await this.db.ref(`rooms/${roomId}/voice_call/${userId}`).set(fullUserData);

      // 2. NOTIFY OTHERS: Tell them WHO joined (with name and image)
      this.broadcastToRoom(roomId, { 
        type: 'userJoined', 
        ...fullUserData 
      }, userId);

      // 3. SEND CURRENT USER LIST BACK: Send full objects, not just IDs
      socket.send(JSON.stringify({
        type: 'roomJoined',
        roomId,
        users: Object.values(this.userMetadata[roomId]), // Sending [{userId, name, profileImageUrl}, ...]
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