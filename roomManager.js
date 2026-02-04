class RoomManager {
  constructor(db) {
    this.db = db; 
    this.MAX_USERS_PER_ROOM = 8;
    this.activeConnections = {}; // { roomId: { userId: socket } }
  }

  async joinRoom(socket, roomId) {
    const userId = socket.userId;

    if (!roomId) {
      socket.send(JSON.stringify({ type: 'error', message: 'Room ID required' }));
      return;
    }

    try {
      const roomRef = this.db.ref(`rooms/${roomId}`);
      let roomSnapshot = await roomRef.once('value');
      
      // 1. If room doesn't exist, create it with necessary fields
      if (!roomSnapshot.exists()) {
        console.log(`✨ Room ${roomId} not found. Creating it now...`);
        await roomRef.set({
          status: "active",
          createdAt: Date.now(),
          participants: {} // Initialize empty participants object
        });
        // Re-fetch snapshot after creation to proceed normally
        roomSnapshot = await roomRef.once('value');
      }

      // 2. Initialize the memory tracking for this room
      if (!this.activeConnections[roomId]) {
        this.activeConnections[roomId] = {};
      }

      const roomConnections = this.activeConnections[roomId];

      // 3. Check capacity using Firebase participants
      const participantsData = roomSnapshot.val().participants || {};
      const participantCount = Object.keys(participantsData).length;

      if (participantCount >= this.MAX_USERS_PER_ROOM) {
        socket.send(JSON.stringify({ type: 'error', message: 'Room is full' }));
        return;
      }

      // 4. Map the socket in memory AND update Firebase status
      roomConnections[userId] = socket;
      
      // We update Firebase so other users know this user is officially "in"
      await roomRef.child(`participants/${userId}`).set({
        isOnline: true,
        joinedAt: Date.now()
      });

      console.log(`✅ User ${userId} linked to Room ${roomId}`);

      // 5. Tell others in the room a new user is ready for audio
      this.broadcastToRoom(roomId, { type: 'userJoined', userId }, userId);

      // 6. Send current active audio users back to the joined user
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

leaveRoom(socket) {
    const userId = socket.userId;

    for (const roomId in this.activeConnections) {
      const roomConnections = this.activeConnections[roomId];

      if (roomConnections[userId]) {
  
        delete roomConnections[userId];
        this.db.ref(`rooms/${roomId}/participants/${userId}`).remove();

        console.log(`👋 User ${userId} stopped signaling for room ${roomId}`);
        
        
        this.broadcastToRoom(roomId, { type: 'userLeft', userId });

        if (Object.keys(roomConnections).length === 0) {
          console.log(`🗑️ Room ${roomId} is empty. Deleting from Firebase...`);
          
     
          this.db.ref(`rooms/${roomId}`).remove(); 
          
          // Clear it from server memory
          delete this.activeConnections[roomId];
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