"""
Graph Builder — Compiles the full LangGraph StateGraph with all nodes
and conditional edges for the SAP OData chatbot pipeline.

Flow:
  embed_query → retrieve_context → generate_response
    → (direct_answer) → format_response → END
    → (odata) → execute_odata → [pagination loop] → check_needs_calc
        → (yes) → run_sandbox → format_response → END
        → (no) → format_response → END
    → (calculation) → execute_odata → run_sandbox → format_response → END
"""

import logging
from typing import Literal

from langgraph.graph import StateGraph, END

from app.graph.state import AgentState
from app.graph.nodes.embed import embed_query
from app.graph.nodes.retrieve import retrieve_context
from app.graph.nodes.instruct import instruct_query
from app.graph.nodes.generate import generate_response
from app.graph.nodes.execute import execute_odata
from app.graph.nodes.sandbox import run_sandbox
from app.graph.nodes.respond import format_response

logger = logging.getLogger(__name__)


# ── Conditional Edge Functions ──


def route_after_generate(state: AgentState) -> Literal["execute_odata", "run_sandbox", "format_response"]:
    """Route based on the LLM's output type.

    - direct_answer → format_response (no execution needed)
    - odata → execute_odata (fetch data from SAP)
    - calculation → execute_odata (fetch data first, then sandbox)
    """
    query_type = state.get("query_type", "direct_answer")

    if query_type == "direct_answer":
        return "format_response"
    elif query_type == "odata":
        return "execute_odata"
    elif query_type == "calculation":
        return "execute_odata"
    else:
        return "format_response"


def route_after_execute(state: AgentState) -> Literal["execute_odata", "run_sandbox", "format_response", "generate_response"]:
    """Route after OData execution.

    - If error exists and retry_count < 2 → generate_response (self-healing loop)
    - If @odata.nextLink exists → loop back to execute_odata
    - If calculation is needed → run_sandbox
    - Otherwise → format_response
    """
    error = state.get("error", "")
    retry_count = state.get("retry_count", 0)
    has_next = state.get("has_next_page", "")
    needs_calc = state.get("needs_calculation", False)

    if error and retry_count < 2:
        return "generate_response"
    elif has_next:
        return "execute_odata"
    elif needs_calc:
        return "run_sandbox"
    else:
        return "format_response"


def route_after_sandbox(state: AgentState) -> Literal["generate_response", "format_response"]:
    """Route after sandbox execution.

    - If error exists and retry_count < 2 → generate_response (self-healing loop)
    - Otherwise → format_response
    """
    error = state.get("error", "")
    retry_count = state.get("retry_count", 0)

    if error and retry_count < 2:
        return "generate_response"
    return "format_response"


# ── Graph Construction ──


def build_graph() -> StateGraph:
    """Build and compile the LangGraph agent pipeline."""
    logger.info("Building LangGraph agent pipeline")

    graph = StateGraph(AgentState)

    # Register all nodes
    graph.add_node("embed_query", embed_query)
    graph.add_node("retrieve_context", retrieve_context)
    graph.add_node("instruct_query", instruct_query)
    graph.add_node("generate_response", generate_response)
    graph.add_node("execute_odata", execute_odata)
    graph.add_node("run_sandbox", run_sandbox)
    graph.add_node("format_response", format_response)

    # Set entry point
    graph.set_entry_point("embed_query")

    # Linear edges
    graph.add_edge("embed_query", "retrieve_context")
    graph.add_edge("retrieve_context", "instruct_query")
    graph.add_edge("instruct_query", "generate_response")

    # Conditional edge after LLM generation
    graph.add_conditional_edges(
        "generate_response",
        route_after_generate,
        {
            "execute_odata": "execute_odata",
            "run_sandbox": "run_sandbox",
            "format_response": "format_response",
        },
    )

    # Conditional edge after OData execution (pagination loop + sandbox check + self-healing retry)
    graph.add_conditional_edges(
        "execute_odata",
        route_after_execute,
        {
            "execute_odata": "execute_odata",
            "run_sandbox": "run_sandbox",
            "format_response": "format_response",
            "generate_response": "generate_response",
        },
    )

    # Conditional edge after sandbox execution (self-healing retry)
    graph.add_conditional_edges(
        "run_sandbox",
        route_after_sandbox,
        {
            "generate_response": "generate_response",
            "format_response": "format_response",
        },
    )

    # format_response is the terminal node
    graph.add_edge("format_response", END)

    compiled = graph.compile()
    logger.info("LangGraph pipeline compiled successfully")

    return compiled


# ── Singleton compiled graph ──
_compiled_graph = None


def get_graph():
    """Get the singleton compiled graph instance."""
    global _compiled_graph
    if _compiled_graph is None:
        _compiled_graph = build_graph()
    return _compiled_graph
