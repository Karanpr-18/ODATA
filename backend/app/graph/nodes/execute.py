"""
Execute Node — Calls the SAP OData Gateway and handles pagination.

Currently uses mock data since we don't have a live SAP system.
When ready, swap the mock with real HTTP calls to the SAP Gateway.
"""

import json
import logging
import os
import sys
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from app.config import get_settings
from app.graph.state import AgentState

logger = logging.getLogger(__name__)

# ── Mock SAP Data for Prototype ──
MOCK_SAP_DATA: dict[str, list[dict]] = {
    "FI_InvoiceSet": [
        {
            "InvoiceNumber": "INV-2024-001",
            "CompanyCode": "1000",
            "CustomerName": "Acme Corp",
            "Amount": 45000.00,
            "Currency": "INR",
            "PostingDate": "2024-06-15",
            "Status": "Open",
            "Region": "Delhi",
        },
        {
            "InvoiceNumber": "INV-2024-002",
            "CompanyCode": "1000",
            "CustomerName": "TechVision Ltd",
            "Amount": 128000.00,
            "Currency": "INR",
            "PostingDate": "2024-07-22",
            "Status": "Paid",
            "Region": "Mumbai",
        },
        {
            "InvoiceNumber": "INV-2024-003",
            "CompanyCode": "2000",
            "CustomerName": "Global Traders",
            "Amount": 67500.00,
            "Currency": "INR",
            "PostingDate": "2024-08-10",
            "Status": "Open",
            "Region": "Delhi",
        },
        {
            "InvoiceNumber": "INV-2024-004",
            "CompanyCode": "1000",
            "CustomerName": "Sunrise Industries",
            "Amount": 92000.00,
            "Currency": "INR",
            "PostingDate": "2024-09-01",
            "Status": "Overdue",
            "Region": "Bangalore",
        },
        {
            "InvoiceNumber": "INV-2024-005",
            "CompanyCode": "2000",
            "CustomerName": "Metro Solutions",
            "Amount": 34500.00,
            "Currency": "INR",
            "PostingDate": "2024-09-18",
            "Status": "Open",
            "Region": "Chennai",
        },
    ],
    "SD_SalesOrderSet": [
        {
            "SalesOrderNumber": "SO-2024-101",
            "CustomerName": "Acme Corp",
            "MaterialNumber": "MAT-001",
            "Quantity": 100,
            "UnitPrice": 450.00,
            "TotalAmount": 45000.00,
            "Currency": "INR",
            "OrderDate": "2024-06-10",
            "DeliveryDate": "2024-06-25",
            "Status": "Delivered",
        },
        {
            "SalesOrderNumber": "SO-2024-102",
            "CustomerName": "TechVision Ltd",
            "MaterialNumber": "MAT-003",
            "Quantity": 50,
            "UnitPrice": 2560.00,
            "TotalAmount": 128000.00,
            "Currency": "INR",
            "OrderDate": "2024-07-15",
            "DeliveryDate": "2024-08-01",
            "Status": "In Transit",
        },
    ],
    "MM_PurchaseOrderSet": [
        {
            "PONumber": "PO-2024-501",
            "VendorName": "Steel Works Inc",
            "MaterialNumber": "MAT-001",
            "Quantity": 500,
            "UnitPrice": 200.00,
            "TotalAmount": 100000.00,
            "Currency": "INR",
            "OrderDate": "2024-05-20",
            "Status": "Received",
            "Plant": "1000",
        },
        {
            "PONumber": "PO-2024-502",
            "VendorName": "ChemPro Supplies",
            "MaterialNumber": "MAT-005",
            "Quantity": 200,
            "UnitPrice": 750.00,
            "TotalAmount": 150000.00,
            "Currency": "INR",
            "OrderDate": "2024-06-01",
            "Status": "Pending",
            "Plant": "2000",
        },
    ],
}


def _match_mock_data(query: str) -> list[dict]:
    """Try to match the OData query to mock data.

    Looks for entity set names in the query string.
    """
    query_upper = query.upper()
    for entity_set, data in MOCK_SAP_DATA.items():
        if entity_set.upper() in query_upper:
            return data

    # Default: return invoice data
    return MOCK_SAP_DATA.get("FI_InvoiceSet", [])


async def run_mcp_tool(tool_name: str, arguments: dict) -> list:
    """Connect to odata_mcp server, call the tool, and return list of results."""
    server_script = os.path.join(
        os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../..")),
        "mcp_servers/odata_mcp/server.py"
    )
    
    server_params = StdioServerParameters(
        command=sys.executable,
        args=[server_script],
        env=os.environ.copy()
    )
    
    logger.info("Spawning MCP client: script=%s, tool=%s, args=%s", server_script, tool_name, arguments)
    async with stdio_client(server_params) as (read_stream, write_stream):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            result = await session.call_tool(tool_name, arguments)
            
            text_val = ""
            for item in result.content:
                if hasattr(item, "text"):
                    text_val += item.text
                elif isinstance(item, dict) and "text" in item:
                    text_val += item["text"]
            
            try:
                data = json.loads(text_val)
                if isinstance(data, dict):
                    if "error" in data:
                        raise Exception(data["error"])
                    if "results" in data or "total_count" in data:
                        return data
                return data if isinstance(data, list) else [data]
            except json.JSONDecodeError:
                raise Exception(f"Failed to parse tool result as JSON: {text_val}")


