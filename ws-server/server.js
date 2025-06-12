const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();

// Configuration
const allowedOrigins = [
  'http://localhost:3000',        // Local development
  'hhttps://excel-sheet-analyser-1.onrender.com', // Production frontend
  'https://sakethvetcha-analyser-python-json-convertor-u1j0sm.streamlit.app/'
];

// CORS middleware
app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST'],
  credentials: true
}));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Express error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = http.createServer(app);

// WebSocket server configuration
const wss = new WebSocket.Server({
  server,
  verifyClient: (info) => {
    const origin = info.origin;
    return allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production';
  }
});

let latestJson = null;

// WebSocket event handlers
wss.on('error', (error) => {
  console.error('WebSocket server error:', error);
});

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`Client connected from ${clientIp}`);

  // Send latest data to new client
  if (latestJson) {
    ws.send(JSON.stringify(latestJson));
  }

  ws.on('error', (error) => {
    console.error(`WebSocket error from ${clientIp}:`, error);
  });

  ws.on('message', (data) => {
    try {
      const message = data.toString();
      console.log('Received:', message);
      
      // Validate and parse JSON
      const jsonData = JSON.parse(message);
      if (typeof jsonData !== 'object' || jsonData === null) {
        throw new Error('Invalid JSON structure');
      }
      
      latestJson = jsonData;

      // Broadcast to all clients except sender
      wss.clients.forEach(client => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(jsonData));
        }
      });
    } catch (error) {
      console.error('Message processing error:', error);
      ws.send(JSON.stringify({ 
        error: 'Invalid message format',
        details: error.message 
      }));
    }
  });

  ws.on('close', () => {
    console.log(`Client ${clientIp} disconnected`);
  });
});

// Status endpoint (defined after WebSocket server creation)
app.get('/status', (req, res) => {
  res.json({
    status: 'ok',
    connections: wss.clients.size,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    latestJson  // Now includes the latest data
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).end();
});

// Server startup
const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
}).on('error', (error) => {
  console.error('Server startup error:', error);
});

// Process error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
});
