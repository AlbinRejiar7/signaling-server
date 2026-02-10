const WebSocket = require('ws');

const SERVER_URL = 'wss://signaling-server-9rpb.onrender.com';
const ROOM_ID = 'test-room-101';
const USER_COUNT = 8;

console.log(`🚀 Starting Stress Test with ${USER_COUNT} users...`);

for (let i = 1; i <= USER_COUNT; i++) {
    const userId = `user_00${i}`;
    const ws = new WebSocket(SERVER_URL);

    ws.on('open', () => {
        console.log(`✅ ${userId} connected`);

        // 1. Join Room
        ws.send(JSON.stringify({
            type: 'join',
            roomId: ROOM_ID,
            userId: userId,
            name: `User ${i}`
        }));

        // 2. Simulate Speaking (Every 2 seconds)
        setInterval(() => {
            const isSpeaking = Math.random() > 0.5; // Randomly speak/stop
            ws.send(JSON.stringify({
                type: 'updateVoiceStatus',
                updates: {
                    isSpeaking: isSpeaking,
                    isMicActive: true
                }
            }));
            // console.log(`🎙️ ${userId} isSpeaking: ${isSpeaking}`);
        }, 2000);
    });

    ws.on('message', (data) => {
        const msg = JSON.parse(data);
        // Server-il ninnu thirichu varunna logs ivide kaanam
        if (msg.type === 'voiceStatusUpdate') {
            console.log(`📡 Broadcast received: ${msg.userId} is ${msg.isSpeaking ? 'Speaking' : 'Silent'}`);
        }
    });

    ws.on('close', () => console.log(`❌ ${userId} disconnected`));
}
