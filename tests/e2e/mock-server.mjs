// Mock TermBot server for E2E testing
// Provides HTTP API + WebSocket endpoints matching the real server

import http from 'http';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';

const SESSIONS = [
  { session_id: 'sess-001', name: 'test-session-1', alias: '测试1', cols: 120, rows: 40, window_id: 'w1', ai_running: false, ai_mode: 'manual' },
  { session_id: 'sess-002', name: 'test-session-2', alias: '测试2', cols: 120, rows: 40, window_id: 'w1', ai_running: true, ai_mode: 'auto' },
  { session_id: 'sess-003', name: 'test-session-3', alias: '测试3', cols: 120, rows: 40, window_id: 'w2', ai_running: true, ai_mode: 'auto_crazy' },
];

const TOKEN = 'test-token';
let sessionModes = { 'sess-001': 'manual', 'sess-002': 'auto', 'sess-003': 'auto_crazy' };

// Track events for test assertions
export const events = [];
export function clearEvents() { events.length = 0; }

// --- HTTP Server (serves frontend + API) ---
const srcDir = path.resolve(import.meta.dirname, '../../src');

function serveFrontend(req, res) {
  let filePath = req.url.split('?')[0];
  if (filePath === '/') filePath = '/index.html';
  const fullPath = path.join(srcDir, filePath);
  if (!fs.existsSync(fullPath)) { res.writeHead(404); res.end('Not found'); return; }
  const ext = path.extname(fullPath);
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png' };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  res.end(fs.readFileSync(fullPath));
}

function handleApi(req, res, url) {
  // GET /api/sessions
  if (url.pathname === '/api/sessions') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(SESSIONS));
    return;
  }
  // GET /api/ai/history
  if (url.pathname === '/api/ai/history') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([]));
    return;
  }
  // POST /api/sessions/:id/upload
  if (url.pathname.match(/\/api\/sessions\/.*\/upload/) && req.method === 'POST') {
    events.push({ type: 'upload', sessionId: url.pathname.split('/')[3] });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, filename: 'test.txt', path: 'downloads/test.txt', size: 100 }));
    return;
  }
  // GET /api/sessions/:id/download
  if (url.pathname.match(/\/api\/sessions\/.*\/download/)) {
    const filePath = url.searchParams.get('path');
    events.push({ type: 'download', sessionId: url.pathname.split('/')[3], path: filePath });
    res.writeHead(200, { 'Content-Disposition': `attachment; filename="${filePath}"`, 'Content-Type': 'application/octet-stream' });
    res.end('mock file content');
    return;
  }
  // GET /api/sessions/:id/ideas
  if (url.pathname.match(/\/api\/sessions\/.*\/ideas/)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([]));
    return;
  }
  res.writeHead(404);
  res.end('API not found');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost`);
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url);
  } else {
    serveFrontend(req, res);
  }
});

// --- WebSocket Server ---
const wss = new WebSocketServer({ noServer: true });
const wsClients = new Set();

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://localhost`);
  if (url.pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws) => {
  wsClients.add(ws);

  // Send sessions list on connect
  ws.send(JSON.stringify({
    type: 'sessions',
    list: SESSIONS.map(s => ({ ...s, ai_mode: sessionModes[s.session_id] || 'manual' })),
  }));

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    events.push({ type: 'ws_msg', msg });

    switch (msg.type) {
      case 'switch':
        // Send screen output
        ws.send(JSON.stringify({
          type: 'output',
          data: `$ connected to ${msg.session_id}\n> ready`,
          session_id: msg.session_id,
        }));
        // Send status with current mode
        ws.send(JSON.stringify({
          type: 'status',
          mode: sessionModes[msg.session_id] || 'manual',
          session_id: msg.session_id,
        }));
        break;
      case 'mode':
        sessionModes[msg.session_id] = msg.mode;
        // Broadcast status
        for (const c of wsClients) {
          c.send(JSON.stringify({
            type: 'status',
            mode: msg.mode,
            session_id: msg.session_id || Object.keys(sessionModes)[0],
          }));
        }
        break;
      case 'input':
        events.push({ type: 'input', data: msg.data });
        break;
      case 'key':
        events.push({ type: 'key', key: msg.key });
        break;
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
    }
  });

  ws.on('close', () => wsClients.delete(ws));
});

// --- Broadcast helpers for tests ---
export function broadcastAiCountdown(sessionId, remaining, action, value) {
  const msg = { type: 'ai_countdown', session_id: sessionId, remaining, total: 5, action, value };
  for (const c of wsClients) c.send(JSON.stringify(msg));
}

export function broadcastAiStatus(sessionId, status, action, value, trigger) {
  const msg = { type: 'ai_status', session_id: sessionId, status, action, value, trigger };
  for (const c of wsClients) c.send(JSON.stringify(msg));
}

// --- Start ---
let _port = 0;
export function getPort() { return _port; }

export function startServer(port = 0) {
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      _port = server.address().port;
      resolve(_port);
    });
  });
}

export function stopServer() {
  for (const c of wsClients) c.close();
  return new Promise((resolve) => server.close(resolve));
}

// Allow running standalone
if (process.argv[1] === import.meta.filename) {
  const port = await startServer(18090);
  console.log(`Mock server running on http://127.0.0.1:${port}`);
}
