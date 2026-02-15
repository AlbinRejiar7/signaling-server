class RoomManager {
  constructor(db) {
    this.db = db;
    this.activeConnections = {};
    this.userMetadata = {};
  }

  safeSend(socket, payload) {
    if (!socket || socket.readyState !== 1) return;
    try {
      socket.send(JSON.stringify(payload));
    } catch (error) {
      console.warn('⚠️ Failed to send socket payload:', error.message);
    }
  }

  async joinRoom(socket, roomId, userData) {
    const userId = socket.userId;
    if (!roomId) return;
    socket.currentRoomId = roomId;

    try {
      if (!this.activeConnections[roomId]) this.activeConnections[roomId] = {};
      if (!this.userMetadata[roomId]) this.userMetadata[roomId] = {};

      const minimalUserData = {
        userId: userId,
        isMicActive: typeof userData?.isMicActive === 'boolean' ? userData.isMicActive : true
      };

      await this.db.ref(`rooms/${roomId}/voice_call/${userId}`).set(minimalUserData);

      this.activeConnections[roomId][userId] = socket;
      this.userMetadata[roomId][userId] = minimalUserData;

      this.broadcastToRoom(roomId, {
        type: 'userJoined',
        ...minimalUserData 
      }, userId);

      this.safeSend(socket, {
        type: 'roomJoined',
        roomId,
        users: Object.values(this.userMetadata[roomId]),
      });
    } catch (error) {
      console.error('❌ Join Error:', error.message);
      this.safeSend(socket, { type: 'error', message: 'Failed to join room' });
      if (this.activeConnections[roomId]) {
        delete this.activeConnections[roomId][userId];
      }
      if (this.userMetadata[roomId]) {
        delete this.userMetadata[roomId][userId];
      }
    }
  }

  async updateVoiceStatus(roomId, userId, updates) {
    try {
      const cleanUpdates = {};

      if (typeof updates?.isMicActive === 'boolean') {
        cleanUpdates.isMicActive = updates.isMicActive;
      }

      if (typeof updates?.isSpeaking === 'boolean') {
        cleanUpdates.isSpeaking = updates.isSpeaking;
      }

      if (Object.keys(cleanUpdates).length === 0) return;

      if (cleanUpdates.hasOwnProperty('isMicActive')) {
        await this.db.ref(`rooms/${roomId}/voice_call/${userId}`).update({
          isMicActive: cleanUpdates.isMicActive
        });
        if (this.userMetadata[roomId]?.[userId]) {
          this.userMetadata[roomId][userId].isMicActive = cleanUpdates.isMicActive;
        }
      }

      this.broadcastToRoom(roomId, {
        type: 'voiceStatusUpdate',
        userId,
        ...cleanUpdates
      }, userId);
    } catch (e) {
      console.warn('⚠️ Status Update failed:', e.message);
    }
  }

  async leaveRoom(socket) {
    const userId = socket.userId;
    const roomId = socket.currentRoomId;

    if (!roomId || !userId) return;
    if (!this.activeConnections[roomId]?.[userId]) return;

    delete this.activeConnections[roomId][userId];

    if (this.userMetadata[roomId]) {
      delete this.userMetadata[roomId][userId];
    }

    try {
      await this.db.ref(`rooms/${roomId}/voice_call/${userId}`).remove();
    } catch (error) {
      console.warn('⚠️ Firebase cleanup failed:', error.message);
    }

    this.broadcastToRoom(roomId, { type: 'userLeft', userId });

    if (Object.keys(this.activeConnections[roomId] || {}).length === 0) {
      delete this.activeConnections[roomId];
      if (this.userMetadata[roomId]) {
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
        try {
          userSocket.send(payload);
        } catch (error) {
          console.warn('⚠️ Broadcast failed:', error.message);
        }
      }
    }
  }
}

module.exports = RoomManager;
