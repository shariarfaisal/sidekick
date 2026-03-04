import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { initBridge } from './browser-bridge.js';

const WS_URL = 'ws://localhost:8768';

let ws = null;
let reconnectTimer = null;
let terminalCounter = 0;
let bridgeHandler = null;

// Map of id → { terminal, fitAddon, containerEl, tabEl }
const terminals = new Map();
let activeId = null;

const SESSION_KEY = 'sidebar_terminal_session';

function generateId() {
  return crypto.randomUUID();
}

function saveSession() {
  const terminalList = [];
  for (const [id, entry] of terminals) {
    terminalList.push({ id, label: entry.label });
  }
  const session = { terminals: terminalList, activeId, counter: terminalCounter };
  chrome.storage.local.set({ [SESSION_KEY]: session });
}

async function loadSession() {
  return new Promise((resolve) => {
    chrome.storage.local.get(SESSION_KEY, (result) => {
      resolve(result[SESSION_KEY] || null);
    });
  });
}

function clearSession() {
  chrome.storage.local.remove(SESSION_KEY);
}

function getThemeColors() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  return {
    background: isDark ? '#1c1c1e' : '#ffffff',
    foreground: isDark ? '#f2f2f7' : '#1f2329',
    cursor: isDark ? '#f2cf67' : '#2e333a',
    cursorAccent: isDark ? '#1c1c1e' : '#ffffff',
    selectionBackground: isDark ? 'rgba(242, 207, 103, 0.25)' : 'rgba(46, 51, 58, 0.2)',
    black: isDark ? '#1c1c1e' : '#1f2329',
    red: isDark ? '#ff7b7b' : '#c23a3a',
    green: isDark ? '#98c379' : '#16803c',
    yellow: isDark ? '#d19a66' : '#c2410c',
    blue: isDark ? '#61afef' : '#1d4ed8',
    magenta: isDark ? '#c678dd' : '#7c3aed',
    cyan: isDark ? '#56b6c2' : '#0891b2',
    white: isDark ? '#f2f2f7' : '#1f2329',
    brightBlack: isDark ? '#5c6370' : '#8a9099',
    brightRed: isDark ? '#ff7b7b' : '#c23a3a',
    brightGreen: isDark ? '#98c379' : '#16803c',
    brightYellow: isDark ? '#d19a66' : '#c2410c',
    brightBlue: isDark ? '#61afef' : '#1d4ed8',
    brightMagenta: isDark ? '#c678dd' : '#7c3aed',
    brightCyan: isDark ? '#56b6c2' : '#0891b2',
    brightWhite: isDark ? '#f2f2f7' : '#1f2329',
  };
}

function getTerminalBg() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  return isDark ? '#1c1c1e' : '#ffffff';
}

function updateContainerBg() {
  const bg = getTerminalBg();
  const container = document.getElementById('terminal-container');
  if (container) container.style.backgroundColor = bg;
}

function createTerminal() {
  const id = generateId();
  terminalCounter++;
  const label = `Terminal ${terminalCounter}`;

  const container = document.getElementById('terminal-container');

  // Create pane div
  const paneEl = document.createElement('div');
  paneEl.className = 'terminal-pane';
  paneEl.dataset.terminalId = id;
  container.appendChild(paneEl);

  // Create xterm instance
  const theme = getThemeColors();
  const terminal = new Terminal({
    fontSize: 13,
    fontFamily: "'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace",
    lineHeight: 1.4,
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 5000,
    theme,
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(paneEl);

  // Wire input
  terminal.onData((data) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', id, data }));
    }
  });

  terminal.onResize(({ cols, rows }) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', id, cols, rows }));
    }
  });

  // Resize observer for this pane
  const resizeObserver = new ResizeObserver(() => {
    if (activeId === id && fitAddon) {
      fitAddon.fit();
    }
  });
  resizeObserver.observe(paneEl);

  // Create tab
  const tabEl = document.createElement('button');
  tabEl.className = 'terminal-tab';
  tabEl.dataset.terminalId = id;
  tabEl.innerHTML = `<span class="tab-label">${label}</span><span class="close-btn" title="Close terminal">\u00d7</span>`;

  tabEl.addEventListener('click', (e) => {
    if (e.target.closest('.close-btn')) {
      closeTerminal(id);
    } else {
      switchTerminal(id);
    }
  });

  document.getElementById('terminal-tab-list').appendChild(tabEl);

  // Store
  terminals.set(id, { terminal, fitAddon, containerEl: paneEl, tabEl, resizeObserver, label });

  // Switch to this terminal
  switchTerminal(id);

  // Spawn PTY on server
  if (ws && ws.readyState === WebSocket.OPEN) {
    const dims = fitAddon.proposeDimensions() || { cols: 80, rows: 24 };
    ws.send(JSON.stringify({ type: 'spawn', id, cols: dims.cols, rows: dims.rows }));
  }

  saveSession();
  return id;
}

