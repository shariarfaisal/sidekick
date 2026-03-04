const http = require('http');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const os = require('os');
const { execSync } = require('child_process');

// Load GitHub token for AI proxy
let ghToken = '';
try {
  ghToken = execSync('gh auth token', { encoding: 'utf-8' }).trim();
  console.log('GitHub token loaded for AI proxy');
} catch {
  console.warn('Could not load GitHub token (gh auth token failed). AI features will be unavailable.');
}

const PORT = 8768;
const shell = os.platform() === 'win32' ? 'powershell.exe' : '/bin/zsh';

// Bridge WS connection (from the Chrome extension sidepanel)
let bridgeWs = null;
const pendingBrowserCmds = new Map(); // id → { resolve, timer }

// --- Global PTY process registry (persists across WS reconnects) ---
const BUFFER_MAX = 50 * 1024; // 50 KB ring buffer per process
const ORPHAN_TIMEOUT = 10 * 60 * 1000; // 10 minutes

// Global map: id → { pty, buffer, cols, rows, attachedWs, orphanTimer }
const processes = new Map();

// --- HTTP request body parser ---
function parseBody(req) {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET') return resolve({});
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

// --- Send command to browser bridge and await result ---
function sendBrowserCmd(action, params = {}) {
  return new Promise((resolve, reject) => {
    if (!bridgeWs || bridgeWs.readyState !== 1) {
      return reject(new Error('Browser bridge not connected. Open the extension sidepanel and switch to the terminal tab.'));
    }
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const timer = setTimeout(() => {
      pendingBrowserCmds.delete(id);
      reject(new Error('Timeout waiting for browser response'));
    }, 10000);

    pendingBrowserCmds.set(id, { resolve, reject, timer });
    bridgeWs.send(JSON.stringify({ type: 'browser-cmd', id, action, params }));
  });
}

// --- HTTP server ---
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    const body = await parseBody(req);
    let result;

    switch (path) {
      case '/api/eval':
        if (req.method !== 'POST') return methodNotAllowed(res);
        if (!body.code) return badRequest(res, 'Missing "code" field');
        result = await sendBrowserCmd('eval', { code: body.code });
        break;

      case '/api/dom':
        if (req.method !== 'POST') return methodNotAllowed(res);
        if (!body.selector) return badRequest(res, 'Missing "selector" field');
        result = await sendBrowserCmd('dom', { selector: body.selector });
        break;

      case '/api/click':
        if (req.method !== 'POST') return methodNotAllowed(res);
        if (!body.selector) return badRequest(res, 'Missing "selector" field');
        result = await sendBrowserCmd('click', { selector: body.selector });
        break;

      case '/api/type':
        if (req.method !== 'POST') return methodNotAllowed(res);
        if (!body.selector || body.text === undefined) return badRequest(res, 'Missing "selector" or "text" field');
        result = await sendBrowserCmd('type', { selector: body.selector, text: body.text });
        break;

      case '/api/screenshot':
        if (req.method !== 'GET') return methodNotAllowed(res);
        result = await sendBrowserCmd('screenshot', {});
        break;

      case '/api/url':
        if (req.method !== 'GET') return methodNotAllowed(res);
        result = await sendBrowserCmd('url', {});
        break;

      case '/api/console':
        if (req.method !== 'GET') return methodNotAllowed(res);
        result = await sendBrowserCmd('console', {});
        break;

      case '/api/navigate':
        if (req.method !== 'POST') return methodNotAllowed(res);
        if (!body.url) return badRequest(res, 'Missing "url" field');
        result = await sendBrowserCmd('navigate', { url: body.url });
        break;

      case '/api/content':
        if (req.method !== 'GET') return methodNotAllowed(res);
        result = await sendBrowserCmd('content', {});
        break;

      case '/api/interactive':
        if (req.method !== 'GET') return methodNotAllowed(res);
        result = await sendBrowserCmd('interactive', {});
        break;

      case '/api/tabs':
        if (req.method !== 'GET') return methodNotAllowed(res);
        result = await sendBrowserCmd('tabs', {});
        break;

      case '/api/close_tab':
        if (req.method !== 'POST') return methodNotAllowed(res);
        result = await sendBrowserCmd('close_tab', { tabId: body.tabId });
        break;

      case '/api/back':
        if (req.method !== 'POST') return methodNotAllowed(res);
        result = await sendBrowserCmd('back', {});
        break;

      case '/api/forward':
        if (req.method !== 'POST') return methodNotAllowed(res);
        result = await sendBrowserCmd('forward', {});
        break;

      case '/api/keyboard':
        if (req.method !== 'POST') return methodNotAllowed(res);
        if (!body.key) return badRequest(res, 'Missing "key" field');
        result = await sendBrowserCmd('keyboard', { key: body.key, modifiers: body.modifiers || [] });
        break;

      case '/api/hover':
        if (req.method !== 'POST') return methodNotAllowed(res);
        if (!body.selector) return badRequest(res, 'Missing "selector" field');
        result = await sendBrowserCmd('hover', { selector: body.selector });
        break;

      case '/api/wait':
        if (req.method !== 'POST') return methodNotAllowed(res);
        if (!body.selector && !body.text) return badRequest(res, 'Missing "selector" or "text" field');
        result = await sendBrowserCmd('wait', { selector: body.selector, text: body.text, timeout: body.timeout || 5000 });
        break;

      case '/api/fill_form':
        if (req.method !== 'POST') return methodNotAllowed(res);
        if (!body.fields) return badRequest(res, 'Missing "fields" array');
        result = await sendBrowserCmd('fill_form', { fields: body.fields });
        break;

      case '/api/network':
        if (req.method !== 'GET') return methodNotAllowed(res);
        result = await sendBrowserCmd('network', {});
        break;

      // --- Notes API ---
      case '/api/notes':
        if (req.method === 'GET') {
          result = await sendBrowserCmd('notes_list', {});
        } else if (req.method === 'POST') {
          result = await sendBrowserCmd('notes_create', { title: body.title, content: body.content });
        } else {
          return methodNotAllowed(res);
        }
        break;

      case '/api/notes/get':
        if (req.method !== 'POST') return methodNotAllowed(res);
        if (!body.id) return badRequest(res, 'Missing "id" field');
        result = await sendBrowserCmd('notes_get', { id: body.id });
        break;

      case '/api/notes/update':
        if (req.method !== 'POST') return methodNotAllowed(res);
        if (!body.id) return badRequest(res, 'Missing "id" field');
        result = await sendBrowserCmd('notes_update', { id: body.id, title: body.title, content: body.content });
        break;

      case '/api/notes/delete':
        if (req.method !== 'POST') return methodNotAllowed(res);
        if (!body.id) return badRequest(res, 'Missing "id" field');
        result = await sendBrowserCmd('notes_delete', { id: body.id });
        break;

      case '/api/notes/image':
        if (req.method !== 'POST') return methodNotAllowed(res);
        if (!body.imageId) return badRequest(res, 'Missing "imageId" field');
        result = await sendBrowserCmd('notes_image', { imageId: body.imageId });
        break;

      case '/api/notes/search':
        if (req.method !== 'POST') return methodNotAllowed(res);
        if (!body.query) return badRequest(res, 'Missing "query" field');
        result = await sendBrowserCmd('notes_search', { query: body.query });
        break;

      case '/api/ai/chat': {
        if (req.method !== 'POST') return methodNotAllowed(res);
        if (!body.messages || !Array.isArray(body.messages)) return badRequest(res, 'Missing "messages" array');
        if (!ghToken) {
          res.writeHead(503);
          return res.end(JSON.stringify({ error: 'AI unavailable: no GitHub token' }));
        }

        // SSE headers
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });

        try {
          const aiRes = await fetch('https://models.inference.ai.azure.com/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${ghToken}`,
            },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              messages: body.messages,
              stream: true,
            }),
          });

          if (!aiRes.ok) {
            const errText = await aiRes.text();
            res.write(`data: ${JSON.stringify({ error: errText })}\n\n`);
            res.end();
            return;
          }

          const reader = aiRes.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // keep incomplete line
            for (const line of lines) {
              if (line.startsWith('data:')) {
                res.write(line + '\n\n');
              }
            }
          }
          // Flush remaining
          if (buffer.startsWith('data:')) {
            res.write(buffer + '\n\n');
          }
        } catch (err) {
          res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        }
        res.end();
        return; // skip normal JSON response
      }

      default:
        res.writeHead(404);
        return res.end(JSON.stringify({ error: 'Not found' }));
    }

    res.writeHead(200);
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  }
});

