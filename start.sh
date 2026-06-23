#!/usr/bin/env bash
# BloomAI v0.1 — Quick Start Script
set -e

echo "🌸 BloomAI v0.1 — Starting..."
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "❌ Node.js not found. Please install Node.js 20+ from https://nodejs.org"
  exit 1
fi

NODE_VER=$(node --version | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 20 ]; then
  echo "❌ Node.js 20+ required. Current: $(node --version)"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_PORT=3718

# Install server deps if needed
if [ ! -d "$SCRIPT_DIR/packages/server/node_modules" ]; then
  echo "📦 Installing server dependencies..."
  cd "$SCRIPT_DIR/packages/server"
  npm install --legacy-peer-deps --ignore-scripts --silent
fi

# Build server if needed
if [ ! -f "$SCRIPT_DIR/packages/server/dist/index.js" ]; then
  echo "🔨 Building server..."
  cd "$SCRIPT_DIR/packages/server"
  npx tsc --silent
fi

# Kill any existing server on port
lsof -ti :$SERVER_PORT | xargs kill -9 2>/dev/null || true
sleep 0.5

# Start server
echo "🚀 Starting server on port $SERVER_PORT..."
cd "$SCRIPT_DIR/packages/server"
node dist/index.js &
SERVER_PID=$!

# Wait for server
sleep 2
if ! curl -s http://127.0.0.1:$SERVER_PORT/health > /dev/null; then
  echo "❌ Server failed to start"
  kill $SERVER_PID 2>/dev/null
  exit 1
fi

echo "✅ Server running at http://127.0.0.1:$SERVER_PORT"
echo ""

# Check if dist exists for web mode
if [ -f "$SCRIPT_DIR/apps/desktop/dist/index.html" ]; then
  echo "🌐 Opening in browser..."
  if command -v open &> /dev/null; then
    # macOS
    cd "$SCRIPT_DIR/apps/desktop"
    npx serve dist -p 5174 &
    sleep 1
    open http://localhost:5174
  elif command -v xdg-open &> /dev/null; then
    # Linux
    cd "$SCRIPT_DIR/apps/desktop"
    npx serve dist -p 5174 &
    sleep 1
    xdg-open http://localhost:5174
  else
    echo "📌 Open your browser at: http://localhost:5174"
    cd "$SCRIPT_DIR/apps/desktop"
    npx serve dist -p 5174 &
  fi
else
  echo "📌 Build not found. Starting dev server..."
  if [ ! -d "$SCRIPT_DIR/apps/desktop/node_modules" ]; then
    echo "📦 Installing desktop dependencies..."
    cd "$SCRIPT_DIR/apps/desktop"
    npm install --legacy-peer-deps --ignore-scripts --silent
  fi
  cd "$SCRIPT_DIR/apps/desktop"
  echo "🔧 Starting Vite dev server..."
  npx vite &
  sleep 2
  echo "📌 Open: http://localhost:5173"
fi

echo ""
echo "=========================================="
echo "  🌸 BloomAI is running!"
echo "  Configure your API key in Settings (⌘,)"
echo "  Press Ctrl+C to stop all services"
echo "=========================================="

# Wait for interrupt
trap "echo ''; echo 'Stopping...'; kill $SERVER_PID 2>/dev/null; pkill -f 'npx serve' 2>/dev/null; pkill -f 'vite' 2>/dev/null; echo 'Done. Goodbye 🌸'; exit 0" INT TERM
wait $SERVER_PID
