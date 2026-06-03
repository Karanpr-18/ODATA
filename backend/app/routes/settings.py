"""
Settings API Routes

Provides endpoints for managing application settings:
- LLM provider configuration (API keys, models, fallback)
- OData service management (add/delete/join)
"""

import logging
import json
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.db_client import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/settings")


# ── Pydantic Models ──

class LLMConfig(BaseModel):
    """LLM provider configuration."""
    provider: str = ""
    api_key: str = ""
    base_url: str = ""
    active_model: str = ""
    fallback_model: str = ""


class ServiceConfig(BaseModel):
    """An external OData service configuration."""
    name: str
    url: str
    description: str = ""


class JoinConfig(BaseModel):
    """A join relationship between two service tables."""
    source_service: str
    target_service: str
    source_table: str
    target_table: str
    join_key: str


class SettingsPayload(BaseModel):
    """Full settings payload for update operations."""
    llm: Optional[LLMConfig] = None
    services: Optional[List[ServiceConfig]] = None
    joins: Optional[List[JoinConfig]] = None


# ── Endpoints ──

@router.get("")
async def get_settings():
    """Retrieve current application settings from SurrealDB."""
    db = get_db()
    try:
        results = await db.query("SELECT * FROM settings WHERE id = settings:config;")
        if results and isinstance(results, list) and len(results) > 0:
            record = results[0]
            return {
                "llm": record.get("llm", {
                    "provider": "",
                    "api_key": "",
                    "base_url": "",
                    "active_model": "",
                    "fallback_model": ""
                }),
                "services": record.get("services", []),
                "joins": record.get("joins", []),
            }
    except Exception as e:
        logger.warning("Failed to fetch settings from SurrealDB: %s", e)

    # Return defaults if no record exists
    return {
        "llm": {
            "provider": "",
            "api_key": "",
            "base_url": "",
            "active_model": "",
            "fallback_model": ""
        },
        "services": [],
        "joins": [],
    }


@router.put("")
async def update_settings(payload: SettingsPayload):
    """Create or update application settings in SurrealDB."""
    db = get_db()
    data = payload.model_dump(exclude_none=True)

    try:
        # Upsert: try to update, create if missing
        existing = await db.query("SELECT * FROM settings WHERE id = settings:config;")
        if existing and isinstance(existing, list) and len(existing) > 0:
            await db.query(
                f"UPDATE settings:config MERGE {json.dumps(data)};"
            )
        else:
            await db.query(
                f"CREATE settings:config CONTENT {json.dumps(data)};"
            )

        logger.info("Settings updated successfully")
        return {"status": "success", "settings": data}

    except Exception as e:
        logger.error("Failed to update settings: %s", e)
        raise HTTPException(status_code=500, detail=f"Failed to save settings: {str(e)}")
