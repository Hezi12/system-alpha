#!/bin/bash

echo "🔥 Starting SYSTEM_ALPHA..."

# Navigate to project directory
cd "$(dirname "$0")"

echo ""
echo "🧹 Cleaning up old processes..."
# Kill any existing processes
lsof -ti:4000 | xargs kill -9 2>/dev/null
lsof -ti:5173 | xargs kill -9 2>/dev/null
pkill -f "Electron" 2>/dev/null

sleep 1

# Start Backend
echo "🐍 Starting Python Backend..."
cd backend
source venv/bin/activate
python3 -m uvicorn app.main:app --host 0.0.0.0 --port 4000 > /tmp/system_alpha_backend.log 2>&1 &
BACKEND_PID=$!
cd ..

# Wait for backend to be ready
echo "⏳ Waiting for Backend to start..."
for i in {1..30}; do
    if curl -s http://localhost:4000/status > /dev/null 2>&1; then
        echo "✅ Backend is ready!"
        break
    fi
    sleep 1
done

# Start Vite
echo "⚡ Starting Vite Dev Server..."
npm run dev > /tmp/system_alpha_vite.log 2>&1 &
VITE_PID=$!

# Wait for Vite to be ready
echo "⏳ Waiting for Vite to start..."
for i in {1..30}; do
    if curl -s http://localhost:5173 > /dev/null 2>&1; then
        echo "✅ Vite is ready!"
        break
    fi
    sleep 1
done

# Start Electron
echo "🖥️  Starting Electron Frontend..."
npx electron . > /tmp/system_alpha_frontend.log 2>&1 &
ELECTRON_PID=$!

echo ""
echo "✅ SYSTEM_ALPHA is running!"
echo ""
echo "📊 Backend:  http://localhost:4000"
echo "⚡ Vite:     http://localhost:5173"
echo "🖥️  Frontend: Electron App"
echo ""
echo "📝 Logs:"
echo "   Backend:  tail -f /tmp/system_alpha_backend.log"
echo "   Vite:     tail -f /tmp/system_alpha_vite.log"
echo "   Frontend: tail -f /tmp/system_alpha_frontend.log"
echo ""
echo "🛑 To stop: ./stop.sh"
echo ""
