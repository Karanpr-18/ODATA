"""
OData MCP Server — Custom Model Context Protocol server
that exposes registered OData entities as MCP tools.

Runs as a stdio server and is managed by the LangGraph backend.
"""

import asyncio
import json
import logging
import os
import sys
from urllib.parse import urljoin

# Ensure the backend directory is in the path so we can import app
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../backend")))

import httpx

from app.config import get_settings

logging.basicConfig(level=logging.INFO, stream=sys.stderr)
logger = logging.getLogger(__name__)

# Configuration from environment
SURREAL_URL = os.environ.get("SURREAL_URL", "http://localhost:8001")
SURREAL_USER = os.environ.get("SURREAL_USER", "root")
SURREAL_PASS = os.environ.get("SURREAL_PASS", "root")
SURREAL_NS = os.environ.get("SURREAL_NS", "sap")
SURREAL_DB = os.environ.get("SURREAL_DB", "odata")


async def surreal_query(surql: str, vars: dict = None) -> list:
    """Execute a SurrealQL query via the HTTP API."""
    scoped_query = f"USE NS {SURREAL_NS}; USE DB {SURREAL_DB}; {surql}"
    
    if vars:
        for key, value in vars.items():
            placeholder = f"${key}"
            if isinstance(value, (list, dict)):
                scoped_query = scoped_query.replace(placeholder, json.dumps(value))
            elif isinstance(value, str):
                escaped = value.replace("'", "\\'")
                scoped_query = scoped_query.replace(placeholder, f"'{escaped}'")
            elif isinstance(value, bool):
                scoped_query = scoped_query.replace(placeholder, "true" if value else "false")
            elif value is None:
                scoped_query = scoped_query.replace(placeholder, "NONE")
            else:
                scoped_query = scoped_query.replace(placeholder, str(value))
                
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
            actual_statements = data[2:] if len(data) > 2 else data
            for stmt in actual_statements:
                if stmt.get("status") == "OK":
                    result = stmt.get("result")
                    if isinstance(result, list):
                        results.extend(result)
                    elif result is not None:
                        results.append(result)
        return results


# ── Mock Data for Local Development ──
MOCK_DATA = {
    "customers": [
        {"CustomerID": "ALFKI", "CompanyName": "Alfreds Futterkiste", "ContactName": "Maria Anders", "City": "Berlin", "Country": "Germany"},
        {"CustomerID": "ANATR", "CompanyName": "Ana Trujillo Emparedados y helados", "ContactName": "Ana Trujillo", "City": "México D.F.", "Country": "Mexico"},
        {"CustomerID": "ANTON", "CompanyName": "Antonio Moreno Taquería", "ContactName": "Antonio Moreno", "City": "México D.F.", "Country": "Mexico"},
        {"CustomerID": "AROUT", "CompanyName": "Around the Horn", "ContactName": "Thomas Hardy", "City": "London", "Country": "UK"},
        {"CustomerID": "BERGS", "CompanyName": "Berglunds snabbköp", "ContactName": "Christina Berglund", "City": "Luleå", "Country": "Sweden"},
    ],
    "orders": [
        {"OrderID": 10248, "CustomerID": "VINET", "OrderDate": "1996-07-04T00:00:00", "ShipCity": "Reims", "ShipCountry": "France"},
        {"OrderID": 10249, "CustomerID": "TOMSP", "OrderDate": "1996-07-05T00:00:00", "ShipCity": "Münster", "ShipCountry": "Germany"},
        {"OrderID": 10250, "CustomerID": "HANAR", "OrderDate": "1996-07-08T00:00:00", "ShipCity": "Rio de Janeiro", "ShipCountry": "Brazil"},
    ],
    "invoices": [
        {"OrderID": 10248, "CustomerID": "VINET", "CustomerName": "Vins et alcools Chevalier", "ShipCity": "Reims", "ShipCountry": "France", "ExtendedPrice": 440.00, "Freight": 32.38, "ProductName": "Queso Cabrales"},
        {"OrderID": 10249, "CustomerID": "TOMSP", "CustomerName": "Toms Spezialitäten", "ShipCity": "Münster", "ShipCountry": "Germany", "ExtendedPrice": 1863.40, "Freight": 11.61, "ProductName": "Tofu"},
        {"OrderID": 10250, "CustomerID": "HANAR", "CustomerName": "Hanari Carnes", "ShipCity": "Rio de Janeiro", "ShipCountry": "Brazil", "ExtendedPrice": 1550.00, "Freight": 65.83, "ProductName": "Clam Chowder"},
        {"OrderID": 10251, "CustomerID": "VICTE", "CustomerName": "Victuailles en stock", "ShipCity": "Lyon", "ShipCountry": "France", "ExtendedPrice": 654.30, "Freight": 41.34, "ProductName": "Dried Apples"},
        {"OrderID": 10252, "CustomerID": "SUPRD", "CustomerName": "Suprêmes délices", "ShipCity": "Charleroi", "ShipCountry": "Belgium", "ExtendedPrice": 3597.90, "Freight": 51.30, "ProductName": "Camembert"},
    ],
    "fi_invoiceset": [
        {"InvoiceNumber": "INV-2024-001", "CompanyCode": "1000", "CustomerName": "Acme Corp", "Amount": 45000.0, "Currency": "INR", "PostingDate": "2024-06-15", "Status": "Open"},
        {"InvoiceNumber": "INV-2024-002", "CompanyCode": "1000", "CustomerName": "TechVision Ltd", "Amount": 128000.0, "Currency": "INR", "PostingDate": "2024-07-22", "Status": "Paid"},
    ],
    "sd_salesorderset": [
        {"SalesOrderNumber": "SO-2024-101", "CustomerName": "Acme Corp", "MaterialNumber": "MAT-001", "Quantity": 100, "UnitPrice": 450.0, "TotalAmount": 45000.0},
    ],
    "mm_purchaseorderset": [
        {"PONumber": "PO-2024-501", "VendorName": "Steel Works Inc", "MaterialNumber": "MAT-001", "Quantity": 500, "UnitPrice": 200.0},
    ]
}


