"""
Threads Route — CRUD endpoints for sidebar chat history.

GET    /api/threads              → List all threads
POST   /api/threads              → Create a new thread
GET    /api/threads/{id}/messages → Get messages for a thread
DELETE /api/threads/{id}         → Delete a thread
PATCH  /api/threads/{id}         → Rename a thread
"""

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.db_client import get_db

logger = logging.getLogger(__name__)

router = APIRouter()


class CreateThreadRequest(BaseModel):
    title: str = "New Chat"
    model: str = "llama-3.3-70b-versatile"


class UpdateThreadRequest(BaseModel):
    title: str


@router.get("/api/threads")
async def list_threads():
    """List all chat threads, sorted by most recently updated."""
    db = get_db()
    try:
        threads = await db.query(
            "SELECT * FROM thread ORDER BY updated_at DESC;"
        )
        return {"threads": threads}
    except Exception as e:
        logger.error("Failed to list threads: %s", e)
        return {"threads": []}


@router.post("/api/threads")
async def create_thread(body: CreateThreadRequest):
    """Create a new chat thread."""
    db = get_db()
    try:
        escaped_title = body.title.replace("'", "\\'")
        results = await db.query(f"""
            CREATE thread SET
                title = '{escaped_title}',
                model = '{body.model}',
                created_at = time::now(),
                updated_at = time::now();
        """)

        if results:
            return {"thread": results[0]}
        raise HTTPException(status_code=500, detail="Failed to create thread")

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to create thread: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/threads/{thread_id}/messages")
async def get_thread_messages(thread_id: str):
    """Get all messages for a specific thread."""
    db = get_db()
    try:
        # thread_id comes as "thread:xxxx"
        record_id = thread_id if ":" in thread_id else f"thread:{thread_id}"
        messages = await db.query(f"""
            SELECT * FROM message
            WHERE thread = {record_id}
            ORDER BY created_at ASC;
        """)
        return {"messages": messages}
    except Exception as e:
        logger.error("Failed to get messages for thread %s: %s", thread_id, e)
        return {"messages": []}


@router.delete("/api/threads/{thread_id}")
async def delete_thread(thread_id: str):
    """Delete a thread and all its messages."""
    db = get_db()
    try:
        record_id = thread_id if ":" in thread_id else f"thread:{thread_id}"

        # Delete all messages first
        await db.query(f"DELETE message WHERE thread = {record_id};")
        # Delete the thread
        await db.query(f"DELETE {record_id};")

        return {"success": True}
    except Exception as e:
        logger.error("Failed to delete thread %s: %s", thread_id, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/api/threads/{thread_id}")
async def update_thread(thread_id: str, body: UpdateThreadRequest):
    """Rename a thread."""
    db = get_db()
    try:
        record_id = thread_id if ":" in thread_id else f"thread:{thread_id}"
        escaped_title = body.title.replace("'", "\\'")
        results = await db.query(f"""
            UPDATE {record_id} SET
                title = '{escaped_title}',
                updated_at = time::now();
        """)

        if results:
            return {"thread": results[0]}
        raise HTTPException(status_code=404, detail="Thread not found")

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to update thread %s: %s", thread_id, e)
        raise HTTPException(status_code=500, detail=str(e))
