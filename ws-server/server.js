const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();

// Configuration - FIXED ORIGINS AND ADDED FLEXIBLE MATCHING
const allowedOrigins = [
  'http://localhost:3000',
  'https://excel-sheet-analyser-1.onrender.com',
  'https://sakethvetcha-analyser-python-json-convertor-u1j0sm.streamlit.app' // Removed trailing slash
];

// Enhanced CORS configuration
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.some(o => origin.startsWith(o))) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST'],
  credentials: true
}));

// Improved proxy trust configuration
app.enable('trust proxy');

// Enhanced error handling with origin logging
app.use((err, req, res, next) => {
  console.error('Express error:', err.message, 'from origin:', req.headers.origin);
  res.status(500).json({ 
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const server = http.createServer(app);

// WebSocket server with better origin validation
const wss = new WebSocket.Server({
  server,
  verifyClient: (info, done) => {
    const origin = info.origin;
    console.log('WebSocket connection attempt from:', origin);
    
    const isAllowed = allowedOrigins.some(allowed => {
      // Flexible matching for subdomains and variations
      return origin?.startsWith(allowed) || 
             origin?.endsWith(allowed.replace(/https?:\/\//, ''));
    });

    if (isAllowed || process.env.NODE_ENV !== 'production') {
      done(true);
    } else {
      console.warn('Rejected WebSocket connection from:', origin);
      done(false, 401, 'Unauthorized');
    }
  }
});

// Enhanced WebSocket headers for CORS
wss.on('headers', (headers) => {
  headers.push(
    'Access-Control-Allow-Origin: https://sakethvetcha-analyser-python-json-convertor-u1j0sm.streamlit.app',
    'Access-Control-Allow-Credentials: true'
  );
});

let latestJson = null;

// WebSocket event handlers with improved validation
wss.on('error', (error) => {
  console.error('WebSocket server error:', error);
});

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`Client connected from ${clientIp} (Origin: ${req.headers.origin})`);

  // Send latest data to new client with versioning
  if (latestJson) {
    ws.send(JSON.stringify({
      ...latestJson,
      _meta: { timestamp: new Date().toISOString() }
    }));
  }

  ws.on('error', (error) => {
    console.error(`WebSocket error from ${clientIp}:`, error);
  });

  ws.on('message', (data) => {
    try {
      const message = data.toString();
      console.log('Received raw message:', message);
      
      // Validate message size
      if (message.length > 100000) { // 100KB limit
        throw new Error('Message exceeds size limit');
      }

      // Validate and parse JSON
      const jsonData = JSON.parse(message);
      if (typeof jsonData !== 'object' || jsonData === null) {
        throw new Error('Invalid JSON structure');
      }
      
      // Update latest JSON with timestamp
      latestJson = {
        ...jsonData,
        _meta: { receivedAt: new Date().toISOString() }
      };

      // Broadcast with error handling
      wss.clients.forEach(client => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          try {
            client.send(JSON.stringify(latestJson));
          } catch (error) {
            console.error('Broadcast failed:', error);
          }
        }
      });
    } catch (error) {
      console.error('Message processing error:', error);
      ws.send(JSON.stringify({ 
        error: 'Invalid message format',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      }));
    }
  });

  ws.on('close', () => {
    console.log(`Client ${clientIp} disconnected`);
  });
});

// Enhanced status endpoint with safe origin handling
app.get('/status', (req, res) => {
  const clientOrigin = req.headers.origin;
  
  // Only include origin in response if it's allowed
  const response = {
    status: 'ok',
    connections: wss.clients.size,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    latestJson,
    ...(allowedOrigins.includes(clientOrigin) && { yourOrigin: clientOrigin })
  };

  res.json(response);
});

// Health check endpoint with system info
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    memoryUsage: process.memoryUsage(),
    uptime: process.uptime()
  });
});

// Server startup with enhanced logging
const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Allowed origins:', allowedOrigins);
}).on('error', (error) => {
  console.error('Server startup error:', error);
});

// Process error handling with exit codes
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
});
