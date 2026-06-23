"""
Chat Route — POST /api/chat

Accepts user messages + model selection, runs the LangGraph pipeline,
and streams the response back as Server-Sent Events (SSE).
"""

import json
import logging
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage

from app.graph.builder import get_graph
from app.services.db_client import get_db

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/api/chat")
async def chat_endpoint(request: Request):
    """Stream a chat response using the LangGraph pipeline.

    Request body:
    {
        "messages": [{"role": "user", "content": "..."}],
        "model": "llama-3.3-70b-versatile",
        "thread_id": "thread:xxx"
    }

    Response: SSE stream with events:
        data: {"type": "token", "content": "..."}
        data: {"type": "done", "content": "..."}
    """
    body = await request.json()
    messages = body.get("messages", [])
    model_name = body.get("model", "llama-3.3-70b-versatile")
    thread_id = body.get("thread_id", "")

    if not messages:
        return StreamingResponse(
            iter(['data: {"type": "error", "content": "No messages provided"}\n\n']),
            media_type="text/event-stream",
        )

    async def stream_response():
        """Run the LangGraph pipeline and stream results."""
        try:
            graph = get_graph()

            # Convert frontend messages to LangChain format
            lc_messages = []
            for msg in messages:
                if msg.get("role") == "user":
                    lc_messages.append(HumanMessage(content=msg["content"]))

            # Build initial state
            initial_state: dict[str, Any] = {
                "messages": lc_messages,
                "thread_id": thread_id,
                "model_name": model_name,
                "query_vector": [],
                "matched_entity": {},
                "graph_context": "",
                "memory_context": "",
                "schema_context": "",
                "generated_query": "",
                "calculation_script": "",
                "needs_calculation": False,
                "query_type": "direct_answer",
                "data_buffer": [],
                "has_next_page": "",
                "calculation_result": "",
                "final_response": "",
                "error": "",
                "retry_count": 0,
                "first_failed_query": "",
                "first_error": "",
                "candidate_entities": [],
                "instruction_plan": {},
            }

            # Send initial message log
            current_log = "*   🧠 **Embedding**: Generating 768-dim query vector using local `nomic-embed-text`..."
            yield f'data: {json.dumps({"type": "status", "content": current_log})}\n\n'

            # Run the graph using dynamic streaming of node updates
            result = dict(initial_state)
            
            async for chunk in graph.astream(initial_state, stream_mode="updates"):
                if not chunk:
                    continue
                node_name = list(chunk.keys())[0]
                state_update = chunk[node_name]
                
                # Merge the updates into our result state
                if state_update and isinstance(state_update, dict):
                    result.update(state_update)
                
                # Build incremental pipeline logs based on which node just completed
                if node_name == "embed_query":
                    current_log += "\n*   🗄️ **Graph & Vector RAG**: Querying local SurrealDB instance..."
                    yield f'data: {json.dumps({"type": "status", "content": current_log})}\n\n'
                elif node_name == "retrieve_context":
                    matched = result.get("matched_entity", {})
                    if matched:
                        name = matched.get("name", "Unknown")
                        entity_set = matched.get("entity_set", "N/A")
                        current_log += f"\n    *   *Cosine match*: matched entity **{name}** (EntitySet: `{entity_set}`)"
                    else:
                        current_log += "\n    *   *Cosine match*: no direct entity matched. Using general routing."
                    
                    current_log += "\n*   🤖 **Groq LLM Plan**: Generating query parameters and code structure via Groq Llama 3..."
                    yield f'data: {json.dumps({"type": "status", "content": current_log})}\n\n'
                elif node_name == "generate_response":
                    query_type = result.get("query_type", "direct_answer")
                    generated_query = result.get("generated_query", "")
                    retry_count = result.get("retry_count", 0)
                    
                    if retry_count > 0:
                        current_log += f"\n*   🔄 **Self-Healing Retry #{retry_count}**: Analyzing previous failure and adjusting strategy..."
                    
                    if query_type == "odata":
                        current_log += f"\n    *   *Generated query*: OData URL `/{generated_query}`"
                        current_log += "\n*   ⚡ **Gateway Call**: Executing live query on OData target endpoint..."
                    elif query_type == "calculation":
                        # Extract first few lines of python code snippet
                        code = generated_query
                        if "```python" in code:
                            code = code.split("```python")[1].split("```")[0].strip()
                        lines = code.split("\n")
                        snippet = "\n".join(lines[:3]) + ("\n    ..." if len(lines) > 3 else "")
                        current_log += f"\n    *   *Generated script snippet*:\n```python\n{snippet}\n```"
                        current_log += "\n*   ⚡ **Gateway Call**: Fetching base tables from OData service..."
                    else:
                        current_log += "\n    *   *Generated response*: formulated direct textual explanation."
                        current_log += "\n*   📊 **Egress**: Compiling final response..."
                    
                    yield f'data: {json.dumps({"type": "status", "content": current_log})}\n\n'
                elif node_name == "execute_odata":
                    # Clean up any previous execute_odata log updates to overwrite progress in-place
                    if "\n    *   *Succeeded*: retrieved" in current_log:
                        idx = current_log.find("\n    *   *Succeeded*: retrieved")
                        if idx != -1:
                            current_log = current_log[:idx]
                    elif "\n    *   *Error*:" in current_log:
                        idx = current_log.find("\n    *   *Error*:")
                        if idx != -1:
                            current_log = current_log[:idx]
                            
                    data_buffer = result.get("data_buffer", [])
                    has_next = result.get("has_next_page", "")
                    error = result.get("error", "")
                    
                    if error:
                        current_log += f"\n    *   *Error*: {error}"
                    else:
                        total_count = result.get("total_count")
                        if total_count is not None:
                            current_log += f"\n    *   *Succeeded*: retrieved **{len(data_buffer)}** records (Showing {len(data_buffer)}/{total_count} records)."
                        else:
                            current_log += f"\n    *   *Succeeded*: retrieved **{len(data_buffer)}** records from service."
                        
                        if has_next:
                            current_log += f"\n    *   *Pagination nextLink detected*: `{has_next[:50]}...` (fetching next page...)"
                    
                    # Only append next step headers when pagination has fully completed
                    if not has_next:
                        needs_calc = result.get("needs_calculation", False)
                        if needs_calc:
                            current_log += "\n*   🧮 **Calculation Sandbox**: Spawning isolated python host subprocess..."
                        else:
                            current_log += "\n*   📊 **Egress**: Compiling tables and chart configurations..."
                    
                    yield f'data: {json.dumps({"type": "status", "content": current_log})}\n\n'
                elif node_name == "run_sandbox":
                    calc_res = result.get("calculation_result", "")
                    error = result.get("error", "")
                    
                    if error:
                        current_log += f"\n    *   *Error*: {error}"
                    else:
                        snippet = calc_res[:100] + ("..." if len(calc_res) > 100 else "")
                        current_log += f"\n    *   *Calculation completed!* Output: `{snippet}`"
                    
                    current_log += "\n*   📊 **Egress**: Compiling tables and chart configurations..."
                    yield f'data: {json.dumps({"type": "status", "content": current_log})}\n\n'

            # Extract final response
            import re
            final_response = result.get("final_response", "")

            if not final_response:
                # Try to extract from the last AI message
                result_messages = result.get("messages", [])
                if result_messages:
                    last_msg = result_messages[-1]
                    if hasattr(last_msg, "content"):
                        final_response = last_msg.content

            if not final_response:
                final_response = "I couldn't generate a response. Please try rephrasing your question."

            # Clean up <think>...</think> tags if reasoning LLM models generated them
            final_response = re.sub(r'<think>[\s\S]*?</think>', '', final_response).strip()

            # Append token usage metadata
            token_usage = result.get("token_usage") or {"input": 0, "output": 0, "total": 0}
            input_tokens = token_usage.get("input", 0)
            output_tokens = token_usage.get("output", 0)
            total_tokens = token_usage.get("total", 0)
            
            token_footer = (
                f"\n\n---\n"
                f"*Token Usage:* 🪙 **Input**: {input_tokens:,} | "
                f"📤 **Output**: {output_tokens:,} | "
                f"📊 **Total**: {total_tokens:,} tokens"
            )
            final_response += token_footer

            # Stream the response token by token for a natural feel
            words = final_response.split(" ")
            chunks = []
            current_chunk = ""
            for word in words:
                current_chunk += word + " "
                if len(current_chunk) > 20:  # Send in small chunks
                    chunks.append(current_chunk)
                    current_chunk = ""
            if current_chunk:
                chunks.append(current_chunk)

            for chunk in chunks:
                event_data = json.dumps({"type": "token", "content": chunk})
                yield f"data: {event_data}\n\n"

            # Save messages to thread history
            if thread_id:
                try:
                    db = get_db()
                    # Save user message
                    user_content = messages[-1].get("content", "")
                    await db.query(f"""
                        CREATE message SET
                            thread = {thread_id},
                            role = 'user',
                            content = '{user_content.replace("'", "\\'")}',
                            created_at = time::now();
                    """)
                    # Save assistant response
                    await db.query(f"""
                        CREATE message SET
                            thread = {thread_id},
                            role = 'assistant',
                            content = '{final_response.replace("'", "\\'")}',
                            created_at = time::now();
                    """)
                    # Update thread timestamp and auto-title (only if title is still the default "New Chat")
                    if user_content:
                        thread_data = await db.query(f"SELECT title FROM {thread_id};")
                        current_title = "New Chat"
                        if thread_data:
                            current_title = thread_data[0].get("title", "New Chat")
                        
                        if current_title == "New Chat":
                            title = user_content[:50] + ("..." if len(user_content) > 50 else "")
                            await db.query(f"""
                                UPDATE {thread_id} SET
                                    updated_at = time::now(),
                                    title = '{title.replace("'", "\\'")}';
                            """)
                        else:
                            await db.query(f"""
                                UPDATE {thread_id} SET
                                    updated_at = time::now();
                            """)
                except Exception as e:
                    logger.warning("Failed to save thread messages: %s", e)

            # Send completion event
            yield 'data: {"type": "done"}\n\n'

        except Exception as e:
            logger.error("Chat pipeline error: %s", e)
            error_data = json.dumps({"type": "error", "content": str(e)})
            yield f"data: {error_data}\n\n"

    return StreamingResponse(
        stream_response(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/api/schema-graph")
async def get_schema_graph():
    """Retrieve the visual schema graph dynamically from SurrealDB.

    Fetches nodes (sap_entities) and relationship edges (expands_to, belongs_to, depends_on)
    and formats them dynamically as a clean chart structure.
    """
    db = get_db()
    try:
        # 1. Fetch all nodes (SAP Entities)
        nodes_raw = await db.query("""
            SELECT
                id, name, entity_set, module, description, odata_url, key_fields, metadata_schema
            FROM sap_entities;
        """)
        
        # 2. Fetch all edges (expands_to, belongs_to, depends_on)
        edges_raw = []
        for table in ["expands_to", "belongs_to", "depends_on"]:
            try:
                res = await db.query(f"SELECT in AS from, out AS to, '{table}' AS type FROM {table};")
                edges_raw.extend(res)
            except Exception as edge_err:
                logger.warning("Failed to query edges from table %s: %s", table, edge_err)
        
        
        # Format the nodes dynamically for the client
        nodes = []
        for n in nodes_raw:
            columns = []
            schema_str = n.get("metadata_schema", "")
            if schema_str:
                try:
                    schema_dict = json.loads(schema_str)
                    props = schema_dict.get("properties", {})
                    key_fields = n.get("key_fields", [])
                    for name, prop_info in props.items():
                        columns.append({
                            "name": name,
                            "type": prop_info.get("type", "string"),
                            "isKey": name in key_fields
                        })
                except Exception as parse_err:
                    logger.warning("Failed to parse metadata_schema for %s: %s", n.get("name"), parse_err)
            
            nodes.append({
                "id": str(n["id"]), # e.g. "sap_entities:northwind_customers"
                "name": n.get("name", "Unknown"),
                "entitySet": n.get("entity_set", "N/A"),
                "module": n.get("module", "General"),
                "description": n.get("description", ""),
                "url": n.get("odata_url", ""),
                "columns": columns
            })
            
        # Format the edges dynamically
        edges = []
        for e in edges_raw:
            edges.append({
                "from": str(e["from"]),
                "to": str(e["to"]),
                "label": e.get("type", "references")
            })
            
        return {
            "nodes": nodes,
            "edges": edges
        }
    except Exception as e:
        logger.error("Failed to query schema-graph: %s", e)
        return {
            "nodes": [],
            "edges": [],
            "error": str(e)
        }

