"""
SurrealDB MCP Server — Custom Model Context Protocol server
that exposes SurrealDB graph and vector operations as MCP tools.

Runs as a stdio server and is managed by the LangGraph backend.
"""

import asyncio
import json
import logging
import os
import sys

# Ensure the project root is in the path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import httpx

logging.basicConfig(level=logging.INFO, stream=sys.stderr)
logger = logging.getLogger(__name__)

# Configuration from environment
SURREAL_URL = os.environ.get("SURREAL_URL", "http://localhost:8001")
SURREAL_USER = os.environ.get("SURREAL_USER", "root")
SURREAL_PASS = os.environ.get("SURREAL_PASS", "root")
SURREAL_NS = os.environ.get("SURREAL_NS", "sap")
SURREAL_DB = os.environ.get("SURREAL_DB", "odata")


async def surreal_query(surql: str) -> list:
    """Execute a SurrealQL query via the HTTP API."""
    scoped_query = f"USE NS {SURREAL_NS}; USE DB {SURREAL_DB}; {surql}"
    async with httpx.AsyncClient(
        base_url=SURREAL_URL,
        auth=(SURREAL_USER, SURREAL_PASS),
        timeout=30.0,
    ) as client:
        response = await client.post(
            "/sql",
            content=scoped_query,
            headers={"Content-Type": "text/plain", "Accept": "application/json"},
        )
        response.raise_for_status()
        data = response.json()

        results = []
        if isinstance(data, list):
            # Since we prepended exactly two "USE" statements, the first two results in
            # the list are scope metadata. We slice them out to get the actual query results.
            actual_statements = data[2:] if len(data) > 2 else data
            for stmt in actual_statements:
                if stmt.get("status") == "OK":
                    result = stmt.get("result")
                    if isinstance(result, list):
                        results.extend(result)
                    elif result is not None:
                        results.append(result)
        return results


# ── MCP Tool Definitions ──

TOOLS = [
    {
        "name": "vector_search",
        "description": "Search SAP entities by semantic similarity using a query embedding vector",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query_embedding": {
                    "type": "array",
                    "items": {"type": "number"},
                    "description": "768-dimensional embedding vector",
                },
                "table": {
                    "type": "string",
                    "description": "Table to search (default: sap_entities)",
                    "default": "sap_entities",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum results to return",
                    "default": 5,
                },
            },
            "required": ["query_embedding"],
        },
    },
    {
        "name": "graph_traverse",
        "description": "Traverse graph relations from a starting SAP entity node",
        "inputSchema": {
            "type": "object",
            "properties": {
                "start_node": {
                    "type": "string",
                    "description": "Starting node ID (e.g., sap_entities:fi_invoices)",
                },
                "path": {
                    "type": "string",
                    "description": "Graph traversal path using arrow syntax (e.g., ->expands_to->sap_entities)",
                },
            },
            "required": ["start_node", "path"],
        },
    },
    {
        "name": "query",
        "description": "Execute a raw SurrealQL query",
        "inputSchema": {
            "type": "object",
            "properties": {
                "surql": {
                    "type": "string",
                    "description": "SurrealQL query string",
                },
            },
            "required": ["surql"],
        },
    },
    {
        "name": "search_memory",
        "description": "Search agent memory for past user corrections by semantic similarity",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query_embedding": {
                    "type": "array",
                    "items": {"type": "number"},
                    "description": "768-dimensional embedding vector",
                },
                "user_id": {
                    "type": "string",
                    "description": "User ID filter (default: all users)",
                    "default": "default",
                },
                "limit": {
                    "type": "integer",
                    "default": 5,
                },
            },
            "required": ["query_embedding"],
        },
    },
    {
        "name": "save_memory",
        "description": "Save a user correction or preference to agent memory",
        "inputSchema": {
            "type": "object",
            "properties": {
                "user_id": {"type": "string", "default": "default"},
                "correction": {"type": "string", "description": "The correction text"},
                "context": {"type": "string", "description": "Context of the correction"},
                "embedding": {
                    "type": "array",
                    "items": {"type": "number"},
                    "description": "768-dim embedding of the correction",
                },
            },
            "required": ["correction", "embedding"],
        },
    },
]


