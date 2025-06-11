const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let latestJson = null; // Stores the most recent JSON

// HTTP route to display latest JSON
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (latestJson) {
    res.send(JSON.stringify(latestJson, null, 2)); // Pretty-print JSON
  } else {
    res.status(404).json({ error: "No data received yet" });
  }
});

// WebSocket server logic
wss.on('connection', (ws) => {
  console.log('Client connected');

  ws.on('message', (data, isBinary) => {
    const message = isBinary ? data : data.toString();
    console.log('Received:', message);
    
    try {
      latestJson = JSON.parse(message); // Update latest JSON
    } catch (e) {
      latestJson = { raw: message }; // Fallback if invalid JSON
    }

    // Broadcast to all clients except sender
    wss.clients.forEach(client => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT} and ws://localhost:${PORT}`);
});
