// Browser Bridge — handles browser-cmd messages from the terminal server
// and executes Chrome extension APIs to control the active tab.

import { getImage } from './imageStore.js';

const NOTES_KEY = 'sidekick_notes';
const ACTIVE_NOTE_KEY = 'sidebar_active_note';

let consoleLogs = [];
const MAX_CONSOLE_LOGS = 500;
const injectedTabs = new Set();

// --- Notes helpers (direct access to extension storage + IndexedDB) ---

async function getNotes() {
  const result = await chrome.storage.local.get(NOTES_KEY);
  return result[NOTES_KEY] || [];
}

async function saveNotes(notes) {
  await chrome.storage.local.set({ [NOTES_KEY]: notes });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function sortNotes(notes) {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}

function getActiveTab() {
  return chrome.tabs.query({ active: true, lastFocusedWindow: true }).then((tabs) => {
    if (!tabs || tabs.length === 0) throw new Error('No active tab found');
    return tabs[0];
  });
}

async function handleAction(action, params) {
  switch (action) {
    case 'eval': {
      const tab = await getActiveTab();
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (code) => {
          try {
            return { value: String(eval(code)) };
          } catch (e) {
            return { error: e.message };
          }
        },
        args: [params.code],
        world: 'MAIN',
      });
      const r = results[0]?.result;
      if (r?.error) throw new Error(r.error);
      return { result: r?.value };
    }

    case 'dom': {
      const tab = await getActiveTab();
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (selector) => {
          const els = document.querySelectorAll(selector);
          return Array.from(els).map((el) => el.outerHTML);
        },
        args: [params.selector],
        world: 'MAIN',
      });
      return { elements: results[0]?.result || [] };
    }

    case 'click': {
      const tab = await getActiveTab();
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (selector) => {
          const el = document.querySelector(selector);
          if (!el) return { error: `No element found for selector: ${selector}` };
          el.click();
          return { clicked: true, tag: el.tagName.toLowerCase() };
        },
        args: [params.selector],
        world: 'MAIN',
      });
      const r = results[0]?.result;
      if (r?.error) throw new Error(r.error);
      return r;
    }

    case 'type': {
      const tab = await getActiveTab();
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (selector, text) => {
          const el = document.querySelector(selector);
          if (!el) return { error: `No element found for selector: ${selector}` };
          el.focus();
          el.value = text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { typed: true, tag: el.tagName.toLowerCase() };
        },
        args: [params.selector, params.text],
        world: 'MAIN',
      });
      const r = results[0]?.result;
      if (r?.error) throw new Error(r.error);
      return r;
    }

    case 'screenshot': {
      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
      // Strip the data:image/png;base64, prefix
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
      return { screenshot: base64, format: 'png', encoding: 'base64' };
    }

    case 'url': {
      const tab = await getActiveTab();
      return { url: tab.url, title: tab.title, id: tab.id };
    }

    case 'console': {
      const tab = await getActiveTab();
      // Inject console capture if not already done for this tab
      if (!injectedTabs.has(tab.id)) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            if (window.__sidekickConsoleCapture) return;
            window.__sidekickConsoleCapture = true;
            window.__capturedConsoleLogs = window.__capturedConsoleLogs || [];
            const original = {};
            ['log', 'warn', 'error', 'info', 'debug'].forEach((method) => {
              original[method] = console[method];
              console[method] = function (...args) {
                window.__capturedConsoleLogs.push({
                  level: method,
                  message: args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '),
                  timestamp: Date.now(),
                });
                // Keep bounded
                if (window.__capturedConsoleLogs.length > 500) {
                  window.__capturedConsoleLogs = window.__capturedConsoleLogs.slice(-500);
                }
                original[method].apply(console, args);
              };
            });
          },
          world: 'MAIN',
        });
        injectedTabs.add(tab.id);
      }
      // Retrieve captured logs
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const logs = window.__capturedConsoleLogs || [];
          window.__capturedConsoleLogs = [];
          return logs;
        },
        world: 'MAIN',
      });
      return { logs: results[0]?.result || [] };
    }

    case 'navigate': {
      const tab = await getActiveTab();
      await chrome.tabs.update(tab.id, { url: params.url });
      return { navigated: true, url: params.url };
    }

    case 'content': {
      const tab = await getActiveTab();
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          // Get clean text content, falling back through strategies
          const sel = window.getSelection();
          sel.removeAllRanges();

          // Try article/main content first
          const article = document.querySelector('article') || document.querySelector('main') || document.body;
          return {
            title: document.title,
            url: location.href,
            text: article.innerText.slice(0, 50000),
            html: article.innerHTML.slice(0, 100000),
          };
        },
        world: 'MAIN',
      });
      return results[0]?.result || {};
    }

    case 'interactive': {
      const tab = await getActiveTab();
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const elements = [];
          const selectors = [
            'a[href]', 'button', 'input', 'textarea', 'select',
            '[role="button"]', '[role="link"]', '[role="tab"]',
            '[onclick]', '[tabindex]',
          ];
          const seen = new Set();
          document.querySelectorAll(selectors.join(',')).forEach((el, i) => {
            if (seen.has(el) || !el.offsetParent) return; // skip hidden
            seen.add(el);
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;

            const tag = el.tagName.toLowerCase();
            const info = {
              index: elements.length,
              tag,
              type: el.type || undefined,
              text: (el.innerText || el.value || el.placeholder || el.alt || el.title || '').slice(0, 100).trim(),
              selector: buildSelector(el),
              role: el.getAttribute('role') || undefined,
              href: tag === 'a' ? el.href : undefined,
              name: el.name || undefined,
              id: el.id || undefined,
            };
            // Remove undefined fields
            Object.keys(info).forEach((k) => info[k] === undefined && delete info[k]);
            elements.push(info);
          });

          function buildSelector(el) {
            if (el.id) return `#${el.id}`;
            let path = el.tagName.toLowerCase();
            if (el.className && typeof el.className === 'string') {
              const cls = el.className.trim().split(/\s+/).slice(0, 2).join('.');
              if (cls) path += '.' + cls;
            }
            // Add nth-child if needed for uniqueness
            if (el.parentElement) {
              const siblings = Array.from(el.parentElement.children).filter((s) => s.tagName === el.tagName);
              if (siblings.length > 1) {
                const idx = siblings.indexOf(el) + 1;
                path += `:nth-child(${idx})`;
              }
            }
            return path;
          }

          return elements;
        },
        world: 'MAIN',
      });
      return { elements: results[0]?.result || [] };
    }

    case 'tabs': {
      const tabs = await chrome.tabs.query({});
      return {
        tabs: tabs.map((t) => ({
          id: t.id,
          url: t.url,
          title: t.title,
          active: t.active,
          windowId: t.windowId,
        })),
      };
    }

    case 'close_tab': {
      const tabId = params.tabId;
      if (tabId) {
        await chrome.tabs.remove(tabId);
        return { closed: true, tabId };
      }
      const tab = await getActiveTab();
      await chrome.tabs.remove(tab.id);
      return { closed: true, tabId: tab.id };
    }

    case 'back': {
      const tab = await getActiveTab();
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => history.back(),
        world: 'MAIN',
      });
      return { navigated: 'back' };
    }

    case 'forward': {
      const tab = await getActiveTab();
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => history.forward(),
        world: 'MAIN',
      });
      return { navigated: 'forward' };
    }

    case 'keyboard': {
      const tab = await getActiveTab();
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (key, modifiers) => {
          const opts = {
            key,
            code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
            bubbles: true,
            cancelable: true,
            ctrlKey: modifiers.includes('ctrl'),
            shiftKey: modifiers.includes('shift'),
            altKey: modifiers.includes('alt'),
            metaKey: modifiers.includes('meta'),
          };
          const target = document.activeElement || document.body;
          target.dispatchEvent(new KeyboardEvent('keydown', opts));
          target.dispatchEvent(new KeyboardEvent('keypress', opts));
          target.dispatchEvent(new KeyboardEvent('keyup', opts));
          return { pressed: key, modifiers };
        },
        args: [params.key, params.modifiers || []],
        world: 'MAIN',
      });
      return results[0]?.result || {};
    }

    case 'hover': {
      const tab = await getActiveTab();
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (selector) => {
          const el = document.querySelector(selector);
          if (!el) return { error: `No element found for selector: ${selector}` };
          const rect = el.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: x, clientY: y }));
          el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: x, clientY: y }));
          el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
          return { hovered: true, tag: el.tagName.toLowerCase(), position: { x, y } };
        },
        args: [params.selector],
        world: 'MAIN',
      });
      const r = results[0]?.result;
      if (r?.error) throw new Error(r.error);
      return r;
    }

    case 'wait': {
      const tab = await getActiveTab();
      const timeout = params.timeout || 5000;
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (selector, text, timeout) => {
          return new Promise((resolve) => {
            const start = Date.now();
            function check() {
              if (selector) {
                const el = document.querySelector(selector);
                if (el) return resolve({ found: true, selector, elapsed: Date.now() - start });
              }
              if (text) {
                if (document.body.innerText.includes(text)) {
                  return resolve({ found: true, text, elapsed: Date.now() - start });
                }
              }
              if (Date.now() - start > timeout) {
                return resolve({ found: false, timeout: true, elapsed: Date.now() - start });
              }
              setTimeout(check, 100);
            }
            check();
          });
        },
        args: [params.selector || null, params.text || null, timeout],
        world: 'MAIN',
      });
      return results[0]?.result || {};
    }

    case 'fill_form': {
      const tab = await getActiveTab();
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (fields) => {
          const results = [];
          for (const { selector, value } of fields) {
            const el = document.querySelector(selector);
            if (!el) {
              results.push({ selector, error: 'Not found' });
              continue;
            }
            el.focus();
            if (el.tagName === 'SELECT') {
              el.value = value;
              el.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
              el.value = value;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
            results.push({ selector, filled: true });
          }
          return results;
        },
        args: [params.fields],
        world: 'MAIN',
      });
      return { results: results[0]?.result || [] };
    }

    case 'network': {
      const tab = await getActiveTab();
      // Inject network capture if not done, then retrieve
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          if (window.__sidekickNetCapture) return;
          window.__sidekickNetCapture = true;
          window.__capturedNetRequests = window.__capturedNetRequests || [];
          const origFetch = window.fetch;
          window.fetch = async function (...args) {
            const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
            const method = args[1]?.method || 'GET';
            const start = Date.now();
            try {
              const resp = await origFetch.apply(this, args);
              window.__capturedNetRequests.push({
                type: 'fetch', url, method, status: resp.status, duration: Date.now() - start, timestamp: start,
              });
              if (window.__capturedNetRequests.length > 200) {
                window.__capturedNetRequests = window.__capturedNetRequests.slice(-200);
              }
              return resp;
            } catch (err) {
              window.__capturedNetRequests.push({
                type: 'fetch', url, method, error: err.message, duration: Date.now() - start, timestamp: start,
              });
              throw err;
            }
          };
          const origXHROpen = XMLHttpRequest.prototype.open;
          const origXHRSend = XMLHttpRequest.prototype.send;
          XMLHttpRequest.prototype.open = function (method, url) {
            this.__reqInfo = { type: 'xhr', method, url, timestamp: Date.now() };
            return origXHROpen.apply(this, arguments);
          };
          XMLHttpRequest.prototype.send = function () {
            const info = this.__reqInfo;
            if (info) {
              this.addEventListener('loadend', () => {
                info.status = this.status;
                info.duration = Date.now() - info.timestamp;
                window.__capturedNetRequests.push(info);
                if (window.__capturedNetRequests.length > 200) {
                  window.__capturedNetRequests = window.__capturedNetRequests.slice(-200);
                }
              });
            }
            return origXHRSend.apply(this, arguments);
          };
        },
        world: 'MAIN',
      });
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const reqs = window.__capturedNetRequests || [];
          window.__capturedNetRequests = [];
          return reqs;
        },
        world: 'MAIN',
      });
      return { requests: results[0]?.result || [] };
    }

    // --- Notes actions ---

    case 'notes_list': {
      const notes = sortNotes(await getNotes());
      return {
        notes: notes.map((n) => ({
          id: n.id,
          title: n.title,
          pinned: n.pinned,
          createdAt: n.createdAt,
          updatedAt: n.updatedAt,
          preview: (n.content || '').slice(0, 200),
          imageCount: ((n.content || '').match(/!\[[^\]]*\]\(sbn:[a-z0-9_]+\)/g) || []).length,
        })),
      };
    }

    case 'notes_get': {
      const notes = await getNotes();
      const note = notes.find((n) => n.id === params.id);
      if (!note) throw new Error(`Note not found: ${params.id}`);

      // Extract image IDs from content
      const imageRefs = [...(note.content || '').matchAll(/!\[([^\]]*)\]\(sbn:([a-z0-9_]+)\)/g)];
      const images = imageRefs.map((m) => ({ alt: m[1], imageId: m[2] }));

      return { ...note, images };
    }

    case 'notes_create': {
      const notes = await getNotes();
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const newNote = {
        id,
        title: params.title || '',
        content: params.content || '',
        pinned: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      notes.unshift(newNote);
      await saveNotes(notes);
      return { created: true, id, note: newNote };
    }

    case 'notes_update': {
      const notes = await getNotes();
      const idx = notes.findIndex((n) => n.id === params.id);
      if (idx === -1) throw new Error(`Note not found: ${params.id}`);
      if (params.title !== undefined) notes[idx].title = params.title;
      if (params.content !== undefined) notes[idx].content = params.content;
      notes[idx].updatedAt = Date.now();
      await saveNotes(notes);
      return { updated: true, id: params.id };
    }

    case 'notes_delete': {
      let notes = await getNotes();
      const exists = notes.some((n) => n.id === params.id);
      if (!exists) throw new Error(`Note not found: ${params.id}`);
      notes = notes.filter((n) => n.id !== params.id);
      await saveNotes(notes);
      return { deleted: true, id: params.id };
    }

    case 'notes_image': {
      const record = await getImage(params.imageId);
      if (!record) throw new Error(`Image not found: ${params.imageId}`);
      const base64 = await blobToBase64(record.blob);
      return {
        imageId: params.imageId,
        base64,
        type: record.type,
        size: record.size,
        encoding: 'base64',
      };
    }

    case 'notes_search': {
      const notes = await getNotes();
      const query = (params.query || '').toLowerCase();
      const matches = notes.filter((n) =>
        (n.title || '').toLowerCase().includes(query) ||
        (n.content || '').toLowerCase().includes(query)
      );
      return {
        notes: sortNotes(matches).map((n) => ({
          id: n.id,
          title: n.title,
          pinned: n.pinned,
          updatedAt: n.updatedAt,
          preview: (n.content || '').slice(0, 200),
        })),
      };
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

export function initBridge(ws) {
  // Register this connection as the browser bridge
  ws.send(JSON.stringify({ type: 'register-bridge' }));

  // Return a handler function for incoming messages
  return async function onBridgeMessage(msg) {
    if (msg.type !== 'browser-cmd') return false;

    try {
      const data = await handleAction(msg.action, msg.params || {});
      ws.send(JSON.stringify({ type: 'browser-result', id: msg.id, data }));
    } catch (err) {
      ws.send(JSON.stringify({ type: 'browser-result', id: msg.id, error: err.message }));
    }
    return true;
  };
}
