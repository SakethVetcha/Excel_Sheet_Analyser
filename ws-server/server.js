const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', function connection(ws) {
  console.log('Client connected');
  
  ws.on('message', function incoming(data, isBinary) {
    // Convert Buffer to string for non-binary messages
    const message = isBinary ? data : data.toString();
    console.log('Received:', message);

    // Broadcast to all other clients
    wss.clients.forEach(function each(client) {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });
});

console.log('WebSocket server running on ws://localhost:8080');
