#!/bin/bash

echo "🛑 Stopping SYSTEM_ALPHA..."

# Kill Backend (Python/Uvicorn)
if lsof -ti:4000 > /dev/null 2>&1; then
    lsof -ti:4000 | xargs kill -9 2>/dev/null
    echo "✅ Backend stopped"
else
    echo "ℹ️  Backend was not running"
fi

# Kill Vite
if lsof -ti:5173 > /dev/null 2>&1; then
    lsof -ti:5173 | xargs kill -9 2>/dev/null
    echo "✅ Vite stopped"
else
    echo "ℹ️  Vite was not running"
fi

# Kill Electron
if pgrep -f "Electron" > /dev/null 2>&1; then
    pkill -9 -f "Electron" 2>/dev/null
    echo "✅ Frontend stopped"
else
    echo "ℹ️  Frontend was not running"
fi

# Clean up log files
rm -f /tmp/system_alpha_*.log 2>/dev/null

echo ""
echo "✅ SYSTEM_ALPHA stopped successfully!"
