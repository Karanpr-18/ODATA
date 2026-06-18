import json
import logging
import xml.etree.ElementTree as ET
import httpx

from app.config import get_settings

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