def generate_dynamic_mock_data(schema_str: str, entity_set_name: str, count: int = 5) -> list:
    """Generate dynamic mock records based on the OData entity schema."""
    properties = {}
    try:
        if schema_str:
            schema = json.loads(schema_str)
            properties = schema.get("properties", {})
    except Exception as e:
        logger.warning("Failed to parse schema for mock generation: %s", e)
        
    # If no properties parsed, return general mock data fallback
    if not properties:
        entity_lower = entity_set_name.lower()
        if "invoice" in entity_lower:
            return MOCK_DATA["invoices"]
        elif "order" in entity_lower:
            return MOCK_DATA["orders"]
        elif "customer" in entity_lower:
            return MOCK_DATA["customers"]
        return MOCK_DATA["customers"]

    countries = ["Germany", "France", "Brazil", "UK", "Mexico", "USA", "Canada", "Japan", "India", "Australia"]
    cities = ["Berlin", "Paris", "Rio de Janeiro", "London", "Mexico City", "New York", "Toronto", "Tokyo", "Mumbai", "Sydney"]
    names = ["Alfreds Futterkiste", "Toms Spezialitäten", "Hanari Carnes", "Vins et alcools Chevalier", "Suprêmes délices"]
    
    mock_records = []
    for i in range(count):
        record = {}
        for col_name, prop_info in properties.items():
            col_lower = col_name.lower()
            prop_type = prop_info.get("type", "string")
            prop_format = prop_info.get("format", "")
            
            if prop_format == "date-time" or "date" in col_lower:
                record[col_name] = f"2026-06-{10+i:02d}T08:30:00"
            elif prop_type == "number" or prop_type == "integer" or "int" in prop_type:
                if "id" in col_lower or "number" in col_lower:
                    record[col_name] = 1000 + i
                elif "price" in col_lower or "amount" in col_lower or "sum" in col_lower or "freight" in col_lower:
                    record[col_name] = round(150.0 + i * 85.5, 2)
                elif "quantity" in col_lower or "qty" in col_lower or "count" in col_lower:
                    record[col_name] = 10 * (i + 1)
                else:
                    record[col_name] = i + 1
            elif prop_type == "boolean":
                record[col_name] = (i % 2 == 0)
            else:
                # String types
                if "country" in col_lower:
                    record[col_name] = countries[i % len(countries)]
                elif "city" in col_lower:
                    record[col_name] = cities[i % len(cities)]
                elif "name" in col_lower or "customer" in col_lower or "vendor" in col_lower:
                    record[col_name] = names[i % len(names)]
                elif "id" in col_lower:
                    record[col_name] = f"ID{100+i}"
                else:
                    record[col_name] = f"{col_name}_val_{i+1}"
        mock_records.append(record)
        
    return mock_records