async def handle_tool_call(name: str, arguments: dict) -> str:
    """Execute an MCP tool call and return the result as JSON string."""
    try:
        if name == "vector_search":
            embedding = arguments["query_embedding"]
            table = arguments.get("table", "sap_entities")
            limit = arguments.get("limit", 5)
            vec_json = json.dumps(embedding)
            results = await surreal_query(f"""
                SELECT *, vector::similarity::cosine(embedding, {vec_json}) AS score
                FROM {table}
                WHERE embedding <|{limit}, cosine|> {vec_json}
                ORDER BY score DESC;
            """)
            return json.dumps(results, default=str)

        elif name == "graph_traverse":
            start = arguments["start_node"]
            path = arguments["path"]
            results = await surreal_query(f"SELECT {path} FROM {start};")
            return json.dumps(results, default=str)

        elif name == "query":
            results = await surreal_query(arguments["surql"])
            return json.dumps(results, default=str)

        elif name == "search_memory":
            embedding = arguments["query_embedding"]
            limit = arguments.get("limit", 5)
            vec_json = json.dumps(embedding)
            results = await surreal_query(f"""
                SELECT correction, context,
                    vector::similarity::cosine(embedding, {vec_json}) AS score
                FROM agent_memory
                WHERE embedding <|{limit}, cosine|> {vec_json}
                ORDER BY score DESC;
            """)
            return json.dumps(results, default=str)

        elif name == "save_memory":
            correction = arguments["correction"].replace("'", "\\'")
            context = arguments.get("context", "").replace("'", "\\'")
            user_id = arguments.get("user_id", "default")
            embedding = json.dumps(arguments["embedding"])
            results = await surreal_query(f"""
                CREATE agent_memory SET
                    user_id = '{user_id}',
                    correction = '{correction}',
                    context = '{context}',
                    embedding = {embedding},
                    created_at = time::now();
            """)
            return json.dumps(results, default=str)

        else:
            return json.dumps({"error": f"Unknown tool: {name}"})

    except Exception as e:
        return json.dumps({"error": str(e)})


# ── MCP JSON-RPC Protocol Handler ──

async def handle_jsonrpc(request: dict) -> dict:
    """Handle a JSON-RPC 2.0 request."""
    method = request.get("method", "")
    req_id = request.get("id")
    params = request.get("params", {})

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "surrealdb-mcp", "version": "0.1.0"},
            },
        }

    elif method == "tools/list":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"tools": TOOLS},
        }

    elif method == "tools/call":
        tool_name = params.get("name", "")
        tool_args = params.get("arguments", {})
        result_text = await handle_tool_call(tool_name, tool_args)
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "content": [{"type": "text", "text": result_text}],
                "isError": False,
            },
        }

    elif method == "notifications/initialized":
        return None  # Notification, no response needed

    else:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32601, "message": f"Method not found: {method}"},
        }


async def main():
    """Main loop: read JSON-RPC messages from stdin, write responses to stdout."""
    logger.info("SurrealDB MCP Server starting (stdio mode)")

    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)
    await asyncio.get_event_loop().connect_read_pipe(lambda: protocol, sys.stdin)

    writer_transport, writer_protocol = await asyncio.get_event_loop().connect_write_pipe(
        asyncio.streams.FlowControlMixin, sys.stdout
    )
    writer = asyncio.StreamWriter(writer_transport, writer_protocol, reader, asyncio.get_event_loop())

    while True:
        line = await reader.readline()
        if not line:
            break

        line_str = line.decode().strip()
        if not line_str:
            continue

        try:
            request = json.loads(line_str)
            response = await handle_jsonrpc(request)

            if response is not None:
                response_str = json.dumps(response) + "\n"
                writer.write(response_str.encode())
                await writer.drain()

        except json.JSONDecodeError:
            logger.warning("Invalid JSON received: %s", line_str[:100])
        except Exception as e:
            logger.error("Error processing request: %s", e)


if __name__ == "__main__":
    asyncio.run(main())
