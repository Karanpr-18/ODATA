# System Architecture & Developer Brief: Enterprise SAP OData Chatbot

## 1. Project Aim & Overview
Build a 100% free, secure, intranet-bound enterprise AI chatbot using `assistant-ui` that allows users to query complex internal SAP OData Services using natural language. The system bypasses expensive cloud dependencies and SAP BTP licensing by utilizing a local open-source stack, local vector embeddings, SurrealDB Graph RAG, and an ephemeral, auto-destroying calculation sandbox.

## 2. Finalized Tech Stack & Absolute Constraints
* **User Interface:** `assistant-ui` (React/Next.js) natively integrated with `@ai-sdk/mcp`.
* **Backend Gateway & REST API:** **FastAPI** (Python) serving as the robust HTTP interface layer for frontend requests and state entry points.
* **Orchestration Core:** Python natively running **LangGraph** within the FastAPI application framework to handle complex routing state and recursive loops.
* **The Brain (LLM):** **Groq API** (Running Llama 3 for structured output and code generation).
* **Local Embedding Engine:** **Ollama** running **`nomic-embed-text`** locally (optimized for CPU-only execution, 137M parameters, ~280MB RAM footprint).
* **Database, Context & Memory Layer:** **SurrealDB** running as a native **MCP Server** (Multi-Model Graph + Vector Database).
* **Code Execution Engine:** Local, open-source **Docker-based Code Sandbox MCP Server** (`pottekkat/sandbox-mcp` or `code-sandbox-mcp`).
* **Identity & Auth:** OIDC/JWT SSO mapped directly via **Principal Propagation** to SAP User Master (SU01).

## 3. Context Window & Token Optimization Math
* **Minimum Threshold:** 8K tokens. **Recommended Architecture Target:** 32K tokens.
* **Input Load Metrics:** User prompt (~50 tokens) + SurrealDB `agent_memory` past corrections (~1,000 tokens) + Target SAP `$metadata` relational schemas (~4,000 tokens) = ~5,050 input tokens.
* **Output Load Metrics:** Groq-generated OData JSON query string or functional Python script = ~500 to 1,500 tokens.
* **Token Optimization via Embeddings:** Local embeddings act as a deterministic gatekeeper router. Instead of dumping the entire SAP metadata footprint into the LLM context (10,000+ tokens), the local embedding matches intent to *only* the single required schema node, reducing input payload sizes by 90% to 95%.

## 4. The Two-Part Tag Team: Hybrid RAG (Embeddings + Graph)
To prevent hallucinations and exact-string matching failures, the retrieval layer is split into two distinct responsibilities:
1.  **The Starting Door (Local Embeddings via Nomic):** Converts raw user language ("unpaid bills for Delhi") into a dense vector via the local Ollama service. A similarity search in SurrealDB bridges the gap to the exact technical node (`FI_Invoices`), handling human typos, synonyms, and intent without needing exact SAP keyword matches.
2.  **The House (Graph Traversal via SurrealDB):** Once the target node is found, SurrealDB's Graph engine traces the relational edges (`Invoices` -> `belongs_to` -> `Customers` -> `located_in` -> `Regions`). It extracts this multi-hop structural context and provides it to Groq via MCP so the LLM can generate perfect `$expand` and `$filter` statements.

## 5. Security, Memory & Sandbox Lifecycle Policies

### Record-Level Security (RLS)
Every MCP request passing from LangGraph to SurrealDB evaluates the user's active OIDC/JWT. If the token lacks clearance for financial records, the Graph nodes for `FI` are physically blinded at the database layer and are never exposed to the LLM context window.

### Long-Term Memory & Error Avoidance
To prevent the agent from repeating the same configuration or translation mistakes, user-submitted corrections (e.g., "Always exclude canceled orders from quarterly metrics") are converted to vectors via Nomic and appended to an `agent_memory` table in SurrealDB. Every incoming query runs a parallel vector similarity scan against this table to inject historical context constraints into the active session.

### Ephemeral Code Sandbox Lifecycle
When a user query requires complex calculations (e.g., quarterly profit aggregations):
1. Groq generates an isolated Python data processing script using standard libraries (e.g., `pandas`).
2. LangGraph pushes this script and the raw SAP data payload to the local **Code Sandbox MCP Server**.
3. The server instantly spawns an air-gapped, stateless Docker container instance (`python:3.10-alpine`) over standard I/O (`stdio`).
4. The script executes within the isolated environment, streams its calculation results back to the LangGraph thread state, and **instantly fires a forceful destruction sequence (`docker rm -f`)**. 
5. No memory state, file cache, or persistent tracking remains, preventing memory bloating and arbitrary execution vulnerabilities.

## 6. End-to-End Component Workflow Lifecycle

```
[Assistant UI] ---> (FastAPI Endpoint) ---> (Nomic Local Embedding Router) ---> [SurrealDB Graph RAG + RLS]
      ^                                                                                    |
      |                                                                                    v
[Final Pushed Output] <------------- [Local Sandbox MCP (Auto-Destroy)] <------- [Groq Brain + LangGraph Loop]
```

1.  **Ingress:** User query enters `assistant-ui`. Session context extracts the OIDC JWT token and transmits it to a dedicated **FastAPI POST endpoint** (`/api/chat`).
2.  **Routing:** FastAPI instantiates the LangGraph runtime. The application calls the local `nomic-embed-text` instance via Ollama to generate the prompt vector and queries SurrealDB for intent matching and past correction history.
3.  **Discovery:** SurrealDB checks user RLS permissions, maps graph paths for the matching entity, and returns authorized tool definitions via `@ai-sdk/mcp`.
4.  **Generation:** Groq interprets schemas and memory to output the exact OData payload parameters.
5.  **Execution & Pagination Loop:** LangGraph calls the SAP OData Gateway via Principal Propagation. If an `@odata.nextLink` token is detected, LangGraph enters a recursive backend node loop to fetch and accumulate all matching pages into a unified memory buffer without bothering the LLM.
6.  **Calculation Sandbox:** If calculations are needed, the data buffer and script are sent to the local Sandbox MCP. The container runs, passes the computed answers to the state, and immediately terminates.
7.  **Egress:** LangGraph finishes its execution thread inside the FastAPI scope. FastAPI packages the comprehensive data payload and returns a structured JSON payload or server-sent event stream back to `assistant-ui` for rendering.

## 7. Implementation Directives for Code Generation ("Antigravity")
1.  **FastAPI Routing & Dependency Injection:** Define a clear route mapping handler (`POST /api/chat`) that utilizes FastAPI's `Depends` authentication utilities to validate incoming OIDC header signatures before executing the underlying LangGraph pipeline.
2.  **Dual MCP Manifests:** Initialize two distinct `stdio` clients within the LangGraph application: one target for the SurrealDB schema engine, and one isolated endpoint for the Docker-managed Code Sandbox execution environment.
3.  **Ollama Python Interface:** Embed native calls to the local Ollama daemon container (`http://localhost:11434/api/embeddings`) specifying `nomic-embed-text` to handle incoming query vector conversions before routing to the main state loop.
4.  **State Schema Array Accumulation:** The core LangGraph state dictionary MUST track `data_buffer: List[Dict]` and a conditional string edge routing state `has_next_page` inspecting the value of `@odata.nextLink`.
5.  **Sandbox Automation Hook:** Write strict Python `try...finally` block wrappers around the Sandbox tool execution to guarantee container teardown scripts fire regardless of script outcome success or script failure crash logs.
