"""
SurrealDB async client wrapper for the application.
"""

import json
import logging
from contextlib import asynccontextmanager
from typing import Any

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)


class SurrealClient:
    """Lightweight async SurrealDB client using the HTTP REST API.

    We use the HTTP API instead of the WebSocket SDK to avoid
    dependency version conflicts and keep things simple.
    """

    def __init__(self) -> None:
        settings = get_settings()
        # Convert ws:// to http:// for REST API
        base = settings.surreal_url.replace("ws://", "http://").replace("/rpc", "")
        self.base_url = base
        self.ns = settings.surreal_ns
        self.db = settings.surreal_db
        self.auth = (settings.surreal_user, settings.surreal_pass)
        self._client: httpx.AsyncClient | None = None

    async def connect(self) -> None:
        """Initialize the HTTP client."""
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            auth=self.auth,
            headers={
                "Accept": "application/json",
                "NS": self.ns,
                "DB": self.db,
            },
            timeout=30.0,
        )
        logger.info("SurrealDB client connected to %s", self.base_url)

    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None
            logger.info("SurrealDB client closed")

    async def query(self, surql: str, vars: dict[str, Any] | None = None) -> list[dict]:
        """Execute a SurrealQL query and return results."""
        if not self._client:
            await self.connect()

        payload: dict[str, Any] = {}
        if vars:
            # For the SQL endpoint, we pass variables as JSON in the body
            # The endpoint expects raw SurrealQL
            pass

        headers = {"Content-Type": "application/json"}
        # Use the /sql endpoint
        try:
            if vars:
                # Use /sql with variables encoded in the query
                # SurrealDB REST API: POST /sql with raw SurrealQL body
                for key, value in vars.items():
                    if isinstance(value, list):
                        surql = surql.replace(f"${key}", json.dumps(value))
                    elif isinstance(value, str):
                        surql = surql.replace(f"${key}", f"'{value}'")
                    else:
                        surql = surql.replace(f"${key}", str(value))

            response = await self._client.post(
                "/sql",
                content=surql,
                headers={"Content-Type": "text/plain", "Accept": "application/json"},
            )
            response.raise_for_status()
            data = response.json()

            # SurrealDB returns an array of statement results
            results = []
            if isinstance(data, list):
                for statement in data:
                    if statement.get("status") == "OK":
                        result = statement.get("result")
                        if isinstance(result, list):
                            results.extend(result)
                        elif result is not None:
                            results.append(result)
                    else:
                        logger.warning("SurrealDB query error: %s", statement)
            return results

        except httpx.HTTPStatusError as e:
            logger.error("SurrealDB HTTP error: %s — %s", e.response.status_code, e.response.text)
            raise
        except Exception as e:
            logger.error("SurrealDB query failed: %s", e)
            raise

    async def create(self, table: str, data: dict[str, Any]) -> dict:
        """Create a record in the specified table."""
        if not self._client:
            await self.connect()

        response = await self._client.post(
            f"/key/{table}",
            json=data,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        response.raise_for_status()
        result = response.json()
        if isinstance(result, list) and len(result) > 0:
            return result[0]
        return result

    async def select(self, table: str, record_id: str | None = None) -> list[dict] | dict:
        """Select records from a table, or a specific record by ID."""
        if not self._client:
            await self.connect()

        path = f"/key/{table}" if not record_id else f"/key/{table}/{record_id}"
        response = await self._client.get(
            path,
            headers={"Accept": "application/json"},
        )
        response.raise_for_status()
        result = response.json()
        if isinstance(result, list) and len(result) > 0:
            inner = result[0]
            if isinstance(inner, dict) and "result" in inner:
                return inner["result"]
        return result

    async def delete(self, table: str, record_id: str) -> None:
        """Delete a record by ID."""
        if not self._client:
            await self.connect()

        response = await self._client.delete(
            f"/key/{table}/{record_id}",
            headers={"Accept": "application/json"},
        )
        response.raise_for_status()

    async def update(self, table: str, record_id: str, data: dict[str, Any]) -> dict:
        """Merge-update a record."""
        if not self._client:
            await self.connect()

        response = await self._client.patch(
            f"/key/{table}/{record_id}",
            json=data,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        response.raise_for_status()
        result = response.json()
        if isinstance(result, list) and len(result) > 0:
            return result[0]
        return result


# ── Singleton ──
_db_client: SurrealClient | None = None


def get_db() -> SurrealClient:
    """Get the singleton database client."""
    global _db_client
    if _db_client is None:
        _db_client = SurrealClient()
    return _db_client
