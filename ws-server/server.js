const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url} from ${req.ip}`);
  next();
});

// CORS configuration
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: false,
  maxAge: 86400
}));

// Body parser with size limit
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

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

// Simplified WebSocket server without origin validation
const wss = new WebSocket.Server({ server });

// Remove origin-specific headers
wss.on('headers', (headers) => {
  headers.push('Access-Control-Allow-Credentials: true');
});

let latestJson = null;

// WebSocket server configuration
const PING_INTERVAL = 30000; // 30 seconds
const MAX_PAYLOAD_SIZE = 100 * 1024; // 100KB

// WebSocket event handlers with improved validation
wss.on('error', (error) => {
  console.error('WebSocket server error:', error);
});

// Set up ping-pong for connection health
wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`Client connected from ${clientIp} (Origin: ${req.headers.origin})`);
  
  let isAlive = true;
  
  const pingInterval = setInterval(() => {
    if (!isAlive) {
      console.log(`Terminating dead connection from ${clientIp}`);
      return ws.terminate();
    }
    
    isAlive = false;
    try {
      ws.ping(() => {});
    } catch (error) {
      console.error('Ping failed:', error);
    }
  }, PING_INTERVAL);

  ws.on('pong', () => {
    isAlive = true;
  });

  // Clean up on connection close
  ws.on('close', () => {
    clearInterval(pingInterval);
    console.log(`Client ${clientIp} disconnected`);
  });

  // Handle WebSocket errors
  ws.on('error', (error) => {
    console.error(`WebSocket error from ${clientIp}:`, error);
    ws.terminate();
  });

  // Send latest data to new client with versioning
  if (latestJson) {
    ws.send(JSON.stringify({
      ...latestJson,
      _meta: { timestamp: new Date().toISOString() }
    }));
  }

  // Handle incoming messages
  ws.on('message', (data) => {
    try {
      const message = data.toString();
      console.log(`Received message (${message.length} bytes) from ${clientIp}`);
      
      // Validate message size
      if (message.length > MAX_PAYLOAD_SIZE) {
        throw new Error(`Message exceeds maximum size of ${MAX_PAYLOAD_SIZE} bytes`);
      }

      // Validate and parse JSON
      const jsonData = JSON.parse(message);
      if (typeof jsonData !== 'object' || jsonData === null) {
        throw new Error('Invalid JSON structure');
      }
      
      // Update latest JSON with timestamp
      latestJson = {
        ...jsonData,
        _meta: { 
          ...jsonData._meta,
          receivedAt: new Date().toISOString() 
        }
      };

      // Broadcast with error handling
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(JSON.stringify(latestJson));
          } catch (error) {
            console.error('Broadcast failed:', error);
            client.terminate();
          }
        }
      });
    } catch (error) {
      console.error('Message processing error:', error);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ 
          error: 'Invalid message format',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        }));
      }
    }
  });

  ws.on('close', () => {
    console.log(`Client ${clientIp} disconnected`);
  });
});

// Update status endpoint to remove origin checks
app.get('/status', (req, res) => {
  const response = {
    status: 'ok',
    connections: wss.clients.size,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    latestJson
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
  console.log('Environment:', process.env.NODE_ENV || 'development');
  console.log('Press Ctrl+C to stop');
}).on('error', (error) => {
  console.error('Server startup error:', error);
  process.exit(1);
});

// Process error handling with exit codes
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
});