function methodNotAllowed(res) {
  res.writeHead(405);
  res.end(JSON.stringify({ error: 'Method not allowed' }));
}

function badRequest(res, msg) {
  res.writeHead(400);
  res.end(JSON.stringify({ error: msg }));
}

// --- WebSocket server on same port ---
const wss = new WebSocketServer({ server });

// --- Helper: append to ring buffer (cap at BUFFER_MAX) ---
function appendBuffer(entry, data) {
  entry.buffer += data;
  if (entry.buffer.length > BUFFER_MAX) {
    entry.buffer = entry.buffer.slice(entry.buffer.length - BUFFER_MAX);
  }
}

// --- Helper: create a new PTY and register it in the global map ---
function spawnProcess(id, cols, rows, cwd, attachedWs) {
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: cwd || os.homedir(),
    env: {
      ...process.env,
      COLORTERM: 'truecolor',
      TERM: 'xterm-256color',
      FORCE_COLOR: '1',
    },
  });

  const entry = { pty: ptyProcess, buffer: '', cols, rows, attachedWs, orphanTimer: null };
  processes.set(id, entry);

  ptyProcess.onData((data) => {
    appendBuffer(entry, data);
    if (entry.attachedWs && entry.attachedWs.readyState === 1) {
      entry.attachedWs.send(JSON.stringify({ type: 'output', id, data }));
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    if (entry.attachedWs && entry.attachedWs.readyState === 1) {
      entry.attachedWs.send(JSON.stringify({ type: 'exit', id, code: exitCode }));
    }
    if (entry.orphanTimer) clearTimeout(entry.orphanTimer);
    processes.delete(id);
  });

  return entry;
}

