#!/usr/bin/env node
// MCP Server — exposes browser control as tools for AI agents
// Connects to the terminal server's HTTP API on localhost:8768

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const http = require('http');

const BASE = 'http://localhost:8768/api';

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ raw: data });
        }
      });
    });
    req.on('error', (err) => reject(err));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function callApi(method, path, body) {
  try {
    const result = await request(method, path, body);
    if (result.error) {
      return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true };
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `Connection error: ${err.message}. Is the terminal server running?` }], isError: true };
  }
}

const server = new McpServer({
  name: 'browser-control',
  version: '1.0.0',
});

server.tool(
  'browser_eval',
  'Execute JavaScript code in the active browser tab and return the result',
  { code: z.string().describe('JavaScript code to evaluate in the page context') },
  async ({ code }) => callApi('POST', '/api/eval', { code })
);

server.tool(
  'browser_dom',
  'Get the outerHTML of elements matching a CSS selector in the active tab',
  { selector: z.string().describe('CSS selector to match elements') },
  async ({ selector }) => callApi('POST', '/api/dom', { selector })
);

server.tool(
  'browser_click',
  'Click an element matching a CSS selector in the active tab',
  { selector: z.string().describe('CSS selector of the element to click') },
  async ({ selector }) => callApi('POST', '/api/click', { selector })
);

server.tool(
  'browser_type',
  'Type text into an input element matching a CSS selector in the active tab',
  {
    selector: z.string().describe('CSS selector of the input element'),
    text: z.string().describe('Text to type into the element'),
  },
  async ({ selector, text }) => callApi('POST', '/api/type', { selector, text })
);

server.tool(
  'browser_screenshot',
  'Capture a screenshot of the visible area of the active browser tab. Returns base64 PNG.',
  {},
  async () => callApi('GET', '/api/screenshot')
);

server.tool(
  'browser_url',
  'Get the URL and title of the active browser tab',
  {},
  async () => callApi('GET', '/api/url')
);

server.tool(
  'browser_console',
  'Get captured console logs from the active browser tab. First call injects the capture script; subsequent calls return new logs since last retrieval.',
  {},
  async () => callApi('GET', '/api/console')
);

server.tool(
  'browser_navigate',
  'Navigate the active browser tab to a URL',
  { url: z.string().describe('URL to navigate to') },
  async ({ url }) => callApi('POST', '/api/navigate', { url })
);

server.tool(
  'browser_content',
  'Get the text content and HTML of the active browser tab. Returns title, url, text, and html of the main content area.',
  {},
  async () => callApi('GET', '/api/content')
);

server.tool(
  'browser_interactive_elements',
  'Get all interactive elements (links, buttons, inputs, etc.) from the active tab with their selectors, text, and attributes. Useful for understanding what can be clicked or filled.',
  {},
  async () => callApi('GET', '/api/interactive')
);

server.tool(
  'browser_tabs',
  'List all open browser tabs with their IDs, URLs, titles, and active status',
  {},
  async () => callApi('GET', '/api/tabs')
);

server.tool(
  'browser_close_tab',
  'Close a browser tab by its ID. If no ID given, closes the active tab.',
  { tabId: z.number().optional().describe('Tab ID to close. Omit to close the active tab.') },
  async ({ tabId }) => callApi('POST', '/api/close_tab', { tabId })
);

server.tool(
  'browser_back',
  'Navigate back in browser history on the active tab',
  {},
  async () => callApi('POST', '/api/back')
);

server.tool(
  'browser_forward',
  'Navigate forward in browser history on the active tab',
  {},
  async () => callApi('POST', '/api/forward')
);

server.tool(
  'browser_keyboard',
  'Simulate a keyboard key press on the active tab. Supports modifiers like ctrl, shift, alt, meta.',
  {
    key: z.string().describe('Key to press (e.g., "Enter", "Escape", "a", "Tab")'),
    modifiers: z.array(z.enum(['ctrl', 'shift', 'alt', 'meta'])).optional().describe('Modifier keys to hold'),
  },
  async ({ key, modifiers }) => callApi('POST', '/api/keyboard', { key, modifiers: modifiers || [] })
);

server.tool(
  'browser_hover',
  'Hover over an element matching a CSS selector in the active tab. Triggers mouseenter/mouseover/mousemove events.',
  { selector: z.string().describe('CSS selector of the element to hover') },
  async ({ selector }) => callApi('POST', '/api/hover', { selector })
);

server.tool(
  'browser_wait',
  'Wait for an element or text to appear on the page. Returns when found or after timeout.',
  {
    selector: z.string().optional().describe('CSS selector to wait for'),
    text: z.string().optional().describe('Text content to wait for on the page'),
    timeout: z.number().optional().describe('Max wait time in ms (default 5000)'),
  },
  async ({ selector, text, timeout }) => callApi('POST', '/api/wait', { selector, text, timeout })
);

server.tool(
  'browser_fill_form',
  'Fill multiple form fields at once. Each field needs a selector and value.',
  {
    fields: z.array(z.object({
      selector: z.string().describe('CSS selector of the form field'),
      value: z.string().describe('Value to fill'),
    })).describe('Array of {selector, value} objects'),
  },
  async ({ fields }) => callApi('POST', '/api/fill_form', { fields })
);

server.tool(
  'browser_network',
  'Get captured network requests (fetch and XHR) from the active tab. First call injects capture; subsequent calls return new requests.',
  {},
  async () => callApi('GET', '/api/network')
);

// --- Notes tools ---

server.tool(
  'notes_list',
  'List all notes with their IDs, titles, pin status, timestamps, content preview, and image count',
  {},
  async () => callApi('GET', '/api/notes')
);

server.tool(
  'notes_get',
  'Get the full content of a note by ID. Returns title, content (markdown), timestamps, and list of embedded image IDs.',
  { id: z.string().describe('Note ID') },
  async ({ id }) => callApi('POST', '/api/notes/get', { id })
);

server.tool(
  'notes_create',
  'Create a new note with optional title and markdown content',
  {
    title: z.string().optional().describe('Note title'),
    content: z.string().optional().describe('Note content in markdown'),
  },
  async ({ title, content }) => callApi('POST', '/api/notes', { title, content })
);

server.tool(
  'notes_update',
  'Update an existing note. Can update title, content, or both.',
  {
    id: z.string().describe('Note ID to update'),
    title: z.string().optional().describe('New title'),
    content: z.string().optional().describe('New markdown content'),
  },
  async ({ id, title, content }) => callApi('POST', '/api/notes/update', { id, title, content })
);

server.tool(
  'notes_delete',
  'Delete a note by ID',
  { id: z.string().describe('Note ID to delete') },
  async ({ id }) => callApi('POST', '/api/notes/delete', { id })
);

server.tool(
  'notes_image',
  'Get an image embedded in a note by its image ID. Returns base64-encoded image data with MIME type. Use notes_get first to find image IDs in a note.',
  { imageId: z.string().describe('Image ID (e.g., img_xyz123_abc456)') },
  async ({ imageId }) => callApi('POST', '/api/notes/image', { imageId })
);

server.tool(
  'notes_search',
  'Search notes by title or content. Returns matching notes with previews.',
  { query: z.string().describe('Search query') },
  async ({ query }) => callApi('POST', '/api/notes/search', { query })
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('MCP server error:', err);
  process.exit(1);
});
