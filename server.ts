import { serve } from "https://deno.land/std@0.200.0/http/server.ts";
import { serveDir } from "https://deno.land/std@0.200.0/http/file_server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

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

// Initialize Supabase client
const supabaseUrl = "https://yjijuwxbxxhufwglytny.supabase.co";
const supabaseKey = "sb_secret_q2JYU9KW1FK3HxnFk8Vo5Q_4dLpX552";
const supabase = createClient(supabaseUrl, supabaseKey);

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
      
      switch (message.type) {
        case 'auth':
          // Handle authentication
          if (message.userType && message.userName) {
            sessions.set(ws, {
              userType: message.userType,
              userName: message.userName,
              timestamp: Date.now()
            });
            
            // Send initial data from cache
            ws.send(JSON.stringify({
              type: 'initial_data',
              stockItems: cache.stockItems,
              sales: cache.sales,
              transactions: cache.transactions
            }));
          }
          break;
          
        case 'stock_update':
          // Update stock in cache
          cache.stockItems = message.data || [];
          
          // Broadcast to all connected clients
          broadcast({
            type: 'stock_updated',
            data: cache.stockItems
          });
          break;
          
        case 'sale_update':
          // Add new sale to cache
          if (message.data) {
            cache.sales.push({
              ...message.data,
              timestamp: Date.now()
            });
            
            // Broadcast to all connected clients
            broadcast({
              type: 'sales_updated',
              data: cache.sales
            });
            
            // Update stock levels in cache
            if (message.data.items) {
              updateStockLevels(message.data.items);
            }
            
            // Log to audit trail
            logAudit('sale_created', message.data);
          }
          break;
          
        case 'transaction_update':
          // Add new transaction to cache
          if (message.data) {
            cache.transactions.push({
              ...message.data,
              timestamp: Date.now()
            });
            
            // Broadcast to all connected clients
            broadcast({
              type: 'transactions_updated',
              data: cache.transactions
            });
            
            // Log to audit trail
            logAudit('transaction_created', message.data);
          }
          break;
          
        case 'sync_request':
          // Send current cache state
          ws.send(JSON.stringify({
            type: 'sync_response',
            ...cache
          }));
          break;
          
        default:
          console.log('Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to process message'
      }));
    }
  };
  
  ws.onclose = () => {
    console.log('WebSocket connection closed');
    connections.delete(ws);
    sessions.delete(ws);
  };
  
  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    connections.delete(ws);
    sessions.delete(ws);
  };
}

function broadcast(message: any) {
  const data = JSON.stringify(message);
  connections.forEach(conn => {
    if (conn.readyState === WebSocket.OPEN) {
      conn.send(data);
    }
  });
}

function updateStockLevels(items: any[]) {
  items.forEach(item => {
    const stockItem = cache.stockItems.find((s: any) => s.id === item.id);
    if (stockItem) {
      stockItem.quantity -= item.quantity;
    }
  });
}

function logAudit(action: string, data: any) {
  const auditEntry = {
    action,
    data,
    timestamp: Date.now()
  };
  cache.audit.push(auditEntry);
  
  // Broadcast audit update
  broadcast({
    type: 'audit_updated',
    data: cache.audit
  });
}

async function handleRequest(req: Request) {
  const url = new URL(req.url);
  
  // Handle WebSocket connections
  if (req.headers.get("upgrade") === "websocket") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    handleWebSocket(socket);
    return response;
  }
  
  // Handle API endpoints
  if (url.pathname.startsWith('/api/')) {
    const path = url.pathname.replace('/api/', '');
    
    switch (path) {
      case 'health':
        return new Response(JSON.stringify({ 
          status: 'ok',
          connections: connections.size,
          cacheSizes: {
            stockItems: cache.stockItems.length,
            sales: cache.sales.length,
            transactions: cache.transactions.length,
            audit: cache.audit.length
          }
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
        
      case 'clear-cache':
        if (req.method === 'POST') {
          cache.stockItems = [];
          cache.sales = [];
          cache.transactions = [];
          cache.audit = [];
          
          broadcast({ type: 'cache_cleared' });
          
          return new Response(JSON.stringify({ 
            message: 'Cache cleared successfully'
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
        break;
        
      case 'test-supabase':
        try {
          // Test Supabase connection
          const { data, error } = await supabase.from('test_table').select('*').limit(1);
          
          if (error) throw error;
          
          return new Response(JSON.stringify({ 
            status: 'connected',
            message: 'Supabase connection successful',
            data
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (error) {
          return new Response(JSON.stringify({ 
            status: 'error',
            message: 'Failed to connect to Supabase',
            error: error.message
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
    }
    
    return new Response(JSON.stringify({ error: 'API endpoint not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Serve static files (for frontend)
  return serveDir(req, {
    fsRoot: "public",
    urlRoot: "",
    showDirListing: true,
    enableCors: true
  });
}

const PORT = 8000;
console.log(`Server running on http://localhost:${PORT}`);
serve(handleRequest, { port: PORT });
