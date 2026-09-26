#!/usr/bin/env bash

# MultiFeed macOS Auto-Start Removal
PLIST_FILE="$HOME/Library/LaunchAgents/com.multifeed.service.plist"

if [ -f "$PLIST_FILE" ]; then
  launchctl unload "$PLIST_FILE" 2>/dev/null || true
  rm -f "$PLIST_FILE"
  echo "🛑 MultiFeed auto-start on Mac boot has been disabled and removed."
else
  echo "ℹ️ MultiFeed auto-start was not installed."
fi