// --- Helper: attach a WS to an existing process (replay buffer) ---
function attachProcess(id, entry, ws) {
  // Clear orphan timer
  if (entry.orphanTimer) {
    clearTimeout(entry.orphanTimer);
    entry.orphanTimer = null;
  }
  entry.attachedWs = ws;

  // Replay buffered output
  if (entry.buffer.length > 0) {
    ws.send(JSON.stringify({ type: 'output', id, data: entry.buffer }));
  }

  // Resize to client dimensions if needed
  ws.send(JSON.stringify({ type: 'attached', id }));
}

// --- Helper: detach WS from all its processes, start orphan timers ---
function detachAll(ws) {
  for (const [id, entry] of processes) {
    if (entry.attachedWs === ws) {
      entry.attachedWs = null;
      // Start orphan timer
      entry.orphanTimer = setTimeout(() => {
        console.log(`Orphan cleanup: killing process ${id}`);
        try { entry.pty.kill(); } catch {}
        processes.delete(id);
      }, ORPHAN_TIMEOUT);
    }
  }
}

wss.on('connection', (ws) => {
  let isBridge = false;
  // Track which process IDs this WS owns (for detach on close)
  const ownedIds = new Set();

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // Bridge registration from the extension
    if (msg.type === 'register-bridge') {
      bridgeWs = ws;
      isBridge = true;
      console.log('Browser bridge connected');
      return;
    }

    // Browser result coming back from bridge
    if (msg.type === 'browser-result') {
      const pending = pendingBrowserCmds.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        pendingBrowserCmds.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error));
        } else {
          pending.resolve(msg.data || {});
        }
      }
      return;
    }

    // Terminal PTY messages
    switch (msg.type) {
      case 'spawn': {
        const id = msg.id;
        if (!id) break;

        const cols = msg.cols || 80;
        const rows = msg.rows || 24;

        // If process already exists and is alive, re-attach instead of spawning
        if (processes.has(id)) {
          const existing = processes.get(id);
          attachProcess(id, existing, ws);
          ownedIds.add(id);
          // Resize to match client
          try { existing.pty.resize(cols, rows); } catch {}
          existing.cols = cols;
          existing.rows = rows;
          break;
        }

        // Spawn new process
        spawnProcess(id, cols, rows, msg.cwd, ws);
        ownedIds.add(id);
        ws.send(JSON.stringify({ type: 'spawned', id }));
        break;
      }

      case 'input': {
        const entry = processes.get(msg.id);
        if (entry) {
          entry.pty.write(msg.data);
        }
        break;
      }

      case 'resize': {
        const entry = processes.get(msg.id);
        if (entry && msg.cols && msg.rows) {
          try {
            entry.pty.resize(msg.cols, msg.rows);
            entry.cols = msg.cols;
            entry.rows = msg.rows;
          } catch {}
        }
        break;
      }

      case 'kill': {
        const entry = processes.get(msg.id);
        if (entry) {
          if (entry.orphanTimer) clearTimeout(entry.orphanTimer);
          try { entry.pty.kill(); } catch {}
          processes.delete(msg.id);
          ownedIds.delete(msg.id);
        }
        break;
      }
    }
  });

  function onDisconnect() {
    if (isBridge && bridgeWs === ws) {
      bridgeWs = null;
      console.log('Browser bridge disconnected');
    }
    // Detach all processes owned by this WS (don't kill — start orphan timers)
    detachAll(ws);
    ownedIds.clear();
  }

  ws.on('close', onDisconnect);
  ws.on('error', onDisconnect);
});

server.listen(PORT, () => {
  console.log(`Terminal server listening on http://localhost:${PORT} (HTTP + WS)`);
});
