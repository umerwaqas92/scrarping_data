#!/usr/bin/env bash

# MultiFeed Lead Intelligence Platform Launcher
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "======================================================="
echo " 🌐 Starting MultiFeed Lead Intelligence Platform"
echo "======================================================="

# Check environment file
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    echo "⚠️  .env file not found. Creating from .env.example..."
    cp .env.example .env
  else
    echo "⚠️  Warning: .env file missing."
  fi
fi

# Ensure root dependencies are installed
if [ ! -d "node_modules" ]; then
  echo "📦 Installing root backend dependencies..."
  npm install
fi

# Ensure client dependencies are installed
if [ ! -d "client/node_modules" ]; then
  echo "📦 Installing client frontend dependencies..."
  (cd client && npm install)
fi

# Cleanup child processes on exit
cleanup() {
  echo ""
  echo "🛑 Stopping all MultiFeed servers..."
  kill $(jobs -p) 2>/dev/null || true
  exit 0
}

trap cleanup SIGINT SIGTERM EXIT

echo "🚀 Launching Backend API & WebSocket Server..."
npm run dev &
BACKEND_PID=$!

echo "🚀 Launching Frontend React App (Vite)..."
(cd client && npm run dev) &
FRONTEND_PID=$!

echo ""
echo "✨ All services started successfully!"
echo "   - Backend API & WebSocket : http://localhost:3001"
echo "   - Frontend Web Dashboard   : http://localhost:5174"
echo "   - Chrome Extension Folder : $DIR/extension"
echo ""
echo "Press [CTRL + C] to stop all services."
echo "======================================================="

# Keep script running
wait
