-- ──────────────────────────────────────────────
-- Enterprise SAP OData Chatbot — SurrealDB Schema
-- ──────────────────────────────────────────────
-- Run: surreal import --conn http://localhost:8001 --user root --pass root --ns sap --db odata db/schema.surql

-- ═══════════════════════════════════════════════
-- NAMESPACE & DATABASE
-- ═══════════════════════════════════════════════
DEFINE NAMESPACE IF NOT EXISTS sap;
USE NS sap;
DEFINE DATABASE IF NOT EXISTS odata;
USE DB odata;

-- ═══════════════════════════════════════════════
-- SAP ENTITY DEFINITIONS (Vector + Graph Nodes)
-- ═══════════════════════════════════════════════
DEFINE TABLE IF NOT EXISTS sap_entities SCHEMAFULL;
DEFINE FIELD name          ON TABLE sap_entities TYPE string;
DEFINE FIELD description   ON TABLE sap_entities TYPE string;
DEFINE FIELD entity_set    ON TABLE sap_entities TYPE string;
DEFINE FIELD module        ON TABLE sap_entities TYPE string;
DEFINE FIELD metadata_schema ON TABLE sap_entities TYPE option<string>;
DEFINE FIELD odata_url     ON TABLE sap_entities TYPE option<string>;
DEFINE FIELD key_fields    ON TABLE sap_entities TYPE option<array<string>>;
DEFINE FIELD nav_properties ON TABLE sap_entities TYPE option<array<string>>;
DEFINE FIELD filter_fields ON TABLE sap_entities TYPE option<array<string>>;
DEFINE FIELD embedding     ON TABLE sap_entities TYPE option<array<float>>;
DEFINE FIELD service_url   ON TABLE sap_entities TYPE option<string>;

-- Vector index for intent matching (nomic-embed-text = 768 dimensions)
DEFINE INDEX IF NOT EXISTS idx_entity_embedding
    ON TABLE sap_entities
    FIELDS embedding
    HNSW DIMENSION 768
    DIST COSINE;

-- Standard lookup indexes
DEFINE INDEX IF NOT EXISTS idx_entity_module
    ON TABLE sap_entities
    FIELDS module;

DEFINE INDEX IF NOT EXISTS idx_entity_set
    ON TABLE sap_entities
    FIELDS entity_set;

DEFINE INDEX IF NOT EXISTS idx_entity_service_url
    ON TABLE sap_entities
    FIELDS service_url;

-- ═══════════════════════════════════════════════
-- AGENT MEMORY (Corrections & Preferences)
-- ═══════════════════════════════════════════════
DEFINE TABLE IF NOT EXISTS agent_memory SCHEMAFULL;
DEFINE FIELD user_id    ON TABLE agent_memory TYPE string DEFAULT 'default';
DEFINE FIELD correction ON TABLE agent_memory TYPE string;
DEFINE FIELD context    ON TABLE agent_memory TYPE option<string>;
DEFINE FIELD embedding  ON TABLE agent_memory TYPE option<array<float>>;
DEFINE FIELD created_at ON TABLE agent_memory TYPE datetime DEFAULT time::now();

DEFINE INDEX IF NOT EXISTS idx_memory_embedding
    ON TABLE agent_memory
    FIELDS embedding
    HNSW DIMENSION 768
    DIST COSINE;

DEFINE INDEX IF NOT EXISTS idx_memory_user
    ON TABLE agent_memory
    FIELDS user_id;

-- ═══════════════════════════════════════════════
-- GRAPH EDGE TABLES (Relations Between SAP Entities)
-- ═══════════════════════════════════════════════

-- Entity belongs to another (Invoice -> Customer)
DEFINE TABLE IF NOT EXISTS belongs_to TYPE RELATION IN sap_entities OUT sap_entities;
DEFINE FIELD description ON TABLE belongs_to TYPE option<string>;

-- Entity depends on another (SalesOrderItem -> SalesOrder)
DEFINE TABLE IF NOT EXISTS depends_on TYPE RELATION IN sap_entities OUT sap_entities;
DEFINE FIELD description ON TABLE depends_on TYPE option<string>;

-- OData $expand navigation properties (SalesOrder -> SalesOrderItems)
DEFINE TABLE IF NOT EXISTS expands_to TYPE RELATION IN sap_entities OUT sap_entities;
DEFINE FIELD nav_property ON TABLE expands_to TYPE string;
DEFINE FIELD description  ON TABLE expands_to TYPE option<string>;

-- Filter field associations (Entity -> common filter dimensions)
DEFINE TABLE IF NOT EXISTS filters_by TYPE RELATION IN sap_entities OUT sap_entities;
DEFINE FIELD filter_field ON TABLE filters_by TYPE string;
DEFINE FIELD description  ON TABLE filters_by TYPE option<string>;

-- ═══════════════════════════════════════════════
-- CHAT THREADS & MESSAGES (Sidebar History)
-- ═══════════════════════════════════════════════
DEFINE TABLE IF NOT EXISTS thread SCHEMAFULL;
DEFINE FIELD title      ON TABLE thread TYPE string DEFAULT 'New Chat';
DEFINE FIELD model      ON TABLE thread TYPE string DEFAULT 'llama-3.3-70b-versatile';
DEFINE FIELD created_at ON TABLE thread TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at ON TABLE thread TYPE datetime DEFAULT time::now();

DEFINE TABLE IF NOT EXISTS message SCHEMAFULL;
DEFINE FIELD thread     ON TABLE message TYPE record<thread>;
DEFINE FIELD role       ON TABLE message TYPE string;
DEFINE FIELD content    ON TABLE message TYPE string;
DEFINE FIELD tool_calls ON TABLE message TYPE option<string>;
DEFINE FIELD created_at ON TABLE message TYPE datetime DEFAULT time::now();

DEFINE INDEX IF NOT EXISTS idx_message_thread
    ON TABLE message
    FIELDS thread;
