#!/bin/bash

SERVICE_NAME="com.sidekick.server"

echo "=== Sidekick Uninstall ==="

if [[ "$OSTYPE" == "darwin"* ]]; then
  launchctl bootout "gui/$(id -u)/$SERVICE_NAME" 2>/dev/null && echo "Service stopped." || echo "Service was not running."
  PLIST_FILE="$HOME/Library/LaunchAgents/$SERVICE_NAME.plist"
  rm -f "$PLIST_FILE" && echo "Launch Agent removed."
  echo "Logs at ~/Library/Logs/sidekick/ (remove manually if desired)."

elif [[ "$OSTYPE" == "linux"* ]]; then
  systemctl --user stop "$SERVICE_NAME" 2>/dev/null
  systemctl --user disable "$SERVICE_NAME" 2>/dev/null
  rm -f "$HOME/.config/systemd/user/$SERVICE_NAME.service"
  systemctl --user daemon-reload
  echo "Systemd service removed."
fi

echo ""
echo "Server uninstalled. Extension files are still in dist/."
echo "Remove the extension from chrome://extensions/ manually."
