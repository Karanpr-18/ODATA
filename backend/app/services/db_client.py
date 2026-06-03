"""
SurrealDB async client wrapper for the application.
"""

import json
import logging
from typing import Any

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)


class SurrealClient:
    """Lightweight async SurrealDB client using the HTTP REST API.

    We use the HTTP API instead of the WebSocket SDK to avoid
    dependency version conflicts and keep things simple for the prototype.
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

    async def _ensure_client(self) -> httpx.AsyncClient:
        if not self._client:
            await self.connect()
        return self._client  # type: ignore

    async def query(self, surql: str, vars: dict[str, Any] | None = None) -> list[dict]:
        """Execute a SurrealQL query and return results.

        Note: For the REST /sql endpoint, we inline variables into the query
        string since the REST API has limited parameterized query support.
        """
        client = await self._ensure_client()

        # Prepend explicit USE statements to guarantee namespace/database selection in SurrealDB v3+
        scoped_query = f"USE NS {self.ns}; USE DB {self.db}; {surql}"

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

        try:
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
                for statement in actual_statements:
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
        # Use robust /sql endpoint for absolute version compatibility
        results = await self.query(f"CREATE {table} CONTENT {json.dumps(data)};")
        if results:
            return results[0]
        return {}

    async def select(self, table: str, record_id: str | None = None) -> list[dict] | dict:
        """Select records from a table, or a specific record by ID."""
        target = f"{table}:{record_id}" if (record_id and ":" not in record_id) else (record_id or table)
        results = await self.query(f"SELECT * FROM {target};")
        if record_id:
            return results[0] if results else {}
        return results

    async def delete(self, table: str, record_id: str) -> None:
        """Delete a record by ID."""
        target = record_id if ":" in record_id else f"{table}:{record_id}"
        await self.query(f"DELETE {target};")

    async def update(self, table: str, record_id: str, data: dict[str, Any]) -> dict:
        """Merge-update a record."""
        target = record_id if ":" in record_id else f"{table}:{record_id}"
        results = await self.query(f"UPDATE {target} MERGE {json.dumps(data)};")
        if results:
            return results[0]
        return {}


# ── Singleton ──
_db_client: SurrealClient | None = None


def get_db() -> SurrealClient:
    """Get the singleton database client."""
    global _db_client
    if _db_client is None:
        _db_client = SurrealClient()
    return _db_client
