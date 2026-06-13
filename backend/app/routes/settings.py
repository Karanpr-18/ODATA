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
from app.config import get_settings as get_app_config

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/settings")


# ── Pydantic Models ──

class LLMConfig(BaseModel):
    """LLM provider configuration."""
    provider: str = ""
    active_model: str = ""
    fallback_model: str = ""
    api_keys: dict[str, str] = Field(default_factory=dict)


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
    app_config = get_app_config()
    default_api_keys = {
        "openai": app_config.openai_api_key or "",
        "groq": app_config.groq_api_key or "",
        "anthropic": app_config.anthropic_api_key or "",
        "google": app_config.gemini_api_key or "",
        "mistral": app_config.mistral_api_key or "",
    }

    try:
        results = await db.query("SELECT * FROM settings WHERE id = settings:config;")
        if results and isinstance(results, list) and len(results) > 0:
            record = results[0]
            db_llm = record.get("llm", {})
            db_api_keys = db_llm.get("api_keys", {})
            
            # Merge: Use env keys if DB keys are missing or empty
            merged_keys = {}
            for k, v in default_api_keys.items():
                merged_keys[k] = db_api_keys.get(k) or v

            return {
                "llm": {
                    "provider": db_llm.get("provider", app_config.llm_provider),
                    "active_model": db_llm.get("active_model", app_config.groq_default_model),
                    "fallback_model": db_llm.get("fallback_model", ""),
                    "api_keys": merged_keys
                },
                "services": record.get("services") if record.get("services") else [
                    {
                        "name": "SAP OData Gateway (Default)",
                        "url": "https://sap-gateway.example.com/sap/opu/odata/sap/",
                        "description": "Mocked SAP Gateway Service"
                    },
                    {
                        "name": "Northwind V4",
                        "url": "https://services.odata.org/V4/Northwind/Northwind.svc",
                        "description": "Public OData V4 testing service"
                    }
                ],
                "joins": record.get("joins", []),
            }
    except Exception as e:
        logger.warning("Failed to fetch settings from SurrealDB: %s", e)

    # Return defaults if no record exists
    return {
        "llm": {
            "provider": app_config.llm_provider,
            "active_model": app_config.groq_default_model,
            "fallback_model": "",
            "api_keys": default_api_keys
        },
        "services": [
            {
                "name": "SAP OData Gateway (Default)",
                "url": "https://sap-gateway.example.com/sap/opu/odata/sap/",
                "description": "Mocked SAP Gateway Service"
            },
            {
                "name": "Northwind V4",
                "url": "https://services.odata.org/V4/Northwind/Northwind.svc",
                "description": "Public OData V4 testing service"
            }
        ],
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
