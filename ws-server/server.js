const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();

// Add CORS middleware
app.use(cors({
  origin: '*', // Be more specific in production
  methods: ['GET', 'POST'],
  credentials: true
}));

// Add error handling middleware
app.use((err, req, res, next) => {
  console.error('Express error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = http.createServer(app);

// WebSocket server with error handling
const wss = new WebSocket.Server({ 
  server,
  // Add WebSocket specific CORS handling
  verifyClient: (info) => {
    // Allow all origins in development
    // In production, validate origin
    return true;
  }
});

let latestJson = null;

// Handle WebSocket server errors
wss.on('error', (error) => {
  console.error('WebSocket server error:', error);
});

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`Client connected from ${clientIp}`);

  // Add connection error handling
  ws.on('error', (error) => {
    console.error(`WebSocket error from ${clientIp}:`, error);
  });

  ws.on('message', (data, isBinary) => {
    try {
      const message = isBinary ? data : data.toString();
      console.log('Received:', message);
      
      latestJson = JSON.parse(message);

      // Broadcast to all clients except sender
      wss.clients.forEach(client => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          try {
            client.send(message);
          } catch (error) {
            console.error('Broadcast error:', error);
          }
        }
      });
    } catch (error) {
      console.error('Message processing error:', error);
      ws.send(JSON.stringify({ error: 'Invalid message format' }));
    }
  });

  ws.on('close', () => {
    console.log(`Client ${clientIp} disconnected`);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT} and ws://localhost:${PORT}`);
}).on('error', (error) => {
  console.error('Server startup error:', error);
});

// Handle process errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
});
