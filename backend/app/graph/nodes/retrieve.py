"""
Retrieve Node — Two-phase retrieval from SurrealDB:
1. Vector similarity search to find the best-matching SAP entity
2. Graph traversal to extract relational context ($expand paths)
3. Memory scan for past corrections
"""

import json
import logging
from typing import Any

from app.graph.state import AgentState
from app.services.db_client import get_db

logger = logging.getLogger(__name__)


async def retrieve_context(state: AgentState) -> dict[str, Any]:
    """Retrieve SAP entity context and agent memory from SurrealDB.

    Phase 1: Vector search on sap_entities using the query embedding
    Phase 2: Graph traversal from the matched entity
    Phase 3: Memory scan for past user corrections
    """
    db = get_db()
    query_vector = state.get("query_vector", [])
    result: dict[str, Any] = {
        "matched_entity": {},
        "graph_context": "",
        "memory_context": "",
        "schema_context": "",
    }

    # ── Phase 1: Vector Similarity & Hybrid Concept Search ──
    messages = state.get("messages", [])
    user_query = ""
    if messages:
        last = messages[-1]
        user_query = (last.content if hasattr(last, "content") else str(last)).lower()

    # Define concept keywords map to boost/fetch candidate entities directly
    concept_map = {
        "sales": ["invoice", "order", "sales"],
        "revenue": ["invoice", "order", "sales"],
        "invoic": ["invoice"],
        "customer": ["customer"],
        "order": ["order"],
        "product": ["product"],
        "employee": ["employee"],
        "supplier": ["supplier"],
        "shipper": ["shipper"],
        "category": ["category"]
    }

    matched_keywords = set()
    for term, kws in concept_map.items():
        if term in user_query:
            for kw in kws:
                matched_keywords.add(kw)

    entities = []
    top_vector_score = 0
    if query_vector:
        try:
            vector_json = json.dumps(query_vector)
            # Fetch up to 10 candidates via vector search to allow fallback matches
            entities = await db.query(f"""
                SELECT
                    id, name, description, entity_set, module,
                    metadata_schema, odata_url, key_fields,
                    nav_properties, filter_fields,
                    vector::similarity::cosine(embedding, {vector_json}) AS score
                FROM sap_entities
                WHERE embedding <|10, cosine|> {vector_json}
                ORDER BY score DESC
                LIMIT 10;
            """)
            if entities:
                top_vector_score = entities[0].get("score", 0)
        except Exception as e:
            logger.warning("Vector search failed: %s", e)

    keyword_entities = []
    # Only run hybrid keyword search if vector search is not highly confident
    if top_vector_score <= 0.85 and matched_keywords:
        try:
            kw_conditions = " OR ".join([f"string::lowercase(name) CONTAINS '{kw}'" for kw in matched_keywords])
            kw_results = await db.query(f"""
                SELECT
                    id, name, description, entity_set, module,
                    metadata_schema, odata_url, key_fields,
                    nav_properties, filter_fields,
                    0.70 AS score  # Lower fallback score to not interfere with high confidence vector scores
                FROM sap_entities
                WHERE {kw_conditions};
            """)
            if kw_results:
                keyword_entities = kw_results
                logger.info("Hybrid Search: Matched %d entities via concepts: %s", len(kw_results), list(matched_keywords))
        except Exception as ke:
            logger.warning("Keyword hybrid search failed: %s", ke)

    try:
        # Fetch settings to filter out inactive services and their MCPs
        inactive_mcps = set()
        inactive_service_urls = set()
        try:
            settings_recs = await db.query("SELECT services, mcps FROM settings WHERE id = settings:config;")
            if settings_recs and isinstance(settings_recs, list) and len(settings_recs) > 0:
                services = settings_recs[0].get("services", [])
                mcps = settings_recs[0].get("mcps", [])
                
                inactive_service_names = {s.get("name", "").lower() for s in services if s.get("is_active") is False}
                inactive_service_urls = {s.get("url", "").lower() for s in services if s.get("is_active") is False}
                
                for m in mcps:
                    parent_name = m.get("service_name", "").lower()
                    parent_url = m.get("url", "").lower()
                    if parent_name in inactive_service_names or parent_url in inactive_service_urls:
                        inactive_mcps.add(m.get("name", "").lower())
        except Exception as se:
            logger.warning("Failed to fetch settings for inactive service filtering: %s", se)

        # Combine vector search and keyword matches, preferring the higher score
        combined = {}
        for e in (entities + keyword_entities):
            eid = e["id"]
            
            # Exclude entities belonging to inactive MCPs or inactive service URLs
            module_name = e.get("module", "default")
            entity_service_url = e.get("service_url", "").lower()
            if module_name.lower() in inactive_mcps or entity_service_url in inactive_service_urls:
                continue

            if eid in combined:
                if e.get("score", 0) > combined[eid].get("score", 0):
                    combined[eid] = e
            else:
                combined[eid] = e
        sorted_entities = sorted(combined.values(), key=lambda x: x.get("score", 0), reverse=True)
        final_entities = sorted_entities[:10]

        if final_entities:
            result["candidate_entities"] = final_entities
            matched = final_entities[0]
            result["matched_entity"] = matched
            result["schema_context"] = matched.get("metadata_schema", "")
            logger.info(
                "Hybrid search matched %d candidate entities (Best match: %s, score: %.4f)",
                len(final_entities),
                matched.get("name", "?"),
                matched.get("score", 0),
            )
        else:
            result["candidate_entities"] = []
            logger.info("No hybrid search matches found in sap_entities")
    except Exception as e:
        logger.warning("Hybrid search matching failed: %s", e)

    # ── Phase 2: Graph Traversal ──
    matched = result.get("matched_entity", {})
    entity_id = matched.get("id") if matched else None

    if entity_id:
        try:
            # Traverse all outgoing graph edges from the matched entity
            graph_paths = await db.query(f"""
                SELECT
                    ->expands_to->sap_entities.{{name, entity_set, nav_properties}} AS expansions,
                    ->belongs_to->sap_entities.{{name, entity_set}} AS parents,
                    ->depends_on->sap_entities.{{name, entity_set}} AS dependencies,
                    <-belongs_to<-sap_entities.{{name, entity_set}} AS children
                FROM {entity_id};
            """)

            if graph_paths:
                context_parts = []
                gp = graph_paths[0]

                expansions = gp.get("expansions", [])
                if expansions:
                    exp_list = [f"{exp.get('entity_set')} (via {', '.join(exp.get('nav_properties', []))})" for exp in expansions if exp]
                    context_parts.append(f"Navigation expansions ($expand): {', '.join(exp_list)}")

                parents = gp.get("parents", [])
                if parents:
                    parent_list = [p.get("entity_set") for p in parents if p]
                    context_parts.append(f"Parent entities: {', '.join(parent_list)}")

                dependencies = gp.get("dependencies", [])
                if dependencies:
                    dep_list = [d.get("entity_set") for d in dependencies if d]
                    context_parts.append(f"Dependencies: {', '.join(dep_list)}")

                children = gp.get("children", [])
                if children:
                    child_list = [c.get("entity_set") for c in children if c]
                    context_parts.append(f"Child entities: {', '.join(child_list)}")

                result["graph_context"] = "\n\n".join(context_parts)
                logger.info(
                    "Graph context extracted: %d relationships",
                    len(expansions) + len(parents) + len(dependencies) + len(children),
                )

        except Exception as e:
            logger.warning("Graph traversal failed: %s", e)

    # ── Phase 3: Agent Memory Scan ──
    if query_vector:
        try:
            vector_json = json.dumps(query_vector)
            memories = await db.query(f"""
                SELECT correction, context,
                    vector::similarity::cosine(embedding, {vector_json}) AS score
                FROM agent_memory
                WHERE embedding <|3, cosine|> {vector_json}
                  AND status = 'verified'
                ORDER BY score DESC
                LIMIT 3;
            """)

            if memories:
                memory_parts = []
                for mem in memories:
                    score = mem.get("score", 0)
                    if score > 0.7:  # Only include relevant memories
                        memory_parts.append(
                            f"- {mem.get('correction', '')} (context: {mem.get('context', 'N/A')})"
                        )

                if memory_parts:
                    result["memory_context"] = (
                        "Previous user corrections to remember:\n"
                        + "\n".join(memory_parts)
                    )
                    logger.info("Found %d relevant memories", len(memory_parts))

        except Exception as e:
            logger.warning("Memory scan failed: %s", e)

    return result
