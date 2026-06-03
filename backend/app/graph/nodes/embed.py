"""
Embed Node — Converts the user's latest message into a 768-dim vector
using the local Ollama nomic-embed-text model.
"""

import logging
from typing import Any

import httpx

from app.config import get_settings
from app.graph.state import AgentState

logger = logging.getLogger(__name__)


async def embed_query(state: AgentState) -> dict[str, Any]:
    """Generate embedding vector for the user's latest message.

    Calls the local Ollama instance at /api/embeddings with
    the nomic-embed-text model. Returns a 768-dimensional vector.
    """
    settings = get_settings()

    # Extract the latest user message
    messages = state.get("messages", [])
    if not messages:
        return {"query_vector": [], "error": "No messages to embed"}

    last_message = messages[-1]
    # Handle both dict and LangChain message objects
    if hasattr(last_message, "content"):
        user_text = last_message.content
    elif isinstance(last_message, dict):
        user_text = last_message.get("content", "")
    else:
        user_text = str(last_message)

    if not user_text:
        return {"query_vector": [], "error": "Empty message"}

    logger.info("Embedding query: %s", user_text[:100])

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{settings.ollama_base_url}/api/embeddings",
                json={
                    "model": settings.ollama_model,
                    "prompt": user_text,
                },
            )
            response.raise_for_status()
            data = response.json()

            embedding = data.get("embedding", [])
            logger.info(
                "Generated embedding with %d dimensions", len(embedding)
            )

            return {"query_vector": embedding, "error": ""}

    except httpx.ConnectError:
        logger.warning(
            "Ollama not available at %s — proceeding without embeddings",
            settings.ollama_base_url,
        )
        return {
            "query_vector": [],
            "error": "Ollama unavailable — embeddings skipped",
        }
    except Exception as e:
        logger.error("Embedding generation failed: %s", e)
        return {"query_vector": [], "error": f"Embedding error: {e}"}
