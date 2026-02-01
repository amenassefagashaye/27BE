import { serve } from "https://deno.land/std@0.200.0/http/server.ts";
import { serveDir } from "https://deno.land/std@0.200.0/http/file_server.ts";

// WebSocket connections store
const connections = new Set<WebSocket>();

// In-memory cache for real-time updates
const cache = {
  stockItems: [],
  sales: [],
  transactions: [],
  audit: []
};

// User sessions
const sessions = new Map();

interface WebSocketMessage {
  type: string;
  data?: any;
  userType?: string;
  userName?: string;
}

async function handleWebSocket(ws: WebSocket) {
  connections.add(ws);
  console.log('New WebSocket connection');
  
  ws.onopen = () => {
    console.log('WebSocket connection opened');
    ws.send(JSON.stringify({ type: 'connected', message: 'Connected to server' }));
  };
  
  ws.onmessage = async (event) => {
    try {
      const message: WebSocketMessage = JSON.parse(event.data);
      await handleWebSocketMessage(ws, message);
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
    }
  };
  
  ws.onclose = () => {
    console.log('WebSocket connection closed');
    connections.delete(ws);
  };
  
  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    connections.delete(ws);
  };
}

async function handleWebSocketMessage(ws: WebSocket, message: WebSocketMessage) {
  switch (message.type) {
    case 'auth':
      // Store user session
      sessions.set(ws, {
        userType: message.userType,
        userName: message.userName,
        authenticated: true
      });
      ws.send(JSON.stringify({ type: 'auth_success', message: 'Authenticated' }));
      break;
      
    case 'stock_update':
      // Broadcast to all connected clients
      broadcast({
        type: 'stock_update',
        data: message.data
      });
      break;
      
    case 'sale_update':
      broadcast({
        type: 'sale_update',
        data: message.data
      });
      break;
      
    case 'audit_update':
      broadcast({
        type: 'audit_update',
        data: message.data
      });
      break;
      
    case 'sync_request':
      // Send current cache to requesting client
      ws.send(JSON.stringify({
        type: 'sync_response',
        data: cache
      }));
      break;
      
    case 'sync_response':
      // Update cache from other client
      Object.assign(cache, message.data);
      break;
  }
}

function broadcast(message: WebSocketMessage) {
  const messageStr = JSON.stringify(message);
  connections.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(messageStr);
    }
  });
}

// HTTP Request Handler
async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  
  // Handle WebSocket upgrade
  if (url.pathname === '/ws') {
    if (request.headers.get('upgrade') === 'websocket') {
      const { socket, response } = Deno.upgradeWebSocket(request);
      handleWebSocket(socket);
      return response;
    }
    return new Response('Expected WebSocket upgrade', { status: 400 });
  }
  
  // API endpoints
  if (url.pathname.startsWith('/api/')) {
    return handleAPI(request);
  }
  
  // Serve static files from public directory
  return serveDir(request, {
    fsRoot: 'public',
    showDirListing: true,
    enableCors: true
  });
}

async function handleAPI(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };
  
  // Handle preflight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers });
  }
  
  try {
    // Mock API endpoints (in production, connect to Supabase)
    switch (path) {
      case '/api/stock':
        if (request.method === 'GET') {
          return new Response(JSON.stringify(cache.stockItems), { headers });
        } else if (request.method === 'POST') {
          const data = await request.json();
          cache.stockItems.push(data);
          broadcast({ type: 'stock_update', data });
          return new Response(JSON.stringify({ success: true }), { headers });
        }
        break;
        
      case '/api/sales':
        if (request.method === 'GET') {
          return new Response(JSON.stringify(cache.sales), { headers });
        } else if (request.method === 'POST') {
          const data = await request.json();
          cache.sales.push(data);
          broadcast({ type: 'sale_update', data });
          return new Response(JSON.stringify({ success: true }), { headers });
        }
        break;
        
      case '/api/audit':
        if (request.method === 'GET') {
          return new Response(JSON.stringify(cache.audit), { headers });
        } else if (request.method === 'POST') {
          const data = await request.json();
          cache.audit.push(data);
          broadcast({ type: 'audit_update', data });
          return new Response(JSON.stringify({ success: true }), { headers });
        }
        break;
        
      case '/api/settings':
        if (request.method === 'GET') {
          const settings = {
            lowStockThreshold: 20,
            expiryWarningDays: 60,
            defaultMarkup: 50.0,
            defaultVAT: 15.0,
            overstockAlert: 150,
            profitMarginAlert: 10
          };
          return new Response(JSON.stringify(settings), { headers });
        }
        break;
        
      case '/api/login':
        if (request.method === 'POST') {
          const { loginType, password } = await request.json();
          
          // Simple authentication (in production, use proper auth)
          if ((loginType === 'user' && password === '123456') || 
              (loginType === 'admin' && password === 'esubalew2123')) {
            return new Response(JSON.stringify({
              success: true,
              userType: loginType,
              userName: loginType === 'admin' ? 'Esubalew Biyazin' : 'User'
            }), { headers });
          } else {
            return new Response(JSON.stringify({
              success: false,
              message: 'Invalid credentials'
            }), { status: 401, headers });
          }
        }
        break;
    }
    
    return new Response(JSON.stringify({ error: 'Not found' }), { 
      status: 404, 
      headers 
    });
    
  } catch (error) {
    console.error('API error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers
    });
  }
}

// Start server
const PORT = 8000;
console.log(`Server running on http://localhost:${PORT}`);

serve(handleRequest, { port: PORT });