function switchTerminal(id) {
  if (!terminals.has(id)) return;

  activeId = id;

  // Update pane visibility
  for (const [tid, entry] of terminals) {
    const isActive = tid === id;
    entry.containerEl.classList.toggle('active', isActive);
    entry.tabEl.classList.toggle('active', isActive);
  }

  // Fit and focus the active terminal
  const entry = terminals.get(id);
  setTimeout(() => {
    entry.fitAddon.fit();
    entry.terminal.focus();
  }, 10);

  saveSession();
}

function closeTerminal(id) {
  const entry = terminals.get(id);
  if (!entry) return;

  // Kill PTY on server
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'kill', id }));
  }

  // Cleanup
  entry.resizeObserver.disconnect();
  entry.terminal.dispose();
  entry.containerEl.remove();
  entry.tabEl.remove();
  terminals.delete(id);

  // Switch to another terminal or create new one
  if (terminals.size === 0) {
    createTerminal();
  } else if (activeId === id) {
    const nextId = terminals.keys().next().value;
    switchTerminal(nextId);
  }

  saveSession();
}

// Restore a terminal instance from saved session (creates xterm + tab, no PTY spawn)
function restoreTerminalInstance(id, label) {
  const container = document.getElementById('terminal-container');

  const paneEl = document.createElement('div');
  paneEl.className = 'terminal-pane';
  paneEl.dataset.terminalId = id;
  container.appendChild(paneEl);

  const theme = getThemeColors();
  const terminal = new Terminal({
    fontSize: 13,
    fontFamily: "'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace",
    lineHeight: 1.4,
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 5000,
    theme,
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(paneEl);

  terminal.onData((data) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', id, data }));
    }
  });

  terminal.onResize(({ cols, rows }) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', id, cols, rows }));
    }
  });

  const resizeObserver = new ResizeObserver(() => {
    if (activeId === id && fitAddon) {
      fitAddon.fit();
    }
  });
  resizeObserver.observe(paneEl);

  const tabEl = document.createElement('button');
  tabEl.className = 'terminal-tab';
  tabEl.dataset.terminalId = id;
  tabEl.innerHTML = `<span class="tab-label">${label}</span><span class="close-btn" title="Close terminal">\u00d7</span>`;

  tabEl.addEventListener('click', (e) => {
    if (e.target.closest('.close-btn')) {
      closeTerminal(id);
    } else {
      switchTerminal(id);
    }
  });

  document.getElementById('terminal-tab-list').appendChild(tabEl);

  terminals.set(id, { terminal, fitAddon, containerEl: paneEl, tabEl, resizeObserver, label });
}

function showStatus(text, isError = false) {
  const el = document.getElementById('terminal-status');
  el.textContent = text;
  el.className = 'terminal-status' + (isError ? ' error' : '');
  el.style.display = 'flex';
}

function hideStatus() {
  document.getElementById('terminal-status').style.display = 'none';
}

