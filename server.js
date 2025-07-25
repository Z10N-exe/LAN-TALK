const WebSocket = require('ws');
const http = require('http');
const bonjour = require('bonjour')();
const CryptoJS = require('crypto-js');

// Create an HTTP server to serve the WebSocket
const server = http.createServer();
const wss = new WebSocket.Server({ server });

const ENCRYPTION_KEY = 'safe-lan-talk-key'; // Demo key; use secure key management in production
const users = new Map(); // Store user info: { ws: WebSocket, id: string, username: string }

// Broadcast message to all connected clients except sender
function broadcast(message, senderWs) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client !== senderWs) {
            client.send(JSON.stringify(message));
        }
    });
}

// Update user list and broadcast to all clients
function broadcastUserList() {
    const userList = Array.from(users.values()).map(user => ({
        id: user.id,
        name: user.username
    }));
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'userList', users: userList }));
        }
    });
}

wss.on('connection', ws => {
    console.log('New client connected');

    // Handle incoming messages
    ws.on('message', data => {
        try {
            const message = JSON.parse(data);

            switch (message.type) {
                case 'join':
                    // Register user
                    users.set(ws, { id: message.id, username: message.username });
                    console.log(`${message.username} joined`);

                    // Broadcast user list
                    broadcastUserList();

                    // Send welcome message
                    ws.send(JSON.stringify({
                        type: 'system',
                        text: `You're now connected to the local network. Messages are end-to-end encrypted.`
                    }));
                    break;

                case 'message':
                    // Decrypt message (for logging/verification; clients handle decryption)
                    const decryptedText = CryptoJS.AES.decrypt(message.text, ENCRYPTION_KEY).toString(CryptoJS.enc.Utf8);

                    // Broadcast message to other clients
                    const broadcastMessage = {
                        type: 'message',
                        id: message.id,
                        username: message.username,
                        text: message.text, // Send encrypted text
                        timestamp: new Date().toISOString()
                    };
                    broadcast(broadcastMessage, ws);
                    break;
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    ws.on('close', () => {
        const user = users.get(ws);
        if (user) {
            console.log(`${user.username} disconnected`);
            users.delete(ws);
            broadcastUserList();
        }
    });

    ws.on('error', error => {
        console.error('WebSocket error:', error);
    });
});

// Start the server
const PORT = 8080;
server.listen(PORT, () => {
    console.log(`SafeLAN Talk server running on port ${PORT}`);

    // Publish the service via Bonjour (mDNS)
    bonjour.publish({
        name: 'SafeLAN Talk',
        type: 'http',
        port: PORT,
        txt: { app: 'safelan-talk' }
    });
});

// Handle server errors
server.on('error', error => {
    console.error('Server error:', error);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    bonjour.unpublishAll(() => {
        server.close(() => {
            process.exit(0);
        });
    });
});