"""
Execute Node — Calls the SAP OData Gateway and handles pagination.

Currently uses mock data since we don't have a live SAP system.
When ready, swap the mock with real HTTP calls to the SAP Gateway.
"""

import json
import logging
from typing import Any

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


async def execute_odata(state: AgentState) -> dict[str, Any]:
    """Execute the generated OData query against SAP Gateway or real OData Service."""
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

    logger.info("Executing OData query: %s", generated_query[:200])

    try:
        is_mock = "example.com" in settings.sap_odata_base_url or not settings.sap_odata_base_url

        if is_mock:
            logger.info("Running OData query in MOCK mode")
            mock_results = _match_mock_data(generated_query)
            new_buffer = existing_buffer + mock_results
            return {
                "data_buffer": new_buffer,
                "has_next_page": "",
                "error": "",
            }

        # ── REAL IMPLEMENTATION ──
        import httpx
        base_url = settings.sap_odata_base_url
        
        # Resolve any relative queries, full URLs, or parent traversal path segments (../../../) in nextLinks
        from urllib.parse import urljoin
        base_url_slash = base_url if base_url.endswith("/") else f"{base_url}/"
        
        # If it is not a full absolute URL, strip leading slash to prevent urljoin from stripping base URL path
        query_str = generated_query
        if not query_str.startswith("http://") and not query_str.startswith("https://"):
            query_str = query_str.lstrip("/")
            
        full_url = urljoin(base_url_slash, query_str)

        logger.info("Calling real OData service: %s", full_url)

        headers = {
            "Accept": "application/json",
        }
        if settings.sap_client:
            headers["sap-client"] = settings.sap_client

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(full_url, headers=headers)
            
            # Inline self-healing repair for 404 where the base URL path gets lost
            if response.status_code == 404:
                import urllib.parse
                parsed_base = urllib.parse.urlparse(base_url)
                parsed_full = urllib.parse.urlparse(full_url)
                if parsed_base.path and parsed_base.path.strip("/") not in parsed_full.path:
                    repaired_path = parsed_base.path.rstrip("/") + "/" + parsed_full.path.lstrip("/")
                    repaired_url = urllib.parse.urlunparse(parsed_full._replace(path=repaired_path))
                    logger.warning("OData request returned 404. Attempting path repair. Original: %s, Repaired: %s", full_url, repaired_url)
                    response = await client.get(repaired_url, headers=headers)
                    full_url = repaired_url
                    
            response.raise_for_status()
            data = response.json()

            results = []
            next_link = ""

            if isinstance(data, list):
                results = data
            elif isinstance(data, dict):
                # OData v4 structure: { "value": [...], "@odata.nextLink": "..." }
                if "value" in data:
                    results = data["value"]
                    next_link = data.get("@odata.nextLink", "")
                # OData v2 structure: { "d": { "results": [...], "__next": "..." } }
                elif "d" in data:
                    d_data = data["d"]
                    if isinstance(d_data, dict):
                        if "results" in d_data:
                            results = d_data["results"]
                            next_link = d_data.get("__next", "")
                        else:
                            # Direct object
                            results = [d_data]
                    elif isinstance(d_data, list):
                        results = d_data
                    else:
                        results = [d_data]
                else:
                    results = [data]

            new_buffer = existing_buffer + results
            logger.info(
                "Real OData execution returned %d records (total buffer: %d). Next link: %s",
                len(results),
                len(new_buffer),
                next_link,
            )

            return {
                "data_buffer": new_buffer,
                "has_next_page": next_link,
                "generated_query": next_link if next_link else generated_query,
                "error": "",
            }

    except Exception as e:
        logger.error("OData execution failed: %s", e)
        error_msg = f"OData execution error: {e}"
        updates = {
            "data_buffer": existing_buffer,
            "has_next_page": "",
            "error": error_msg,
        }
        if state.get("retry_count", 0) == 0:
            updates["first_failed_query"] = generated_query
            updates["first_error"] = error_msg
        return updates
