const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

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

// CORS configuration - simplified without credentials
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS']
}));

// Body parser with size limit
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Improved proxy trust configuration
app.enable('trust proxy');

// Enhanced error handling with origin logging
app.use((err, req, res, next) => {
  console.error('Express error:', err.message, '\nStack:', err.stack, '\nFrom origin:', req.headers.origin);
  
  // Handle different types of errors
  const statusCode = err.statusCode || 500;
  const response = {
    error: 'Internal server error',
    timestamp: new Date().toISOString(),
    path: req.path
  };

  // Add error details in development
  if (process.env.NODE_ENV === 'development') {
    response.message = err.message;
    response.stack = err.stack;
  }

  // Handle specific error types
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

// WebSocket server with origin validation
const wss = new WebSocket.Server({ 
  server,
  verifyClient: (info, done) => {
    // Allow all origins for now, but you can add validation here
    // Example: if (info.origin !== 'https://your-allowed-origin.com') return done(false, 403, 'Origin not allowed');
    done(true);
  }
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

      // Create a deep clone of the data to prevent race conditions
      const broadcastData = JSON.parse(JSON.stringify(latestJson));
      
      // Broadcast with error handling
      const clients = Array.from(wss.clients);
      clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          try {
            // Use setTimeout to prevent blocking the event loop
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
          } catch (error) {
            console.error('Broadcast setup failed:', error);
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

// Error handling wrapper for async routes
const handleErrors = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (error) {
    console.error('Route error:', error);
    next(error);
  }
};

// Update status endpoint with error handling
app.get('/status', handleErrors(async (req, res) => {
  try {
    const status = {
      status: 'ok',
      connections: wss?.clients?.size || 0,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      // Clone to prevent reference issues
      latestJson: latestJson ? JSON.parse(JSON.stringify(latestJson)) : null
    };
    res.json(status);
  } catch (error) {
    console.error('Status endpoint error:', error);
    throw error; // Will be caught by handleErrors
  }
}));

// Health check endpoint with system info
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
    throw error; // Will be caught by handleErrors
  }
}));

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