"""
FastAPI Application Entry Point

Sets up CORS, lifespan events (DB connect/disconnect),
and includes all route modules.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routes.chat import router as chat_router
from app.routes.threads import router as threads_router
from app.services.db_client import get_db

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: connect to SurrealDB on startup, close on shutdown."""
    settings = get_settings()
    db = get_db()

    logger.info("=" * 60)
    logger.info("  SAP OData Chatbot — Backend Starting")
    logger.info("=" * 60)
    logger.info("  SurrealDB: %s", settings.surreal_url)
    logger.info("  Ollama:    %s (%s)", settings.ollama_base_url, settings.ollama_model)
    logger.info("  Groq:      %s", settings.groq_default_model)
    logger.info("=" * 60)

    try:
        await db.connect()
        logger.info("SurrealDB connected successfully")
    except Exception as e:
        logger.warning("SurrealDB not available (will retry on first query): %s", e)

    yield

    # Shutdown
    await db.close()
    logger.info("Application shutdown complete")


# ── Create FastAPI App ──
app = FastAPI(
    title="SAP OData Chatbot API",
    description="Enterprise AI chatbot for querying SAP OData services using natural language",
    version="0.1.0",
    lifespan=lifespan,
)

# ── CORS Middleware ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3030",    # New Next.js dev port
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3030",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Register Routes ──
app.include_router(chat_router, tags=["Chat"])
app.include_router(threads_router, tags=["Threads"])


# ── Health Check ──
@app.get("/health")
async def health_check():
    """Health check endpoint."""
    settings = get_settings()
    return {
        "status": "healthy",
        "service": "sap-odata-chatbot",
        "version": "0.1.0",
        "config": {
            "groq_model": settings.groq_default_model,
            "ollama_model": settings.ollama_model,
            "surreal_url": settings.surreal_url,
        },
    }


# ── Model List ──
@app.get("/api/models")
async def list_models():
    """Return available Groq models for the frontend selector."""
    settings = get_settings()
    return {"models": settings.available_models}
