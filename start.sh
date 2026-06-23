#!/usr/bin/env bash
# BloomAI v0.2 Quick Start Script
set -e

echo "🌸 BloomAI v0.2 - Starting..."
echo ""

# Check Node.js runtime
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
WEB_PORT=5174
SERVER_PID=""
WEB_PID=""

cd "$SCRIPT_DIR"

# Install root dependencies if needed
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm install --legacy-peer-deps --ignore-scripts --silent
fi

# Build app if needed
if [ ! -f "$SCRIPT_DIR/dist/index.html" ]; then
  echo "🔨 Building BloomAI..."
  npm run build
fi

# Kill any existing server on port
if command -v lsof >/dev/null 2>&1; then
  lsof -ti :$SERVER_PORT | xargs kill -9 2>/dev/null || true
fi
sleep 0.5

# Start server
echo "🚀 Starting server on port $SERVER_PORT..."
npm run start:server &
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
if [ -f "$SCRIPT_DIR/dist/index.html" ]; then
  echo "🌐 Opening in browser..."
  npx vite preview --host 127.0.0.1 --port "$WEB_PORT" &
  WEB_PID=$!
  if command -v open &> /dev/null; then
    # macOS
    sleep 1
    open "http://127.0.0.1:$WEB_PORT"
  elif command -v xdg-open &> /dev/null; then
    # Linux
    sleep 1
    xdg-open "http://127.0.0.1:$WEB_PORT"
  else
    echo "📌 Open your browser at: http://127.0.0.1:$WEB_PORT"
  fi
else
  echo "📌 Build not found. Starting dev server..."
  echo "🔧 Starting Vite dev server..."
  npm run dev &
  WEB_PID=$!
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
trap "echo ''; echo 'Stopping...'; kill $WEB_PID 2>/dev/null; kill $SERVER_PID 2>/dev/null; echo 'Done. Goodbye 🌸'; exit 0" INT TERM
wait $SERVER_PID
