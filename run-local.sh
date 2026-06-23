#!/bin/bash

# Terminate background jobs on exit
cleanup() {
    echo ""
    echo "Stopping backend and frontend..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    exit
}
trap cleanup SIGINT SIGTERM

echo "1. Launching SurrealDB & Ollama containers..."
docker compose up -d surrealdb ollama ollama-pull

echo "2. Launching Backend FastAPI (on port 8080)..."
cd backend
source venv/bin/activate
uvicorn app.main:app --reload --port 8080 &
BACKEND_PID=$!
cd ..

echo "3. Launching Frontend Next.js Dev Server (on port 3030)..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

echo "----------------------------------------"
echo "Application started!"
echo "- Frontend UI: http://localhost:3030"
echo "- Backend API: http://localhost:8080"
echo "Press Ctrl+C to terminate the services."
echo "----------------------------------------"

# Keep the script running to wait for Ctrl+C
wait
