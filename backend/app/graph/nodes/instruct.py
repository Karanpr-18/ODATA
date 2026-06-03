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
from app.services.llm_factory import get_llm

from app.config import get_settings
from app.graph.state import AgentState
from app.services.db_client import get_db

logger = logging.getLogger(__name__)

INSTRUCTOR_SYSTEM_PROMPT = """You are an expert SAP Database Supervisor and Query Router.
Your job is to analyze the user's natural language request and select the single best target SAP entity from a list of vector-matched candidates.

For the user's request, compare the candidates and select the one that mathematically and semantically fits the data required (e.g. if the user wants sales order totals, look for fields like 'ExtendedPrice' or 'Subtotal' in candidate tables; do not select a table that only has 'Freight' or logistics info if an invoices/sales-total table is available).

## How to choose the best Candidate:
1. **Identify** all fields/columns required by the user query (e.g. customer name/CompanyName and order count/OrderID).
2. **Scan Candidate Properties**:
   - If a candidate contains ALL required fields directly in its "properties" list (e.g. `Orders_Qries` contains both `CompanyName` and `OrderID`), select it immediately as the single best candidate!
   - If no candidate contains all fields directly, look for a transaction candidate (e.g. `Orders`) that has a navigation property (e.g. `Customer`) to expand the other required fields.
   - Never select an entity (like `Orders`) and plan to perform a merge/join in Python with another table (like `Customers`) unless you also plan to fetch that other table via `$expand` in the same single OData query.

## CRITICAL ARCHITECTURAL CONSTRAINTS:
1. **OData is for Retrieval Only**:
   - The OData query MUST NOT perform grouping, counting, summing, ordering, or limiting (do NOT suggest $groupby, $aggregate, $orderby, or $top in OData query plan steps for calculation requests).
   - All aggregations, calculations, grouping, sorting, and limits (like top 3) MUST be performed inside the Python Pandas script.
   - The OData query plan step should only fetch the raw records with necessary `$select`, `$filter`, and `$expand`.
2. **Handling Multi-Table/Related Fields**:
   - The Python sandbox is air-gapped (no internet/intranet access) and can only see the data fetched by the single OData query piped to stdin. It cannot load or query other tables in Python.
   - Therefore, if the user's request requires fields from multiple related tables (e.g., CompanyName from Customers and OrderID from Orders):
     - **Option A (Preferred)**: Select a pre-joined view candidate entity (like `Orders_Qries` or `Invoices`) if one exists in the candidates list that contains all required fields.
     - **Option B**: Select the transactional entity (like `Orders`) and plan to use `$expand` on the navigation property (like `Customer`) to fetch parent details. Specify the exact expansion path (e.g., `Customer` and fields like `Customer($select=CompanyName)`).
     - **CRITICAL**: Only suggest `$expand` for navigation property names that actually exist in the selected entity's `nav_properties` list. If `nav_properties` is empty or does not contain the target property, do NOT use `$expand`.
3. **Strict Fields Matching**:
   - Only specify fields that actually exist in the properties list of the candidate or its expanded navigation entities. Never assume a field like `OrderCount` or `SalesTotal` exists on the raw table unless it is in the properties.
4. **Ensure All Requested Fields are Planned**:
   - If the user query asks for names or specific descriptive fields (e.g. customer name, product name), make sure your steps explicitly retrieve them (either from the joined view or via expansion) and include them in the final output step of the plan (do NOT just return IDs if the user asks for customers/products).

## Instructions:
1. **Analyze** the user query.
2. **Review** the candidate entity sets, their properties, keys, and descriptions.
3. **Select** the single best matching candidate.
4. **Identify** the exact fields/columns needed to satisfy the filters and calculation metrics.
5. **Formulate** a structured, step-by-step query plan.

## Output Format:
You MUST output a single, raw, valid JSON object with the following structure (no conversational chatter, no markdown blocks, no formatting wrapper except raw JSON):
{
  "selected_entity_id": "ID of the selected candidate",
  "intent_analysis": "Brief analysis of the filters, aggregates, and fields needed",
  "required_fields": ["list", "of", "exact", "property", "names", "needed"],
  "plan_steps": [
    "Step 1 details (OData query target, path, and select fields)",
    "Step 2 details (Filter criteria and syntax)",
    "Step 3 details (Pandas calculation logic and print instructions)"
  ]
}
"""

async def instruct_query(state: AgentState) -> dict[str, Any]:
    """Analyze query against candidate tables and route/build structured instructions."""
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

    # Format candidates for prompt
    candidates_data = []
    for c in candidates:
        schema = {}
        try:
            schema = json.loads(c.get("metadata_schema", "{}"))
        except:
            pass
        candidates_data.append({
            "id": c.get("id"),
            "name": c.get("name"),
            "entity_set": c.get("entity_set"),
            "description": c.get("description"),
            "properties": list(schema.get("properties", {}).keys()),
            "nav_properties": c.get("nav_properties", []),
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

        # Re-fetch outgoing graph pathways for the SPECIFIC selected entity dynamically to ensure multi-hop expands are 100% correct!
        db = get_db()
        graph_context = ""
        try:
            graph_paths = await db.query(f"""
                SELECT
                    ->expands_to->sap_entities.{{name, entity_set, nav_properties}} AS expansions,
                    ->belongs_to->sap_entities.{{name, entity_set}} AS parents,
                    ->depends_on->sap_entities.{{name, entity_set}} AS dependencies,
                    <-belongs_to<-sap_entities.{{name, entity_set}} AS children
                FROM {selected_entity.get('id')};
            """)

            if graph_paths:
                context_parts = []
                gp = graph_paths[0]

                expansions = gp.get("expansions", [])
                if expansions:
                    context_parts.append(f"Navigation expansions ($expand): {json.dumps(expansions, indent=2)}")

                parents = gp.get("parents", [])
                if parents:
                    context_parts.append(f"Parent entities: {json.dumps(parents, indent=2)}")

                dependencies = gp.get("dependencies", [])
                if dependencies:
                    context_parts.append(f"Dependencies: {json.dumps(dependencies, indent=2)}")

                children = gp.get("children", [])
                if children:
                    context_parts.append(f"Child entities: {json.dumps(children, indent=2)}")

                graph_context = "\n\n".join(context_parts)
        except Exception as ge:
            logger.warning("Supervisor Layer dynamic graph retrieval failed: %s", ge)

        return {
            "matched_entity": selected_entity,
            "schema_context": selected_entity.get("metadata_schema", ""),
            "graph_context": graph_context,
            "instruction_plan": plan
        }

    except Exception as e:
        logger.error("Supervisor Layer execution failed: %s. Falling back to default RAG matched entity.", e)
        # Fallback: keep the defaults from retrieval
        return {}
