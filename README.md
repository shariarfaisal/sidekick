# Sidekick

A Chrome extension that provides a minimal markdown note-taking editor, AI writing assistant, and a built-in terminal in the browser's side panel.

## Features

- **Markdown Editor** — Rich text editing powered by TipTap with full markdown support, code blocks with syntax highlighting, images, task lists, and links
- **Note Management** — Create, search, pin, duplicate, and delete notes with auto-save and persistent storage via Chrome Storage API
- **AI Writing Assistant** — Inline AI actions (rewrite, summarize, expand, fix grammar) on selected text, plus a chat panel for asking questions about your notes. Powered by GitHub Models with 10 model choices including GPT-5, GPT-4.1, o4-mini, DeepSeek R1, and Llama 3.1 405B
- **Built-in Terminal** — Integrated xterm.js terminal with multiple tabs, connected to a local shell via WebSocket + node-pty
- **Dark / Light Themes** — Toggle between themes; terminal colors update to match

## Tech Stack

- **Build:** Vite
- **Editor:** TipTap, lowlight
- **Terminal:** xterm.js, node-pty, WebSocket
- **AI:** GitHub Models API (free tier, streamed via SSE)
- **Platform:** Chrome Extensions Manifest V3

## Quick Start

### Prerequisites

- Node.js (v18+)
- Google Chrome
- [GitHub CLI](https://cli.github.com/) (`gh`) — required for AI features

### One-Command Setup

```bash
git clone <repo-url> && cd sidekick
gh auth login          # authenticate for AI features (one-time)
./setup.sh             # installs deps, builds, starts background server
```

That's it. The setup script:
1. Installs all npm dependencies
2. Builds the extension to `dist/`
3. Registers a background service that starts the server automatically on login

### Load in Chrome

1. Go to `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `dist/` directory

The server runs at `http://localhost:8768` in the background — no need to start it manually.

### Uninstall

```bash
./uninstall.sh         # stops and removes the background service
```

## AI Features

The AI proxy uses your local `gh auth token` at runtime — no API keys are stored in the codebase.

- **Inline actions:** Select text in a note → format toolbar shows AI buttons (Rewrite, Summarize, Expand, Fix Grammar)
- **Chat panel:** Click the sparkle icon in the topbar → ask questions about your note
- **Model selection:** Choose from 10 models in the chat panel dropdown

Supported platforms: **macOS** (launchd) and **Linux** (systemd).

## MCP Setup (AI Agent Integration)

Sidekick includes an MCP (Model Context Protocol) server that lets AI agents like Claude and GitHub Copilot control your browser and manage your notes programmatically. The MCP server exposes tools for browser automation (click, type, navigate, screenshot, etc.) and full notes CRUD.

### For Claude Code (CLI)

The project already includes a `.mcp.json` file, so Claude Code will auto-detect it when you run `claude` from the project directory. No extra setup needed.

To add it manually to Claude Code's global config (`~/.claude.json`):

```json
{
  "mcpServers": {
    "browser-control": {
      "command": "node",
      "args": ["/absolute/path/to/sidekick/terminal-server/mcp-server.js"]
    }
  }
}
```

### For Claude Desktop

Add the following to your Claude Desktop config file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "browser-control": {
      "command": "node",
      "args": ["/absolute/path/to/sidekick/terminal-server/mcp-server.js"]
    }
  }
}
```

### For GitHub Copilot (VS Code)

1. Open VS Code Settings (`Cmd+,` / `Ctrl+,`)
2. Search for `github.copilot.chat.mcpServers`
3. Click **Edit in settings.json** and add:

```json
{
  "github.copilot.chat.mcpServers": {
    "browser-control": {
      "command": "node",
      "args": ["/absolute/path/to/sidekick/terminal-server/mcp-server.js"]
    }
  }
}
```

Alternatively, create a `.vscode/mcp.json` file in the project root:

```json
{
  "servers": {
    "browser-control": {
      "command": "node",
      "args": ["${workspaceFolder}/terminal-server/mcp-server.js"]
    }
  }
}
```

### Available MCP Tools

| Category | Tools |
|----------|-------|
| **Browser** | `browser_eval`, `browser_dom`, `browser_click`, `browser_type`, `browser_screenshot`, `browser_url`, `browser_navigate`, `browser_content`, `browser_interactive_elements`, `browser_tabs`, `browser_close_tab`, `browser_back`, `browser_forward`, `browser_keyboard`, `browser_hover`, `browser_wait`, `browser_fill_form`, `browser_network`, `browser_console` |
| **Notes** | `notes_list`, `notes_get`, `notes_create`, `notes_update`, `notes_delete`, `notes_image`, `notes_search` |

> **Note:** The terminal server must be running (`./setup.sh` sets it up as a background service) for MCP tools to work.

## Development

```bash
npm run dev      # Start Vite dev server
npm run build    # Production build to dist/
npm run preview  # Preview production build
```

To run the server manually (instead of the background service):

```bash
cd terminal-server && npm start
```

## Project Structure

```
src/
├── main.js          # App initialization & view switching
├── editor.js        # TipTap editor setup
├── ai.js            # AI client (SSE streaming, inline actions, chat)
├── chat.js          # Multi-terminal management & WebSocket
├── notes.js         # Note CRUD & utilities
├── ui.js            # UI event handlers & rendering
├── storage.js       # Chrome storage wrapper
├── theme.js         # Theme management
├── sidepanel.html   # Main HTML
└── styles/          # CSS (main, editor, chat, themes)
terminal-server/
└── server.js        # HTTP + WebSocket server (terminal + AI proxy)
setup.sh             # One-command install & background service setup
uninstall.sh         # Remove background service
public/
├── manifest.json    # Chrome extension manifest
└── icons/           # Extension icons
```

## License

MIT
