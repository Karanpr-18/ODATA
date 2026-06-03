import asyncio
import json
import logging
import os
import sys
import xml.etree.ElementTree as ET
from urllib.parse import urljoin

import httpx

# Ensure the project root is in the path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.db_client import get_db
from app.config import get_settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)

def strip_ns(tag: str) -> str:
    if "}" in tag:
        return tag.split("}")[1]
    return tag

async def get_embedding(text: str) -> list[float]:
    """Generate 768-dim embedding via local Ollama."""
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{settings.ollama_base_url}/api/embeddings",
                json={
                    "model": settings.ollama_model,
                    "prompt": text,
                },
            )
            response.raise_for_status()
            data = response.json()
            return data.get("embedding", [0.0] * 768)
    except Exception as e:
        logger.warning(f"Failed to generate real embedding for '{text[:20]}...', using fallback: {e}")
        return [0.1] * 768

def parse_metadata(xml_string: str):
    root = ET.fromstring(xml_string)
    
    entities = {}
    entity_sets = {}
    
    # Traverse through schemas
    for child in root.iter():
        tag = strip_ns(child.tag)
        
        if tag == "EntityType":
            entity_name = child.attrib.get("Name")
            props = {}
            keys = []
            nav_props = []
            
            for elem in child:
                elem_tag = strip_ns(elem.tag)
                if elem_tag == "Key":
                    for prop_ref in elem:
                        if strip_ns(prop_ref.tag) == "PropertyRef":
                            keys.append(prop_ref.attrib.get("Name"))
                elif elem_tag == "Property":
                    prop_name = elem.attrib.get("Name")
                    prop_type = elem.attrib.get("Type", "Edm.String")
                    # Map OData type to JSON schema type
                    json_type = "string"
                    if "Int" in prop_type or "Decimal" in prop_type or "Double" in prop_type or "Single" in prop_type:
                        json_type = "number"
                    if "Boolean" in prop_type:
                        json_type = "boolean"
                        
                    props[prop_name] = {"type": json_type}
                    
                    if "DateTime" in prop_type or "Date" in prop_type:
                        props[prop_name]["format"] = "date-time"
                        
                elif elem_tag == "NavigationProperty":
                    nav_props.append(elem.attrib.get("Name"))
                    
            schema = {
                "type": "object",
                "properties": props
            }
            entities[entity_name] = {
                "keys": keys,
                "nav_props": nav_props,
                "schema": json.dumps(schema)
            }
            
        elif tag == "EntitySet":
            set_name = child.attrib.get("Name")
            entity_type_full = child.attrib.get("EntityType")
            entity_type = entity_type_full.split(".")[-1] if "." in entity_type_full else entity_type_full
            
            # Map navigation targets
            nav_bindings = {}
            for elem in child:
                elem_tag = strip_ns(elem.tag)
                if elem_tag == "NavigationPropertyBinding":
                    path = elem.attrib.get("Path")
                    target = elem.attrib.get("Target")
                    if path and target:
                        nav_bindings[path] = target
                        
            entity_sets[set_name] = {
                "entity_type": entity_type,
                "nav_bindings": nav_bindings
            }

    return entities, entity_sets

async def sync_odata():
    settings = get_settings()
    base_url = settings.sap_odata_base_url
    if not base_url:
        logger.error("SAP_ODATA_BASE_URL is not set in environment.")
        return
        
    metadata_url = urljoin(base_url if base_url.endswith('/') else base_url + '/', "$metadata")
    
    logger.info(f"Fetching OData metadata from: {metadata_url}")
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            headers = {"Accept": "application/xml"}
            if settings.sap_client:
                headers["sap-client"] = settings.sap_client
                
            response = await client.get(metadata_url, headers=headers)
            response.raise_for_status()
            metadata_xml = response.text
    except Exception as e:
        logger.error(f"Failed to fetch metadata: {e}")
        return
        
    logger.info("Successfully fetched metadata, parsing...")
    try:
        entity_types, entity_sets = parse_metadata(metadata_xml)
    except Exception as e:
        logger.error(f"Failed to parse metadata XML: {e}")
        return
        
    logger.info(f"Discovered {len(entity_sets)} EntitySets and {len(entity_types)} EntityTypes.")
    
    # Clean database
    db = get_db()
    await db.connect()
    
    logger.info("Clearing existing sap_entities and relationships...")
    await db.query("DELETE FROM sap_entities;")
    await db.query("DELETE FROM expands_to;")
    await db.query("DELETE FROM belongs_to;")
    await db.query("DELETE FROM depends_on;")
    
    # Upsert entities
    logger.info("Generating embeddings and seeding parsed entities...")
    
    for set_name, set_info in entity_sets.items():
        type_name = set_info["entity_type"]
        if type_name not in entity_types:
            logger.warning(f"EntitySet {set_name} references unknown EntityType {type_name}. Skipping.")
            continue
            
        type_info = entity_types[type_name]
        
        # Build node id
        safe_name = set_name.lower().replace(" ", "_").replace("-", "_")
        entity_id = f"sap_entities:dynamic_{safe_name}"
        
        # Generate semantic embedding
        # Default description to help the embedding model
        description = f"Data entity representing {set_name}. Contains properties like {', '.join(json.loads(type_info['schema']).get('properties', {}).keys())[:100]}."
        
        embed_prompt = f"Name: {set_name}. Description: {description}. Fields: {', '.join(type_info['keys'])}"
        embedding = await get_embedding(embed_prompt)
        
        content_dict = {
            "name": set_name,
            "description": description,
            "entity_set": set_name,
            "module": "Dynamic",
            "metadata_schema": type_info["schema"],
            "odata_url": f"/{set_name}",
            "key_fields": type_info["keys"],
            "nav_properties": type_info["nav_props"],
            "filter_fields": list(json.loads(type_info["schema"]).get("properties", {}).keys())[:10], # First 10 properties as filter fields
            "embedding": embedding
        }
        
        entity_json = json.dumps(content_dict)
        
        try:
            logger.info(f"Upserting {entity_id}...")
            await db.query(f"UPSERT {entity_id} CONTENT {entity_json};")
        except Exception as e:
            logger.error(f"Failed to seed {entity_id}: {e}")
            
    # Seed relationships
    logger.info("Seeding Graph Edges based on Navigation Properties...")
    
    for set_name, set_info in entity_sets.items():
        safe_name_from = set_name.lower().replace(" ", "_").replace("-", "_")
        id_from = f"sap_entities:dynamic_{safe_name_from}"
        
        for nav_path, target_set in set_info.get("nav_bindings", {}).items():
            safe_name_to = target_set.lower().replace(" ", "_").replace("-", "_")
            id_to = f"sap_entities:dynamic_{safe_name_to}"
            
            try:
                # Using depends_on to represent the relation
                await db.query(f"""
                    RELATE {id_from}->depends_on->{id_to} 
                    SET description = '{set_name} navigates to {target_set} via {nav_path}';
                """)
            except Exception as e:
                logger.error(f"Failed to relate {id_from} to {id_to}: {e}")
                
    await db.close()
    logger.info("Dynamic schema sync completed.")

if __name__ == "__main__":
    asyncio.run(sync_odata())
