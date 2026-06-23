@echo off
echo 1. Launching SurrealDB & Ollama containers...
docker compose up -d surrealdb ollama ollama-pull

echo 2. Launching Backend FastAPI...
start "FastAPI Backend" cmd /c "cd backend && call venv\Scripts\activate && uvicorn app.main:app --reload --port 8080"

echo 3. Launching Frontend Next.js...
start "Next.js Frontend" cmd /c "cd frontend && npm run dev"

echo ----------------------------------------
echo Application started!
echo - Frontend UI: http://localhost:3030
echo - Backend API: http://localhost:8080
echo Close the separate command prompt windows to stop the services.
echo ----------------------------------------
pause
