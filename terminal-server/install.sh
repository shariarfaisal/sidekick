#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Installing Sidekick terminal server..."

# Check for node
if ! command -v node &> /dev/null; then
  echo "Error: node is required. Install Node.js first."
  exit 1
fi

echo "Using node: $(which node) ($(node --version))"

# Install dependencies
cd "$SCRIPT_DIR"
npm install

# Fix node-pty spawn-helper permissions (known issue on macOS)
SPAWN_HELPER="$SCRIPT_DIR/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper"
if [ -f "$SPAWN_HELPER" ]; then
  chmod +x "$SPAWN_HELPER"
  echo "Fixed spawn-helper permissions (darwin-arm64)"
fi
SPAWN_HELPER_X64="$SCRIPT_DIR/node_modules/node-pty/prebuilds/darwin-x64/spawn-helper"
if [ -f "$SPAWN_HELPER_X64" ]; then
  chmod +x "$SPAWN_HELPER_X64"
  echo "Fixed spawn-helper permissions (darwin-x64)"
fi

echo ""
echo "Installation complete!"
echo ""
echo "To start the terminal server:"
echo "  cd $SCRIPT_DIR && npm start"
echo ""
echo "The server runs on ws://localhost:8768"
echo "Open the Sidekick extension and switch to the Terminal tab."
