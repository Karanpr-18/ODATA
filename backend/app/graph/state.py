"""
LangGraph Agent State — defines the typed state dictionary that flows through all nodes.
"""

from typing import Annotated, Any, TypedDict

from langgraph.graph.message import add_messages


class AgentState(TypedDict):
    """Core state flowing through the LangGraph pipeline.

    Each node reads from and writes to this shared state dict.
    The `messages` field uses LangGraph's `add_messages` reducer
    to automatically append new messages to the list.
    """

    # ── Chat Context ──
    messages: Annotated[list, add_messages]  # Full conversation history
    thread_id: str                            # Active thread ID for persistence
    model_name: str                           # User-selected Groq model name

    # ── Embedding & Retrieval ──
    query_vector: list[float]                 # 768-dim vector from nomic-embed-text
    matched_entity: dict[str, Any]            # Best-match SAP entity from vector search
    graph_context: str                        # Multi-hop graph traversal result
    memory_context: str                       # Past corrections from agent_memory
    schema_context: str                       # Target entity $metadata schema

    # ── LLM Generation ──
    generated_query: str                      # Groq-generated OData URL or Python script
    calculation_script: str                   # Groq-generated Python script for calculations
    needs_calculation: bool                   # Whether sandbox execution is needed
    query_type: str                           # "odata" | "calculation" | "direct_answer"

    # ── Execution ──
    data_buffer: list[dict[str, Any]]         # Accumulated OData response data
    has_next_page: str                        # @odata.nextLink URL or empty string
    total_count: int                          # Total number of records available server-side

    # ── Sandbox ──
    calculation_result: str                   # Sandbox execution output

    # ── Supervisor/Instructor Layer (Option 2) ──
    candidate_entities: list[dict[str, Any]]   # Top 3 matched candidate entities
    instruction_plan: dict[str, Any]          # Resolved step-by-step query/calculation plan

    # ── Response ──
    final_response: str                       # Formatted response for the user
    error: str                                # Error message if something fails
    retry_count: int                          # Number of automatic correction retries
    first_failed_query: str                   # The query/script from the first failed attempt
    first_error: str                          # The error message from the first failed attempt
    token_usage: dict[str, int]                # Tracks input, output, and total tokens from LLM nodes
