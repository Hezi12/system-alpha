#!/bin/bash

echo "Stopping SYSTEM_ALPHA..."

if lsof -ti:4000 > /dev/null 2>&1; then
    lsof -ti:4000 | xargs kill -9 2>/dev/null
    echo "Backend stopped"
else
    echo "Backend was not running"
fi

if lsof -ti:5173 > /dev/null 2>&1; then
    lsof -ti:5173 | xargs kill -9 2>/dev/null
    echo "Vite stopped"
else
    echo "Vite was not running"
fi

rm -f /tmp/system_alpha_*.log 2>/dev/null

echo ""
echo "SYSTEM_ALPHA stopped."
