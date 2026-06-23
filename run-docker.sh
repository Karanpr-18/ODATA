#!/bin/bash
echo "Starting the application using Docker Compose..."
docker compose up --build -d

echo "Waiting for backend service to initialize..."
sleep 5

echo "Syncing SAP OData metadata database inside the container..."
docker exec sap-backend python scripts/sync_odata.py

echo "Application started! You can access the UI at http://localhost:3030"
