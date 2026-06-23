"""
Instruct Node (Supervisor / Instructor Layer — Option 2)

Intercepts the candidate entities, runs a lightweight, fast LLM pass to
analyze the user request against the candidates, and outputs a refined structured 
query plan and the absolute best target schema.
"""

import json
import logging
from typing import Any

from langchain_core.messages import SystemMessage, HumanMessage
from app.services.llm_factory import get_llm, extract_token_usage

from app.config import get_settings
from app.graph.state import AgentState
from app.services.db_client import get_db

logger = logging.getLogger(__name__)

INSTRUCTOR_SYSTEM_PROMPT = """You are an SAP Database Supervisor. Select the best entity candidate for the query.

Guidelines:
1. Match the user query to the most semantically fitting entity (checking fields and descriptions). Prefer candidates in MCPs matching the query topic.
2. If all required fields are present in a pre-joined candidate (e.g. Invoices, Orders_Qries), select it.
3. Otherwise, select the main entity and expand navigation properties (e.g. Customer) to get related fields.
4. Plan OData only for fetching (no aggregation/limiting). All grouping/counting/summing must be done in pandas.

Output format (MUST be raw JSON, no wrappers or other text):
{
  "selected_entity_id": "ID of selected candidate",
  "intent_analysis": "Summary of filters, fields, and aggregates needed",
  "required_fields": ["list", "of", "exact", "fields", "needed"],
  "plan_steps": ["Step 1", "Step 2", "Step 3"]
}
"""


async def _get_graph_context(entity_id: str) -> str:
    """Retrieve outgoing graph pathways for the selected entity dynamically and format compactly."""
    db = get_db()
    try:
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
                exp_list = [f"{exp.get('entity_set')} (via {', '.join(exp.get('nav_properties', []))})" for exp in expansions]
                context_parts.append(f"Navigation expansions ($expand): {', '.join(exp_list)}")

            parents = gp.get("parents", [])
            if parents:
                parent_list = [p.get("entity_set") for p in parents]
                context_parts.append(f"Parent entities: {', '.join(parent_list)}")

            dependencies = gp.get("dependencies", [])
            if dependencies:
                dep_list = [d.get("entity_set") for d in dependencies]
                context_parts.append(f"Dependencies: {', '.join(dep_list)}")

            children = gp.get("children", [])
            if children:
                child_list = [c.get("entity_set") for c in children]
                context_parts.append(f"Child entities: {', '.join(child_list)}")

            return "\n\n".join(context_parts)
    except Exception as ge:
        logger.warning("Supervisor Layer dynamic graph retrieval failed: %s", ge)
    return ""


async def instruct_query(state: AgentState) -> dict[str, Any]:
    """Analyze query against candidate tables and route/build structured instructions.

    If high confidence / single candidate matched via vector similarity, bypasses the LLM
    call completely to save tokens.
    """
    settings = get_settings()
    messages = state.get("messages") or []
    candidates = state.get("candidate_entities") or []
    model_name = state.get("model_name", settings.groq_default_model)

    if not candidates:
        logger.info("No candidates to analyze in Instructor layer. Bypassing.")
        return {}

    # Extract user query
    user_query = ""
    if messages:
        last = messages[-1]
        user_query = last.content if hasattr(last, "content") else str(last)

    # ── Check for High Confidence Bypass ──
    bypass_reason = ""
    if len(candidates) == 1:
        bypass_reason = "Single candidate found"
    else:
        top_score = candidates[0].get("score", 0)
        second_score = candidates[1].get("score", 0)
        if top_score > 0.85 and (top_score - second_score) > 0.10:
            bypass_reason = f"High-confidence top candidate (score: {top_score:.4f}, margin: {top_score - second_score:.4f})"

    if bypass_reason:
        logger.info("Supervisor Layer: Bypassing LLM call. Reason: %s", bypass_reason)
        selected_entity = candidates[0]
        graph_context = await _get_graph_context(selected_entity.get("id"))

        plan = {
            "selected_entity_id": selected_entity.get("id"),
            "intent_analysis": f"Rule-based direct routing to {selected_entity.get('name')}.",
            "required_fields": selected_entity.get("filter_fields", []),
            "plan_steps": [
                f"Query the entity set {selected_entity.get('entity_set')} and fetch required fields.",
                "Filter and process the results as requested."
            ]
        }
        return {
            "matched_entity": selected_entity,
            "schema_context": selected_entity.get("metadata_schema", ""),
            "graph_context": graph_context,
            "instruction_plan": plan
        }

    # Format candidates for prompt — include MCP name so supervisor can weight routing
    candidates_data = []
    for c in candidates:
        candidates_data.append({
            "id": c.get("id"),
            "name": c.get("name"),
            "entity_set": c.get("entity_set"),
            "mcp": c.get("module", "Default"),          # MCP name — helps supervisor pick the right service
            "description": c.get("description"),
            "key_fields": c.get("key_fields", [])
        })

    logger.info("Supervisor Layer: Analyzing %d candidates against query: '%s'", len(candidates), user_query[:60])

    try:
        # Use a very fast, temperature=0 run
        llm = get_llm(
            model_name=model_name,
            temperature=0,
            max_tokens=600, # Lightweight payload
        )

        prompt_messages = [
            SystemMessage(content=INSTRUCTOR_SYSTEM_PROMPT),
            HumanMessage(
                content=(
                    f"## Candidate Entities:\n{json.dumps(candidates_data, indent=2)}\n\n"
                    f"## User Query:\n'{user_query}'\n\n"
                    f"Output your selection and plan as raw JSON."
                )
            ),
        ]

        response = await llm.ainvoke(prompt_messages)
        usage = extract_token_usage(response)
        current_token_usage = state.get("token_usage") or {"input": 0, "output": 0, "total": 0}
        new_token_usage = {
            "input": current_token_usage.get("input", 0) + usage["input"],
            "output": current_token_usage.get("output", 0) + usage["output"],
            "total": current_token_usage.get("total", 0) + usage["total"]
        }
        content = response.content.strip()

        # Strip reasoning thoughts if present
        import re
        content = re.sub(r'<think>[\s\S]*?</think>', '', content).strip()
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[1].split("```")[0].strip()

        plan = json.loads(content)
        selected_id = plan.get("selected_entity_id")

        # Find the selected entity from candidate lists
        selected_entity = next((c for c in candidates if c.get("id") == selected_id), candidates[0])

        logger.info("Supervisor Layer selected: %s (%s)", selected_entity.get("name"), selected_entity.get("id"))

        # Re-fetch outgoing graph pathways dynamically
        graph_context = await _get_graph_context(selected_entity.get("id"))

        return {
            "matched_entity": selected_entity,
            "schema_context": selected_entity.get("metadata_schema", ""),
            "graph_context": graph_context,
            "instruction_plan": plan,
            "token_usage": new_token_usage
        }

    except Exception as e:
        logger.error("Supervisor Layer execution failed: %s. Falling back to default RAG matched entity.", e)
        # Fallback: keep the defaults from retrieval
        return {}

