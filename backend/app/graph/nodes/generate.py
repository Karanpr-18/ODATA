"""
Generate Node — Uses Groq LLM to generate an OData query, Python script,
or direct answer based on the retrieved context.
"""

import logging
import os
import sys
import json
from typing import Any

from langchain_core.messages import SystemMessage, HumanMessage
from app.services.llm_factory import get_llm, extract_token_usage

from app.config import get_settings
from app.graph.state import AgentState
from app.services.db_client import get_db
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

logger = logging.getLogger(__name__)


async def get_mcp_tools() -> list:
    """Connect to odata_mcp server via stdio and get tools list."""
    server_script = os.path.join(
        os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../..")),
        "mcp_servers/odata_mcp/server.py"
    )
    
    server_params = StdioServerParameters(
        command=sys.executable,
        args=[server_script],
        env=os.environ.copy()
    )
    
    try:
        logger.info("Listing MCP tools from: %s", server_script)
        async with stdio_client(server_params) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                result = await session.list_tools()
                return result.tools
    except Exception as e:
        logger.error("Failed to list MCP tools: %s", e)
        return []


# System prompt that instructs the LLM on its role and output format
SYSTEM_PROMPT = """You are an expert SAP OData query assistant. Your job is to help users query SAP systems using natural language.

Based on the SAP entity schema, graph relationships, and any past corrections provided, you must:

1. **Understand** the user's intent (what data they want and any filters/aggregations).
2. **Generate** the appropriate response:
   - For simple, raw data listing and retrieval (e.g., "list customers", "show orders"): Generate an OData URL.
   - For summaries, statistics, totals, averages, trends, or complex calculations (e.g., "give summary of orders", "average freight by country"): Generate a Python script using pandas that processes the data.
   - For general questions about SAP structure: Provide a direct text answer.

## Output Format Rules:
- If generating an OData query, prefix your response with `[ODATA]` followed by the OData query path (e.g. `[ODATA]/Customers?$filter=Country eq 'Germany'`).
- If generating a Python calculation script, prefix with `[SCRIPT]` and provide BOTH the OData query to fetch the raw data and the Python code to process it in this exact format:
  [SCRIPT]
  OData: /Customers?$select=CustomerID,Country
  Code:
  ```python
  import sys, json, pandas as pd
  # process and print JSON to stdout
  ```
- If providing a direct answer, prefix with `[ANSWER]` followed by your explanation.

## ABSOLUTE CONSTRAINTS & FORMATTING (MUST FOLLOW):
1. You MUST select exactly ONE response prefix: either `[ODATA]`, `[SCRIPT]`, or `[ANSWER]`.
2. Do NOT output more than one prefix in your message.
3. Do NOT add any conversational chatter, explanations, warnings, or side notes before or after a `[ODATA]` or `[SCRIPT]` block.
4. If you output `[ODATA]`, the REST of your message MUST contain ONLY the OData URL path. Example: `[ODATA]/Customers`
5. If you output `[SCRIPT]`, your response MUST follow the strict dual-format of `OData:` and `Code:` with NO conversational chatter or notes.
6. Failure to comply with these formatting rules will break the pipeline execution and crash the application.

## Handling Chart / Visualization Requests:
- If the user requests a chart, plot, or graph (e.g., "give a pie chart of customers by country"):
  * Do NOT refuse the request or say it is outside your rules.
  * The system's UI layer natively handles and renders the charts from the data you provide.
  * Your ONLY job is to retrieve or group the raw data.
  * If the data is direct, output the `[ODATA]` query path to fetch it (e.g., `[ODATA]/Customers`).
  * If the data needs grouping/calculations, output the `[SCRIPT]` Python code to process it.
  * Do NOT add any plotting code (like matplotlib) to the script. Only output clean JSON data.

## OData Query Rules:
- Always use proper SAP OData v2 syntax
- Use $filter for conditions: e.g., `$filter=CompanyCode eq '1000' and PostingDate ge datetime'2024-01-01T00:00:00'`
- Use $select to limit fields for performance
- **Token Optimization & Pagination (CRITICAL)**: If the user asks for "top N", "best N", or "first N" records (e.g., "top 5", "best 10"), you MUST use the `$top=N` query parameter (and `$skip` if paginating). Do NOT fetch the entire dataset and limit it in Python. ALWAYS push the limit to the OData query level to save tokens.
- **$select List Consistency (CRITICAL)**: If you specify a `$select` parameter in the OData query, you MUST include every single column that is read, referenced, or filtered in the Python script. For example, if the Python script accesses `df['ShipCountry']` or `df['ShipName']`, then `ShipCountry` and `ShipName` MUST be explicitly listed in your `$select` parameter list. Failing to do so will cause a KeyError and crash the execution.
- Use $expand for navigation properties based on the graph context
- Use $orderby for sorting
- **Relational Aggregations (CRITICAL)**: If a query requires counting, summing, or aggregating child relations (e.g. counting orders per customer, summing item costs per invoice):
  * Do NOT query the parent entity and use `$expand` to count related children (e.g. do not expand `/Customers` to count orders). OData servers heavily paginate expanded properties, leading to incorrect counts.
  * Instead, query the child transaction entity directly (e.g. query `/Orders` or `/Invoices` directly) and perform the grouping, counting, and aggregation inside the Python sandbox script.
  * If parent name fields are needed for the report (e.g. CompanyName for Customers), you should either query a joined view entity (like `Orders_Qries` which contains both) OR select the child entity (like `Orders`) and `$expand` the parent with nested select (e.g., `/Orders?$select=OrderID,CustomerID&$expand=Customer($select=CompanyName)`).
- **Strict Schema Compliance**: Never select, order, or filter on non-existent properties (like `OrderCount` or calculated values). Only select actual fields present in the schema, and perform all calculated aggregations inside the Python sandbox.

## Python Script Rules:
- Use only standard libraries and pandas.
- DO NOT use matplotlib, seaborn, or any other graphing/plotting libraries.
- Never try to plot, draw, or render charts in the Python script. Only perform calculations and print outputs.
- Read input data from stdin as JSON: `import sys, json; data = json.load(sys.stdin)`
  * Note: The input data passed to stdin is a raw LIST of dictionary records (not a dictionary with a 'value' key!). To load it into a pandas DataFrame, you can run `df = pd.DataFrame(data)` or `df = pd.json_normalize(data)` directly on the list. If you used `$expand=Customer` in OData, you should run `df = pd.json_normalize(data)` to easily flatten nested OData objects into columns like `Customer.CompanyName`.
  * WARNING: DO NOT use `pd.read_json('/Customers...', ...)` or try to open/load OData paths as files inside Python. The data has already been fetched and is passed directly via standard input. You MUST read it from `sys.stdin` or load `data` directly into `pd.DataFrame(data)`.
  * WARNING: DO NOT define or hardcode mock/fake data lists or mock DataFrames in Python (e.g. do not write `customers_data = [...]` and merge it). All data MUST come dynamically from the records passed to standard input from the OData query.
  * WARNING: In pandas, `groupby(['col1', 'col2'])` drops rows where any grouping key is null (e.g., if `Region` contains `None`, those rows are deleted!). Always specify `dropna=False` in groupby (e.g., `df.groupby(..., dropna=False)`) or only group by non-null identifier keys.
- Print your calculation results to stdout as JSON. If the user explicitly requested a chart, graph, or plot, you MUST print a specific JSON chart block structure to stdout so the UI can render it. Format the print statement exactly like this:
  ```python
  # Print the chart JSON structure directly to stdout
  print(json.dumps({
      "type": "chart",
      "chartType": "bar" | "pie" | "line" | "area",
      "title": "Descriptive Chart Title",
      "data": [{"label_key": "category_name", "metric_key": 12.34}, ...],
      "xKey": "label_key",
      "yKeys": ["metric_key"]
  }))
  ```
  If no chart was requested, you can print a raw dictionary or list of results.
- Handle edge cases (empty data, missing fields)

## Supervisor Plan Adherence:
- If `## 📋 Supervisor Query & Calculation Plan` is provided in the retrieved context, you MUST strictly follow its strategy, selected entity, and planned steps.
- Use the exact field names recommended by the plan (e.g., if the plan specifies querying `/Orders` using `ShipCountry` instead of expanding `Customer/Country`, you must follow that exactly and select/group by `ShipCountry`).

## Important:
- Apply any past user corrections from memory context
- Be precise with SAP field names from the schema
- If you cannot determine the right entity or fields, ask for clarification with [ANSWER]
"""


