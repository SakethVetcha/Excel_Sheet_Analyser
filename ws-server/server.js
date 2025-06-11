const WebSocket = require('ws');
const PORT = process.env.PORT || 8080;

const wss = new WebSocket.Server({ port: PORT });

wss.on('connection', function connection(ws, req) {
  console.log(`Client connected from ${req.socket.remoteAddress}`);
  
  ws.on('message', function incoming(data, isBinary) {
    const message = isBinary ? data : data.toString();
    console.log('Received:', message);

    // Broadcast to all clients
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });

  ws.on('close', () => console.log('Client disconnected'));
  ws.on('error', (error) => console.error('WebSocket error:', error));
});

console.log(`WebSocket server running on ws://0.0.0.0:${PORT}`);
