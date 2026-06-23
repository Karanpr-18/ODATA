@echo off
echo Starting the application using Docker Compose...
docker compose up --build -d
echo Application started! You can access the UI at http://localhost:3030
pause
