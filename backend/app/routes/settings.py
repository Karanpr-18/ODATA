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
import httpx

from app.services.db_client import get_db
from app.config import get_settings as get_app_config
from app.services.odata_parser import parse_metadata, get_embedding

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/settings")


# ── Pydantic Models ──

class MetadataPayload(BaseModel):
    url: str
    mcp_name: Optional[str] = None


class RegisterEntitiesPayload(BaseModel):
    service_name: str
    url: str
    entity_sets: List[str]
    entity_descriptions: Optional[dict[str, str]] = None  # { "EntityName": "user description" }



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


class MCPConfig(BaseModel):
    """A created MCP configuration from an OData service."""
    name: str
    service_name: str
    url: str
    description: str = ""
    entity_sets: List[str] = Field(default_factory=list)
    entity_descriptions: Optional[dict[str, str]] = None
    prompt: Optional[str] = ""


class JoinConfig(BaseModel):
    """A join relationship between two service tables."""
    source_service: str
    target_service: str
    source_table: str
    target_table: str
    join_key: str
    relation_type: Optional[str] = None  # "1-1", "1-many", "many-to-many"


class SettingsPayload(BaseModel):
    """Full settings payload for update operations."""
    llm: Optional[LLMConfig] = None
    services: Optional[List[ServiceConfig]] = None
    joins: Optional[List[JoinConfig]] = None
    mcps: Optional[List[MCPConfig]] = None


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

            db_services = record.get("services") if record.get("services") else [
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
            ]

            return {
                "llm": {
                    "provider": db_llm.get("provider", app_config.llm_provider),
                    "active_model": db_llm.get("active_model", app_config.groq_default_model),
                    "fallback_model": db_llm.get("fallback_model", ""),
                    "api_keys": merged_keys
                },
                "services": db_services,
                "mcps": record.get("mcps", []),
                "joins": record.get("joins", []),
            }
    except Exception as e:
        logger.warning("Failed to fetch settings from SurrealDB: %s", e)

    default_services = [
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
    ]

    # Return defaults if no record exists
    return {
        "llm": {
            "provider": app_config.llm_provider,
            "active_model": app_config.groq_default_model,
            "fallback_model": "",
            "api_keys": default_api_keys
        },
        "services": default_services,
        "mcps": [],
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


@router.post("/metadata")
async def get_odata_metadata(payload: MetadataPayload):
    """Fetch and parse metadata from the given OData service URL."""
    url = payload.url
    if not url.endswith("$metadata"):
        if not url.endswith("/"):
            url += "/"
        url += "$metadata"
    
    logger.info("Fetching OData metadata for discovery from: %s", url)
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            headers = {"Accept": "application/xml"}
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            metadata_xml = response.text
    except Exception as e:
        logger.error("Failed to fetch OData metadata: %s", e)
        raise HTTPException(status_code=400, detail=f"Failed to fetch metadata from {url}: {str(e)}")

    try:
        entity_types, entity_sets = parse_metadata(metadata_xml)
        
        result_sets = []
        for set_name, set_info in entity_sets.items():
            result_sets.append({
                "name": set_name,
                "entity_type": set_info.get("entity_type", "")
            })
            
        # Query SurrealDB to check which entities are already registered for this MCP Name or Service URL
        db = get_db()
        registered_entities = []
        try:
            if payload.mcp_name:
                registered_raw = await db.query(
                    "SELECT name, description FROM sap_entities WHERE module = $mcp_name;",
                    {"mcp_name": payload.mcp_name}
                )
            else:
                registered_raw = await db.query(
                    "SELECT name, description FROM sap_entities WHERE service_url = $url;",
                    {"url": payload.url}
                )
            for r in registered_raw:
                registered_entities.append({
                    "name": r.get("name"),
                    "description": r.get("description", "")
                })
        except Exception as db_err:
            logger.warning("Failed to query registered entities: %s", db_err)
            
        return {
            "entity_sets": result_sets,
            "registered_entities": registered_entities
        }
    except Exception as e:
        logger.error("Failed to parse metadata XML: %s", e)
        raise HTTPException(status_code=500, detail=f"Failed to parse metadata XML: {str(e)}")


@router.post("/register_entities")
async def register_entities(payload: RegisterEntitiesPayload):
    """Register selected OData entities: generate embeddings and save to database."""
    service_name = payload.service_name
    url = payload.url
    selected_sets = payload.entity_sets

    metadata_url = url
    if not metadata_url.endswith("$metadata"):
        if not metadata_url.endswith("/"):
            metadata_url += "/"
        metadata_url += "$metadata"

    logger.info("Registering entities from: %s", metadata_url)
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            headers = {"Accept": "application/xml"}
            response = await client.get(metadata_url, headers=headers)
            response.raise_for_status()
            metadata_xml = response.text
    except Exception as e:
        logger.error("Failed to fetch metadata during registration: %s", e)
        raise HTTPException(status_code=400, detail=f"Failed to fetch metadata from {metadata_url}: {str(e)}")

    try:
        entity_types, entity_sets = parse_metadata(metadata_xml)
    except Exception as e:
        logger.error("Failed to parse metadata XML during registration: %s", e)
        raise HTTPException(status_code=500, detail=f"Failed to parse metadata XML: {str(e)}")

    db = get_db()
    
    # 1. Clean existing entities for this MCP (module)
    try:
        await db.query("DELETE sap_entities WHERE module = $service_name;", {"service_name": service_name})
    except Exception as e:
        logger.warning("Failed to clear existing entities for MCP %s: %s", service_name, e)

    safe_service = service_name.lower().replace(" ", "_").replace("-", "_")

    # 2. Seed selected entities
    registered_count = 0
    for set_name in selected_sets:
        if set_name not in entity_sets:
            logger.warning("Selected EntitySet %s not found in metadata. Skipping.", set_name)
            continue
            
        set_info = entity_sets[set_name]
        type_name = set_info["entity_type"]
        if type_name not in entity_types:
            logger.warning("EntityType %s not found in metadata. Skipping EntitySet %s.", type_name, set_name)
            continue
            
        type_info = entity_types[type_name]
        
        safe_name = set_name.lower().replace(" ", "_").replace("-", "_")
        entity_id = f"sap_entities:dynamic_{safe_service}_{safe_name}"
        
        # Build description — prefer user-provided, fallback to auto-generated
        props = list(json.loads(type_info["schema"]).get("properties", {}).keys())
        user_descriptions = payload.entity_descriptions or {}
        if set_name in user_descriptions and user_descriptions[set_name].strip():
            description = user_descriptions[set_name].strip()
        else:
            description = f"Data entity representing {set_name} from {service_name}. Contains properties like {', '.join(props)[:100]}."
        
        embed_prompt = f"Name: {set_name}. Description: {description}. Fields: {', '.join(type_info['keys'])}"
        embedding = await get_embedding(embed_prompt)
        
        content_dict = {
            "name": set_name,
            "description": description,
            "entity_set": set_name,
            "module": service_name,
            "service_url": url,
            "metadata_schema": type_info["schema"],
            "odata_url": f"/{set_name}",
            "key_fields": type_info["keys"],
            "nav_properties": type_info["nav_props"],
            "filter_fields": props[:10],
            "embedding": embedding
        }
        
        try:
            await db.query(f"UPSERT {entity_id} CONTENT $content;", {"content": content_dict})
            registered_count += 1
        except Exception as e:
            logger.error("Failed to upsert entity %s: %s", entity_id, e)
            raise HTTPException(status_code=500, detail=f"Failed to register entity {set_name}: {str(e)}")

    # 3. Seed relationships between the registered entities of this service
    relations_count = 0
    for set_name in selected_sets:
        if set_name not in entity_sets:
            continue
        set_info = entity_sets[set_name]
        
        safe_name_from = set_name.lower().replace(" ", "_").replace("-", "_")
        id_from = f"sap_entities:dynamic_{safe_service}_{safe_name_from}"
        
        for nav_path, target_set in set_info.get("nav_bindings", {}).items():
            if target_set in selected_sets:
                safe_name_to = target_set.lower().replace(" ", "_").replace("-", "_")
                id_to = f"sap_entities:dynamic_{safe_service}_{safe_name_to}"
                
                try:
                    await db.query(f"""
                        RELATE {id_from}->depends_on->{id_to} 
                        SET description = '{set_name} navigates to {target_set} via {nav_path}';
                    """)
                    relations_count += 1
                except Exception as e:
                    logger.warning("Failed to relate %s to %s: %s", id_from, id_to, e)

    return {
        "status": "success",
        "registered_entities_count": registered_count,
        "relationships_created_count": relations_count
    }


@router.delete("/mcp/{mcp_name}")
async def delete_mcp_entities(mcp_name: str):
    """Delete all registered entities associated with a specific MCP name."""
    db = get_db()
    try:
        await db.query("DELETE sap_entities WHERE module = $mcp_name;", {"mcp_name": mcp_name})
        return {"status": "success"}
    except Exception as e:
        logger.error("Failed to delete entities for MCP %s: %s", mcp_name, e)
        raise HTTPException(status_code=500, detail=f"Failed to delete entities: {str(e)}")

