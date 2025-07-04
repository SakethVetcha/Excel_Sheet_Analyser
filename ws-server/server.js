const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'latestData.json');

// Async error handling wrapper for Express routes
const asyncHandler = fn => (req, res, next) => {
  return Promise.resolve(fn(req, res, next)).catch(next);
};

const app = express();

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url} from ${req.ip}`);
  next();
});

// CORS configuration
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS']
}));

// Body parser with size limit
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Proxy trust
app.enable('trust proxy');

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Express error:', err.message, '\nStack:', err.stack, '\nFrom origin:', req.headers.origin);
  const statusCode = err.statusCode || 500;
  const response = {
    error: 'Internal server error',
    timestamp: new Date().toISOString(),
    path: req.path
  };
  if (process.env.NODE_ENV === 'development') {
    response.message = err.message;
    response.stack = err.stack;
  }
  if (err.name === 'ValidationError') {
    response.error = 'Validation Error';
    response.details = err.details || err.message;
  } else if (err.name === 'UnauthorizedError') {
    response.error = 'Unauthorized';
    response.message = 'Invalid or missing authentication';
  }
  res.status(statusCode).json(response);
});

const server = http.createServer(app);

// ========== DATA PERSISTENCE LOGIC ==========

let latestJson = null;

// Load latest JSON from file at startup
try {
  if (fs.existsSync(DATA_FILE)) {
    const fileData = fs.readFileSync(DATA_FILE, 'utf8');
    latestJson = JSON.parse(fileData);
    console.log('Loaded latest JSON from file.');
  }
} catch (err) {
  console.error('Error loading data from file:', err);
}

function saveLatestJsonToFile(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    console.log('Saved latest JSON to file.');
  } catch (err) {
    console.error('Error saving data to file:', err);
  }
}

// ========== WEBSOCKET SERVER ==========

const wss = new WebSocket.Server({ 
  server,
  verifyClient: (info, done) => {
    done(true); // Allow all origins for now
  }
});

const PING_INTERVAL = 30000; // 30 seconds
const MAX_PAYLOAD_SIZE = 100 * 1024; // 100KB

wss.on('error', (error) => {
  console.error('WebSocket server error:', error);
});

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

  ws.on('close', () => {
    clearInterval(pingInterval);
    console.log(`Client ${clientIp} disconnected`);
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error from ${clientIp}:`, error);
    ws.terminate();
  });

  // Send latest data to new client
  if (latestJson) {
    ws.send(JSON.stringify({
      ...latestJson,
      _meta: { timestamp: new Date().toISOString() }
    }));
  }

  ws.on('message', (data) => {
    try {
      const message = data.toString();
      console.log(`Received message (${message.length} bytes) from ${clientIp}`);
      if (message.length > MAX_PAYLOAD_SIZE) {
        throw new Error(`Message exceeds maximum size of ${MAX_PAYLOAD_SIZE} bytes`);
      }
      const jsonData = JSON.parse(message);
      if (typeof jsonData !== 'object' || jsonData === null) {
        throw new Error('Invalid JSON structure');
      }
      // Update and persist
      latestJson = {
        ...jsonData,
        _meta: { 
          ...jsonData._meta,
          receivedAt: new Date().toISOString() 
        }
      };
      saveLatestJsonToFile(latestJson);

      // Broadcast to all clients
      const broadcastData = JSON.parse(JSON.stringify(latestJson));
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          setTimeout(() => {
            try {
              client.send(JSON.stringify(broadcastData));
            } catch (error) {
              console.error('Broadcast send failed:', error);
              if (client.readyState === WebSocket.OPEN) {
                client.terminate();
              }
            }
          }, 0);
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
});

// ========== EXPRESS ROUTES ==========

const handleErrors = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (error) {
    console.error('Route error:', error);
    next(error);
  }
};

app.get('/status', handleErrors(async (req, res) => {
  try {
    const status = {
      status: 'ok',
      connections: wss?.clients?.size || 0,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      latestJson: latestJson ? JSON.parse(JSON.stringify(latestJson)) : null
    };
    res.json(status);
  } catch (error) {
    console.error('Status endpoint error:', error);
    throw error;
  }
}));

app.get('/health', handleErrors(async (req, res) => {
  try {
    const health = {
      status: 'ok',
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
    res.json(health);
  } catch (error) {
    console.error('Health check error:', error);
    throw error;
  }
}));

// ========== SERVER STARTUP ==========

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Environment:', process.env.NODE_ENV || 'development');
  console.log('Press Ctrl+C to stop');
}).on('error', (error) => {
  console.error('Server startup error:', error);
  process.exit(1);
});

// ========== PROCESS ERROR HANDLING ==========

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
});
