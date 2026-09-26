#!/usr/bin/env bash

# MultiFeed macOS Auto-Start Setup
set -e

PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_FILE="$PLIST_DIR/com.multifeed.service.plist"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$PLIST_DIR"

cat << PLIST_EOF > "$PLIST_FILE"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.multifeed.service</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$SCRIPT_DIR/run.sh</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$SCRIPT_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$SCRIPT_DIR/multifeed.log</string>
    <key>StandardErrorPath</key>
    <string>$SCRIPT_DIR/multifeed.err.log</string>
</dict>
</plist>
PLIST_EOF

launchctl unload "$PLIST_FILE" 2>/dev/null || true
launchctl load "$PLIST_FILE"

echo "======================================================="
echo "✅ MultiFeed auto-start on Mac boot has been enabled!"
echo "   - Plist configuration : $PLIST_FILE"
echo "   - App Directory       : $SCRIPT_DIR"
echo "   - Logs output         : $SCRIPT_DIR/multifeed.log"
echo "======================================================="
