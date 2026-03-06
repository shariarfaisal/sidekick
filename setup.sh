#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$SCRIPT_DIR/terminal-server"
SERVICE_NAME="com.sidekick.server"

echo "=== Sidekick Setup ==="
echo ""

# 1. Install dependencies
echo "[1/4] Installing dependencies..."
cd "$SCRIPT_DIR" && npm install --silent
cd "$SERVER_DIR" && npm install --silent

# 2. Build extension
echo "[2/4] Building extension..."
cd "$SCRIPT_DIR" && npm run build --silent

# 3. Install background service
echo "[3/4] Installing background server..."

if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS: launchd
  PLIST_DIR="$HOME/Library/LaunchAgents"
  PLIST_FILE="$PLIST_DIR/$SERVICE_NAME.plist"
  LOG_DIR="$HOME/Library/Logs/sidekick"
  mkdir -p "$PLIST_DIR" "$LOG_DIR"

  # Stop existing service if running
  launchctl bootout "gui/$(id -u)/$SERVICE_NAME" 2>/dev/null || true

  cat > "$PLIST_FILE" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$SERVICE_NAME</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(which node)</string>
    <string>$SERVER_DIR/server.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$SERVER_DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$(dirname "$(which node)"):$(dirname "$(which gh)" 2>/dev/null || echo "/usr/local/bin"):/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
PLIST

  launchctl bootstrap "gui/$(id -u)" "$PLIST_FILE"
  echo "  Server installed as macOS Launch Agent"
  echo "  Logs: $LOG_DIR/"

elif [[ "$OSTYPE" == "linux"* ]]; then
  # Linux: systemd user service
  SERVICE_DIR="$HOME/.config/systemd/user"
  SERVICE_FILE="$SERVICE_DIR/$SERVICE_NAME.service"
  mkdir -p "$SERVICE_DIR"

  cat > "$SERVICE_FILE" <<SERVICE
[Unit]
Description=Sidekick Server
After=network.target

[Service]
Type=simple
ExecStart=$(which node) $SERVER_DIR/server.js
WorkingDirectory=$SERVER_DIR
Restart=on-failure
RestartSec=5
Environment=PATH=$(dirname "$(which node)"):$(dirname "$(which gh)" 2>/dev/null || echo "/usr/local/bin"):/usr/bin:/bin

[Install]
WantedBy=default.target
SERVICE

  systemctl --user daemon-reload
  systemctl --user enable "$SERVICE_NAME"
  systemctl --user restart "$SERVICE_NAME"
  echo "  Server installed as systemd user service"
  echo "  Logs: journalctl --user -u $SERVICE_NAME"

else
  echo "  Unsupported OS. Start the server manually:"
  echo "    cd terminal-server && npm start"
fi

# 4. Done
echo "[4/4] Done!"
echo ""
echo "=== Next Steps ==="
echo "1. Open chrome://extensions/"
echo "2. Enable Developer mode"
echo "3. Click 'Load unpacked' → select: $SCRIPT_DIR/dist/"
echo "4. Click the extension icon to open the side panel"
echo ""
echo "The server runs automatically in the background."
echo "To uninstall the service, run: ./uninstall.sh"