async def execute_odata(state: AgentState) -> dict[str, Any]:
    """Execute the generated OData query via the odata_mcp server."""
    import sys
    import os
    from urllib.parse import urlparse, parse_qs
    from app.services.db_client import get_db

    settings = get_settings()
    generated_query = state.get("generated_query", "")
    if generated_query:
        generated_query = generated_query.replace("\n", "").replace("\r", "").strip()
    existing_buffer = state.get("data_buffer", [])

    if not generated_query:
        return {
            "data_buffer": existing_buffer,
            "has_next_page": "",
            "error": "No OData query to execute",
        }

    # Static Query Schema Guardrails (Pre-execution validation)
    if not existing_buffer:
        from app.services.linter import validate_odata_query
        matched_entity = state.get("matched_entity", {})
        
        # If it is not a raw query but a JSON tool call, we bypass raw query linter
        is_json_tool = False
        try:
            parsed_json = json.loads(generated_query)
            if isinstance(parsed_json, dict) and "tool" in parsed_json:
                is_json_tool = True
        except:
            pass

        if not is_json_tool and matched_entity:
            lint_err = validate_odata_query(generated_query, matched_entity)
            if lint_err:
                logger.warning("OData static linter rejected query: %s. Error: %s", generated_query, lint_err)
                error_msg = f"Static Query Lint Error: {lint_err}"
                updates = {
                    "data_buffer": existing_buffer,
                    "has_next_page": "",
                    "error": error_msg,
                }
                if state.get("retry_count", 0) == 0:
                    updates["first_failed_query"] = generated_query
                    updates["first_error"] = error_msg
                return updates

    logger.info("Executing tool-based OData request: %s", generated_query[:200])

    try:
        # Determine the tool name and arguments
        tool_name = ""
        tool_args = {}

        # 1. Check if the generated query is already a serialized tool call JSON
        try:
            parsed_json = json.loads(generated_query)
            if isinstance(parsed_json, dict) and "tool" in parsed_json:
                tool_name = parsed_json["tool"]
                tool_args = parsed_json.get("arguments", {})
        except:
            pass

        # 2. Reconstruct tool call from raw OData URL string if needed (backward compatibility)
        if not tool_name:
            # Parse path and query parameters from raw query string
            parsed_url = urlparse(generated_query)
            entity_set_path = parsed_url.path.strip("/")
            query_params = parse_qs(parsed_url.query)

            db = get_db()
            # Find the registered entity set to resolve the service module namespace
            records = await db.query("SELECT * FROM sap_entities WHERE entity_set = $entity_set;", {"entity_set": entity_set_path})
            if not records:
                # Fallback case-insensitive match
                all_entities = await db.query("SELECT * FROM sap_entities;")
                for r in all_entities:
                    if r.get("entity_set", "").lower() == entity_set_path.lower():
                        records = [r]
                        break

            if not records:
                raise Exception(f"Entity set '{entity_set_path}' is not registered in SurrealDB. Register it in Settings first.")

            record = records[0]
            service_name = record.get("module", "default")
            safe_service = service_name.lower().replace(" ", "_").replace("-", "_")
            safe_entity = entity_set_path.lower().replace(" ", "_").replace("-", "_")
            
            tool_name = f"fetch_{safe_service}_{safe_entity}"

            # Map OData query parameters to tool arguments
            for key, val_list in query_params.items():
                val = val_list[0] if val_list else ""
                if key == "$filter":
                    tool_args["filter"] = val
                elif key == "$select":
                    tool_args["select"] = val
                elif key == "$top":
                    try:
                        tool_args["top"] = int(val)
                    except:
                        pass
                elif key == "$skip":
                    try:
                        tool_args["skip"] = int(val)
                    except:
                        pass
                elif key == "$expand":
                    tool_args["expand"] = val

        # 3. Call the tool using our MCP stdio client
        mcp_response = await run_mcp_tool(tool_name, tool_args)
        
        results = []
        total_count = None
        
        if isinstance(mcp_response, dict) and ("results" in mcp_response or "total_count" in mcp_response):
            results = mcp_response.get("results", [])
            total_count = mcp_response.get("total_count")
        elif isinstance(mcp_response, list):
            results = mcp_response
            
        new_buffer = existing_buffer + results
        logger.info(
            "MCP OData execution returned %d records (total buffer: %d, total_count: %s).",
            len(results),
            len(new_buffer),
            str(total_count)
        )

        return {
            "data_buffer": new_buffer,
            "has_next_page": "", # NextLink handling is managed inside the tool or skipped
            "total_count": total_count,
            "error": "",
        }

    except Exception as e:
        logger.error("OData MCP execution failed: %s", e)
        error_msg = f"OData MCP execution error: {e}"
        updates = {
            "data_buffer": existing_buffer,
            "has_next_page": "",
            "error": error_msg,
        }
        if state.get("retry_count", 0) == 0:
            updates["first_failed_query"] = generated_query
            updates["first_error"] = error_msg
        return updates