async def execute_odata_call(record: dict, arguments: dict) -> list:
    """Make actual httpx OData call or return mock data."""
    settings = get_settings()
    service_url = record.get("service_url") or settings.sap_odata_base_url
    odata_path = record.get("odata_url", "").lstrip("/")
    
    # Check if mock mode
    is_mock = "example.com" in service_url or not service_url
    if is_mock:
        logger.info("Mock mode active for service_url: %s", service_url)
        schema_str = record.get("metadata_schema", "")
        entity_name = record.get("entity_set", "")
        mock_results = generate_dynamic_mock_data(schema_str, entity_name)
        
        # Apply mock pagination if requested
        total_count = 1100 # Default large mock count
        if arguments.get("top") is not None:
            top = int(arguments["top"])
            mock_results = mock_results[:top]
        
        return {"results": mock_results, "total_count": total_count}

    # Resolve URL
    base_url_slash = service_url if service_url.endswith("/") else f"{service_url}/"
    full_url = urljoin(base_url_slash, odata_path)

    # Build params
    params = {}
    params["$inlinecount"] = "allpages" # Request total count for UI pagination feedback
    
    if arguments.get("filter"):
        params["$filter"] = arguments["filter"]
    if arguments.get("select"):
        params["$select"] = arguments["select"]
    if arguments.get("top") is not None:
        params["$top"] = arguments["top"]
    if arguments.get("skip") is not None:
        params["$skip"] = arguments["skip"]
    if arguments.get("expand"):
        params["$expand"] = arguments["expand"]

    headers = {
        "Accept": "application/json",
    }
    if settings.sap_client:
        headers["sap-client"] = settings.sap_client

    logger.info("Executing OData HTTP call: %s with params %s", full_url, params)
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(full_url, params=params, headers=headers)
        response.raise_for_status()
        data = response.json()

        results = []
        total_count = None
        
        if isinstance(data, list):
            results = data
        elif isinstance(data, dict):
            # OData v4
            if "@odata.count" in data:
                total_count = data["@odata.count"]
            if "value" in data:
                results = data["value"]
            # OData v2
            elif "d" in data:
                d_data = data["d"]
                if isinstance(d_data, dict):
                    if "__count" in d_data:
                        total_count = d_data["__count"]
                    if "results" in d_data:
                        results = d_data["results"]
                    else:
                        results = [d_data]
                elif isinstance(d_data, list):
                    results = d_data
                else:
                    results = [d_data]
            else:
                results = [data]
                
        try:
            if total_count is not None:
                total_count = int(total_count)
        except (ValueError, TypeError):
            total_count = None
            
        return {"results": results, "total_count": total_count}


async def get_registered_tools() -> list:
    """Retrieve all registered entities from SurrealDB and format them as MCP tools."""
    try:
        records = await surreal_query("SELECT * FROM sap_entities;")
        tools = []
        for r in records:
            service_name = r.get("module", "default")
            entity_set = r.get("entity_set", "")
            safe_service = service_name.lower().replace(" ", "_").replace("-", "_")
            safe_entity = entity_set.lower().replace(" ", "_").replace("-", "_")
            tool_name = f"fetch_{safe_service}_{safe_entity}"
            
            tools.append({
                "name": tool_name,
                "description": f"Fetch records from entity set '{entity_set}' of service '{service_name}'. "
                               f"Description: {r.get('description', '')}",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "filter": {
                            "type": "string",
                            "description": "OData $filter expression (e.g. \"Country eq 'Germany'\")"
                        },
                        "select": {
                            "type": "string",
                            "description": "OData $select comma-separated fields (e.g. \"CustomerID,CompanyName\")"
                        },
                        "top": {
                            "type": "integer",
                            "description": "OData $top count limit (e.g. 5)"
                        },
                        "skip": {
                            "type": "integer",
                            "description": "OData $skip offset count (e.g. 10)"
                        },
                        "expand": {
                            "type": "string",
                            "description": "OData $expand navigation property bindings (e.g. \"Orders\")"
                        }
                    }
                }
            })
        return tools
    except Exception as e:
        logger.error("Failed to retrieve registered tools: %s", e)
        return []


async def handle_tool_call(name: str, arguments: dict) -> str:
    """Route tool call to the corresponding OData service."""
    if not name.startswith("fetch_"):
        return json.dumps({"error": f"Unknown tool format: {name}"})

    target_suffix = name[6:]  # strip 'fetch_'
    
    # We query SurrealDB to find the specific entity node matching this tool
    try:
        # Check by reconstructed node ID
        node_id = f"sap_entities:dynamic_{target_suffix}"
        records = await surreal_query(f"SELECT * FROM {node_id};")
        
        # If not found by exact dynamic ID (e.g. static ones or custom ids), search by matching safe names
        if not records:
            all_records = await surreal_query("SELECT * FROM sap_entities;")
            for r in all_records:
                service_name = r.get("module", "default")
                entity_set = r.get("entity_set", "")
                safe_service = service_name.lower().replace(" ", "_").replace("-", "_")
                safe_entity = entity_set.lower().replace(" ", "_").replace("-", "_")
                if f"{safe_service}_{safe_entity}" == target_suffix:
                    records = [r]
                    break
        
        if not records:
            return json.dumps({"error": f"No registered entity matches tool {name}"})

        record = records[0]
        results = await execute_odata_call(record, arguments)
        return json.dumps(results, default=str)
    except Exception as e:
        logger.error("Error executing tool call %s: %s", name, e)
        return json.dumps({"error": str(e)})


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
                "serverInfo": {"name": "odata-mcp", "version": "0.1.0"},
            },
        }

    elif method == "tools/list":
        tools = await get_registered_tools()
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"tools": tools},
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
        return None

    else:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32601, "message": f"Method not found: {method}"},
        }


async def main():
    """Main loop: read JSON-RPC messages from stdin, write responses to stdout."""
    logger.info("OData MCP Server starting (stdio mode)")

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
