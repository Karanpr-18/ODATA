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

    # ── Phase 1: Vector Similarity Search ──
    if query_vector:
        try:
            vector_json = json.dumps(query_vector)
            entities = await db.query(f"""
                SELECT
                    id, name, description, entity_set, module,
                    metadata_schema, odata_url, key_fields,
                    nav_properties, filter_fields,
                    vector::similarity::cosine(embedding, {vector_json}) AS score
                FROM sap_entities
                WHERE embedding <|15, cosine|> {vector_json}
                ORDER BY score DESC
                LIMIT 15;
            """)

            if entities:
                result["candidate_entities"] = entities
                # For baseline fallback, set the first element as matched_entity
                matched = entities[0]
                result["matched_entity"] = matched
                result["schema_context"] = matched.get("metadata_schema", "")
                logger.info(
                    "Vector matched %d candidate entities (Best match: %s, score: %.4f)",
                    len(entities),
                    matched.get("name", "?"),
                    matched.get("score", 0),
                )
            else:
                result["candidate_entities"] = []
                logger.info("No vector matches found in sap_entities")

        except Exception as e:
            logger.warning("Vector search failed: %s", e)

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
                    context_parts.append(
                        f"Navigation expansions ($expand): {json.dumps(expansions, indent=2)}"
                    )

                parents = gp.get("parents", [])
                if parents:
                    context_parts.append(
                        f"Parent entities: {json.dumps(parents, indent=2)}"
                    )

                dependencies = gp.get("dependencies", [])
                if dependencies:
                    context_parts.append(
                        f"Dependencies: {json.dumps(dependencies, indent=2)}"
                    )

                children = gp.get("children", [])
                if children:
                    context_parts.append(
                        f"Child entities: {json.dumps(children, indent=2)}"
                    )

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