async def generate_response(state: AgentState) -> dict[str, Any]:
    """Use Groq LLM to generate OData query, Python script, or direct answer.

    Constructs a rich prompt with entity schema, graph context, and memory,
    then calls the user's selected Groq model.
    """
    settings = get_settings()
    retry_count = state.get("retry_count", 0)
    error = state.get("error", "")
    failed_query = state.get("generated_query", "")
    model_name = state.get("model_name", settings.groq_default_model)
    matched_entity = state.get("matched_entity", {})
    schema_context = state.get("schema_context", "")
    graph_context = state.get("graph_context", "")
    memory_context = state.get("memory_context", "")
    messages = state.get("messages", [])

    # Build the context block
    context_parts = []

    should_clear_buffer = False
    if error:
        should_clear_buffer = True
        # We are performing a self-healing retry!
        retry_count += 1
        logger.warning("generate_response self-healing retry #%d for error: %s", retry_count, error)
        context_parts.append(
            f"⚠️ ## Previous Attempt Failed\n"
            f"Your previous attempt to generate a query or python script failed.\n"
            f"Generated target that failed:\n```\n{failed_query}\n```\n"
            f"Execution failed with the following error:\n```\n{error}\n```\n"
            f"**CRITICAL ACTION REQUIRED**:\n"
            f"Analyze the error carefully. For example, check for misspelled field names, path segments (do not use leading slashes `/` on relative path names like `Customers` to prevent path resetting), or missing python packages. "
            f"Generate a corrected query or script that resolves this issue."
        )

    if matched_entity:
        entity_info = (
            f"Matched SAP Entity: {matched_entity.get('name', 'Unknown')}\n"
            f"EntitySet: {matched_entity.get('entity_set', 'N/A')}\n"
            f"Module: {matched_entity.get('module', 'N/A')}\n"
            f"Key Fields: {matched_entity.get('key_fields', [])}\n"
            f"Navigation Properties: {matched_entity.get('nav_properties', [])}\n"
            f"Filter Fields: {matched_entity.get('filter_fields', [])}"
        )
        context_parts.append(f"## SAP Entity Information\n{entity_info}")

    if schema_context:
        context_parts.append(f"## Entity $metadata Schema\n{schema_context}")

    if graph_context:
        context_parts.append(f"## Graph Relationships\n{graph_context}")

    if memory_context:
        context_parts.append(f"## User Corrections & Preferences\n{memory_context}")

    instruction_plan = state.get("instruction_plan") or {}
    if instruction_plan:
        plan_steps = instruction_plan.get("plan_steps") or []
        required_fields = instruction_plan.get("required_fields") or []
        plan_desc = (
            f"Intent Analysis: {instruction_plan.get('intent_analysis', 'N/A')}\n"
            f"Required Fields: {required_fields}\n"
            f"Step-by-Step Query Plan:\n"
            + "\n".join(f"- {step}" for step in plan_steps if step is not None)
        )
        context_parts.append(f"## 📋 Supervisor Query & Calculation Plan\n{plan_desc}")

    context_block = "\n\n---\n\n".join(context_parts) if context_parts else (
        "No SAP entity context available. "
        "Please provide a general answer or ask for clarification."
    )

    # Extract user query from last message
    if messages:
        last = messages[-1]
        user_query = last.content if hasattr(last, "content") else str(last)
    else:
        user_query = ""

    # Fetch settings to get any custom MCP instructions/prompts
    db = get_db()
    mcp_instructions = []
    try:
        results = await db.query("SELECT mcps FROM settings WHERE id = settings:config;")
        if results and len(results) > 0:
            mcps_list = results[0].get("mcps", [])
            for mcp_item in mcps_list:
                name = mcp_item.get("name")
                prompt_text = mcp_item.get("prompt")
                if name and prompt_text and prompt_text.strip():
                    mcp_instructions.append(f"Instructions for MCP '{name}': {prompt_text.strip()}")
    except Exception as e:
        logger.warning("Failed to fetch MCP prompts from settings: %s", e)

    # Fetch registered MCP OData tools dynamically
    mcp_tools = await get_mcp_tools()

    # ── Tool Binding Strategy (3-tier, fewest tokens first) ──
    # Each MCP the user creates is a separate tool namespace. We want to bind
    # ONLY the single tool that matches the entity selected by the supervisor.
    #
    # Tier 1: Exact match on "fetch_{module}_{entity_set}"
    #   → Works perfectly for UI-registered MCPs with named modules.
    # Tier 2: Entity-suffix match "*_{entity_set}" across all tools
    #   → Handles legacy "Dynamic" module entities (old sync_odata.py) where
    #     all entities share module="Dynamic". Picks the right entity regardless.
    # Tier 3: Service-prefix fallback "fetch_{module}_*"
    #   → Last resort if entity set name is ambiguous across services.
    if matched_entity:
        entity_set_raw = matched_entity.get("entity_set", "")
        module_raw = matched_entity.get("module", "")
        safe_service = module_raw.lower().replace(" ", "_").replace("-", "_")
        safe_entity = entity_set_raw.lower().replace(" ", "_").replace("-", "_")

        # Tier 1: exact match
        exact_tool_name = f"fetch_{safe_service}_{safe_entity}"
        exact_match = [t for t in mcp_tools if t.name == exact_tool_name]
        if exact_match:
            mcp_tools = exact_match
            logger.info("Tool binding [T1-exact]: '%s' (1 tool)", exact_tool_name)

        # Tier 2: entity-suffix match — entity set appears at end of tool name
        elif safe_entity:
            suffix = f"_{safe_entity}"
            suffix_match = [t for t in mcp_tools if t.name.endswith(suffix)]
            if suffix_match:
                # If multiple services share the same entity name, prefer the
                # one whose service prefix matches the matched module.
                preferred = [t for t in suffix_match if t.name.startswith(f"fetch_{safe_service}_")]
                mcp_tools = preferred if preferred else suffix_match[:1]
                logger.info("Tool binding [T2-suffix]: '%s' matched '%s' (1 tool)", suffix, mcp_tools[0].name)

            # Tier 3: service-prefix fallback
            elif safe_service:
                prefix = f"fetch_{safe_service}_"
                filtered = [t for t in mcp_tools if t.name.startswith(prefix)]
                if filtered:
                    mcp_tools = filtered
                logger.info("Tool binding [T3-prefix]: '%s' (%d tools)", prefix, len(mcp_tools))

    tools_desc = "\n".join(f"- {t.name}: {t.description}" for t in mcp_tools)
    
    # Inject tool context to system prompt to help both tool binding and fallback parsing
    dynamic_system_prompt = SYSTEM_PROMPT + f"\n\n## Available MCP OData Tools:\n" \
                                             f"You MUST use the appropriate tool to fetch data for your query. " \
                                             f"Parameters like filter, select, top, skip, expand must be mapped correctly.\n{tools_desc}"

    if mcp_instructions:
        instructions_str = "\n".join(f"- {inst}" for inst in mcp_instructions)
        dynamic_system_prompt += f"\n\n## Custom MCP Instructions:\n{instructions_str}"

    logger.info("Generating response with model: %s", model_name)

    try:
        llm = get_llm(
            model_name=model_name,
            temperature=0,
            max_tokens=2048,
        )

        # Build OpenAI tool definitions from MCP tool schemas
        openai_tools = []
        for tool in mcp_tools:
            openai_tools.append({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.inputSchema
                }
            })

        # Bind tools to LLM with fallback safety
        try:
            if openai_tools:
                llm_with_tools = llm.bind_tools(openai_tools)
            else:
                llm_with_tools = llm
        except Exception as tool_err:
            logger.warning("Failed to bind tools to LLM: %s. Falling back to unbound model.", tool_err)
            llm_with_tools = llm

        llm_messages = [
            SystemMessage(content=dynamic_system_prompt),
            HumanMessage(
                content=(
                    f"## Retrieved Context\n\n{context_block}\n\n"
                    f"---\n\n## User Query\n{user_query}\n\n"
                    "Generate the appropriate response following the output format rules."
                )
            ),
        ]

        response = await llm_with_tools.ainvoke(llm_messages)
        usage = extract_token_usage(response)
        current_token_usage = state.get("token_usage") or {"input": 0, "output": 0, "total": 0}
        new_token_usage = {
            "input": current_token_usage.get("input", 0) + usage["input"],
            "output": current_token_usage.get("output", 0) + usage["output"],
            "total": current_token_usage.get("total", 0) + usage["total"]
        }
        raw_content = response.content.strip() if response.content else ""

        # Strip reasoning thoughts if present
        import re
        content = re.sub(r'<think>[\s\S]*?</think>', '', raw_content).strip()

        logger.info("Raw LLM response preview: %s", content[:150])

        # 1. Native Tool Calling Handling
        if hasattr(response, "tool_calls") and response.tool_calls:
            tool_call = response.tool_calls[0]
            logger.info("LLM generated native tool call: %s", tool_call)
            
            tool_call_json = json.dumps({
                "tool": tool_call["name"],
                "arguments": tool_call["args"]
            })

            # Check if text response has a python calculation script
            python_code = ""
            if "```python" in content:
                python_code = content.split("```python")[1].split("```")[0].strip()
            elif "```" in content:
                python_code = content.split("```")[1].split("```")[0].strip()

            if python_code:
                updates = {
                    "generated_query": tool_call_json,
                    "calculation_script": python_code,
                    "query_type": "calculation",
                    "needs_calculation": True,
                    "error": "",
                    "retry_count": retry_count,
                    "token_usage": new_token_usage,
                }
            else:
                updates = {
                    "generated_query": tool_call_json,
                    "query_type": "odata",
                    "needs_calculation": False,
                    "error": "",
                    "retry_count": retry_count,
                    "token_usage": new_token_usage,
                }
            
            if should_clear_buffer:
                updates["data_buffer"] = []
            return updates

        # 2. Resilient Text Prefix Parsing Fallback
        parsed_prefix = None
        cleaned_content = content
        
        if "[SCRIPT]" in content:
            parsed_prefix = "calculation"
            cleaned_content = content[content.find("[SCRIPT]"):].strip()
        elif "[ODATA]" in content:
            parsed_prefix = "odata"
            cleaned_content = content[content.find("[ODATA]"):].strip()
        elif "[ANSWER]" in content:
            parsed_prefix = "direct_answer"
            cleaned_content = content[content.find("[ANSWER]"):].strip()
        elif content.startswith("OData:") or "OData:" in content:
            parsed_prefix = "calculation"
            if "OData:" in content:
                cleaned_content = content[content.find("OData:"):].strip()
        
        logger.info("Parser resolved fallback prefix type: %s", parsed_prefix or "fallback_direct")

        # Parse response based on resolved prefix
        if parsed_prefix == "odata":
            updates = {
                "generated_query": cleaned_content[7:].strip(),
                "query_type": "odata",
                "needs_calculation": False,
                "error": "",
                "retry_count": retry_count,
                "token_usage": new_token_usage,
            }
            if should_clear_buffer:
                updates["data_buffer"] = []
            return updates
        elif parsed_prefix == "calculation":
            content_to_parse = cleaned_content[8:].strip() if cleaned_content.startswith("[SCRIPT]") else cleaned_content
            odata_query = ""
            python_code = ""
            
            odata_match = re.search(r"OData:\s*([^\n]+)", content_to_parse)
            if odata_match:
                odata_query = odata_match.group(1).strip()
            
            if "```python" in content_to_parse:
                python_code = content_to_parse.split("```python")[1].split("```")[0].strip()
            elif "```" in content_to_parse:
                python_code = content_to_parse.split("```")[1].split("```")[0].strip()
            else:
                code_parts = content_to_parse.split("Code:")
                if len(code_parts) > 1:
                    python_code = code_parts[1].strip()
            
            if not odata_query:
                path_match = re.search(r"/([A-Za-z0-9_]+Set|[A-Za-z0-9_]+)", content_to_parse)
                if path_match:
                    odata_query = path_match.group(0).strip()
                else:
                    odata_query = "/Customers"
            
            updates = {
                "generated_query": odata_query,
                "calculation_script": python_code,
                "query_type": "calculation",
                "needs_calculation": True,
                "error": "",
                "retry_count": retry_count,
                "token_usage": new_token_usage,
            }
            if should_clear_buffer:
                updates["data_buffer"] = []
            return updates
        else:
            answer = cleaned_content
            if cleaned_content.startswith("[ANSWER]"):
                answer = cleaned_content[8:].strip()
            updates = {
                "generated_query": "",
                "query_type": "direct_answer",
                "needs_calculation": False,
                "final_response": answer,
                "error": "",
                "retry_count": retry_count,
                "token_usage": new_token_usage,
            }
            if should_clear_buffer:
                updates["data_buffer"] = []
            return updates

    except Exception as e:
        logger.error("LLM generation failed: %s", e)
        error_msg = str(e)
        if "api_key" in error_msg.lower() or "authentication" in error_msg.lower():
            return {
                "generated_query": "",
                "query_type": "direct_answer",
                "needs_calculation": False,
                "final_response": (
                    "⚠️ Groq API key is not configured. "
                    "Please set your `GROQ_API_KEY` in the `.env` file.\n\n"
                    "You can get a free API key at https://console.groq.com"
                ),
                "error": error_msg,
                "retry_count": retry_count,
            }
        return {
            "generated_query": "",
            "query_type": "direct_answer",
            "needs_calculation": False,
            "final_response": f"I encountered an error while processing your request: {error_msg}",
            "error": error_msg,
            "retry_count": retry_count,
        }