function connect() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return;
  }

  showStatus('Connecting to terminal server...');

  ws = new WebSocket(WS_URL);

  ws.onopen = async () => {
    hideStatus();
    if (reconnectTimer) {
      clearInterval(reconnectTimer);
      reconnectTimer = null;
    }

    // Register as browser bridge
    bridgeHandler = initBridge(ws);

    // If we already have terminals in memory (WS reconnect), re-attach them
    if (terminals.size > 0) {
      for (const [id, entry] of terminals) {
        const dims = entry.fitAddon.proposeDimensions() || { cols: 80, rows: 24 };
        ws.send(JSON.stringify({ type: 'spawn', id, cols: dims.cols, rows: dims.rows }));
      }
      return;
    }

    // Try to restore a saved session
    const session = await loadSession();
    if (session && session.terminals && session.terminals.length > 0) {
      terminalCounter = session.counter || session.terminals.length;
      // Recreate xterm instances + tabs from saved session
      for (const saved of session.terminals) {
        restoreTerminalInstance(saved.id, saved.label);
      }
      // Switch to saved active tab
      if (session.activeId && terminals.has(session.activeId)) {
        switchTerminal(session.activeId);
      } else {
        switchTerminal(terminals.keys().next().value);
      }
      // Send spawn for each (server will re-attach if alive, or create new)
      for (const [id, entry] of terminals) {
        const dims = entry.fitAddon.proposeDimensions() || { cols: 80, rows: 24 };
        ws.send(JSON.stringify({ type: 'spawn', id, cols: dims.cols, rows: dims.rows }));
      }
      return;
    }

    // No saved session — create first terminal
    createTerminal();
  };

  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    // Route browser commands to bridge handler
    if (bridgeHandler && msg.type === 'browser-cmd') {
      bridgeHandler(msg);
      return;
    }

    const entry = msg.id ? terminals.get(msg.id) : null;

    switch (msg.type) {
      case 'output':
        if (entry) {
          entry.terminal.write(msg.data);
        }
        break;
      case 'exit':
        if (entry) {
          entry.terminal.writeln('\r\n\x1b[90m[Process exited]\x1b[0m');
          // Respawn after a short delay
          setTimeout(() => {
            if (ws && ws.readyState === WebSocket.OPEN && terminals.has(msg.id)) {
              const dims = entry.fitAddon.proposeDimensions() || { cols: 80, rows: 24 };
              ws.send(JSON.stringify({ type: 'spawn', id: msg.id, cols: dims.cols, rows: dims.rows }));
            }
          }, 500);
        }
        break;
      case 'spawned':
        if (entry && msg.id === activeId) {
          entry.terminal.focus();
        }
        break;
      case 'attached':
        // Process was re-attached; buffer replay comes as 'output' messages
        if (entry && msg.id === activeId) {
          entry.terminal.focus();
        }
        break;
    }
  };

  ws.onclose = () => {
    showStatus('Terminal server not running. Start it with: cd terminal-server && npm start', true);
    ws = null;
    // Save session so we can restore on reconnect
    saveSession();
    if (!reconnectTimer) {
      reconnectTimer = setInterval(connect, 3000);
    }
  };

  ws.onerror = () => {
    // onclose will handle it
  };
}

export function initChat() {
  updateContainerBg();

  // New terminal button
  document.getElementById('btn-new-terminal').addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      createTerminal();
    }
  });

  // Observe theme changes to update terminal colors + container bg
  const observer = new MutationObserver(() => {
    const theme = getThemeColors();
    for (const [, entry] of terminals) {
      entry.terminal.options.theme = theme;
    }
    updateContainerBg();
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

export function activateTerminal() {
  // Connect on first activation (lazy)
  if (!ws) {
    connect();
  }
  // Re-fit when tab becomes visible
  if (activeId && terminals.has(activeId)) {
    const entry = terminals.get(activeId);
    setTimeout(() => {
      entry.fitAddon.fit();
      entry.terminal.focus();
    }, 50);
  }
}
