"use client";

import React, { useState, useEffect } from "react";
import {
  Settings,
  Cpu,
  Server,
  Network,
  Plus,
  Trash2,
  Save,
  Check,
  AlertCircle,
  Link2,
  Loader2,
  ArrowLeft,
  Eye,
  EyeOff,
  ChevronDown,
  Merge,
  ExternalLink,
} from "lucide-react";
import {
  fetchSettings,
  saveSettings,
  AppSettings,
  LLMConfig,
  ServiceConfig,
  JoinConfig,
  JoinedServiceConfig,
  MCPConfig,
  deleteODataMCPEntities,
} from "@/lib/api";
import { GraphExplorer } from "@/components/graph-explorer";

type SettingsTab = "models" | "services" | "graph";

const PROVIDERS: Record<string, string[]> = {
  groq: [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "openai/gpt-oss-120b",
    "qwen/qwen3-32b",
  ],
  openai: ["gpt-4o", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo", "gpt-4o-mini"],
  mistral: ["mistral-large-latest", "mistral-medium", "mistral-small-latest", "open-mixtral-8x22b", "open-mistral-7b"],
  google: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-1.5-pro", "gemini-1.5-flash", "gemini-1.0-pro"],
  anthropic: ["claude-3-5-sonnet-20240620", "claude-3-opus-20240229", "claude-3-sonnet-20240229", "claude-3-haiku-20240307", "claude-2.1"]
};

interface SettingsViewProps {
  onBack: () => void;
  onNavigateToDiscovery: (params: { service?: ServiceConfig; mcp?: MCPConfig }) => void;
  onNavigateToJoin: () => void;
}

export function SettingsView({ onBack, onNavigateToDiscovery, onNavigateToJoin }: SettingsViewProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("models");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");

  // LLM State
  const [llm, setLlm] = useState<LLMConfig>({
    provider: "",
    active_model: "",
    fallback_model: "",
    api_keys: {},
  });
  const [showApiKey, setShowApiKey] = useState(false);

  // Services State
  const [services, setServices] = useState<(ServiceConfig | JoinedServiceConfig)[]>([]);
  const [mcps, setMcps] = useState<MCPConfig[]>([]);
  const [joins, setJoins] = useState<JoinConfig[]>([]);

  // New service form
  const [newService, setNewService] = useState<ServiceConfig>({
    name: "",
    url: "",
    description: "",
  });

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    const data = await fetchSettings();
    setLlm(data.llm || { provider: "", active_model: "", fallback_model: "", api_keys: {} });
    setServices(data.services || []);
    setMcps(data.mcps || []);
    setJoins(data.joins || []);
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus("idle");
    const success = await saveSettings({ llm, services, mcps, joins });
    setSaving(false);
    setSaveStatus(success ? "success" : "error");
    setTimeout(() => setSaveStatus("idle"), 3000);
  };

  const addService = async () => {
    if (!newService.name || !newService.url) return;
    const updatedServices = [...services, { ...newService }];
    setServices(updatedServices);
    setNewService({ name: "", url: "", description: "" });
    await saveSettings({ llm, services: updatedServices, mcps, joins });
  };

  const removeService = async (index: number) => {
    const removedService = services[index];
    const updatedServices = services.filter((_, i) => i !== index);
    setServices(updatedServices);
    
    // Clean up any joins involving this service name
    const updatedJoins = joins.filter(
      (j) =>
        j.source_service !== removedService.name &&
        j.target_service !== removedService.name
    );
    setJoins(updatedJoins);

    // Clean up any MCPs created from this service URL
    let updatedMcps = mcps;
    if ("url" in removedService) {
      const serviceUrl = (removedService as ServiceConfig).url;
      const mcpsToDelete = mcps.filter((m) => m.url === serviceUrl);
      updatedMcps = mcps.filter((m) => m.url !== serviceUrl);
      setMcps(updatedMcps);
      
      // Delete their entities from the database as well
      for (const mcp of mcpsToDelete) {
        await deleteODataMCPEntities(mcp.name);
      }
    }
    
    await saveSettings({ llm, services: updatedServices, mcps: updatedMcps, joins: updatedJoins });
  };

  const removeMCP = async (mcpName: string) => {
    const updatedMcps = mcps.filter((m) => m.name !== mcpName);
    setMcps(updatedMcps);
    await deleteODataMCPEntities(mcpName);
    await saveSettings({ llm, services, mcps: updatedMcps, joins });
  };

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: "models", label: "LLM Models & API", icon: <Cpu size={15} /> },
    { id: "services", label: "Services", icon: <Server size={15} /> },
    { id: "graph", label: "Entity Graph", icon: <Network size={15} /> },
  ];

  if (loading) {
    return (
      <div className="settings-view">
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <Loader2 size={28} style={{ animation: "spin 1.2s linear infinite", color: "var(--text-accent)" }} />
            <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-secondary)" }}>Loading settings...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-view">
      {/* Top Bar */}
      <div className="settings-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={onBack}
            className="settings-back-btn"
            title="Back to Chat"
          >
            <ArrowLeft size={18} />
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Settings size={18} style={{ color: "var(--text-accent)" }} />
            <span
              className="font-display"
              style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary)" }}
            >
              Settings
            </span>
          </div>
        </div>

        {/* Save Button — only show on models/services tabs */}
        {activeTab !== "graph" && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="settings-save-btn"
          >
            {saving ? (
              <Loader2 size={15} style={{ animation: "spin 1.2s linear infinite" }} />
            ) : saveStatus === "success" ? (
              <Check size={15} />
            ) : saveStatus === "error" ? (
              <AlertCircle size={15} />
            ) : (
              <Save size={15} />
            )}
            <span>
              {saving ? "Saving..." : saveStatus === "success" ? "Saved!" : saveStatus === "error" ? "Error" : "Save Changes"}
            </span>
          </button>
        )}
      </div>

      {/* Tab Bar */}
      <div className="settings-tab-bar">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`settings-tab ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="settings-content">
        {activeTab === "models" && (
          <div className="settings-panel animate-fadeIn">
            <div className="settings-section">
              <h3 className="settings-section-title">
                <Cpu size={16} />
                <span>LLM Provider Configuration</span>
              </h3>
              <p className="settings-section-desc">
                Configure your AI model provider. Enter your API credentials and select a primary and fallback model.
              </p>

              <div className="settings-form-grid">
                {/* Active Model */}
                <div className="settings-field">
                  <label className="settings-label">Primary Model</label>
                  <select
                    className="settings-input"
                    value={llm.active_model}
                    onChange={(e) => setLlm({ ...llm, active_model: e.target.value })}
                  >
                    <option value="">Select a model...</option>
                    {Object.entries(PROVIDERS).map(([p, models]) => (
                      <optgroup key={p} label={p.charAt(0).toUpperCase() + p.slice(1)}>
                        {models.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                {/* Fallback Model */}
                <div className="settings-field">
                  <label className="settings-label">Fallback Model</label>
                  <select
                    className="settings-input"
                    value={llm.fallback_model}
                    onChange={(e) => setLlm({ ...llm, fallback_model: e.target.value })}
                  >
                    <option value="">Select a model...</option>
                    {Object.entries(PROVIDERS).map(([p, models]) => (
                      <optgroup key={p} label={p.charAt(0).toUpperCase() + p.slice(1)}>
                        {models.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                {/* API Keys */}
                <div className="settings-field" style={{ gridColumn: "1 / -1", marginTop: 12 }}>
                  <label className="settings-label" style={{ marginBottom: 4 }}>Provider API Keys</label>
                  <p className="settings-section-desc" style={{ marginBottom: 16, fontSize: 12 }}>
                    Configure API keys for each provider. Keys defined in your .env file are automatically populated.
                  </p>
                  
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {Object.keys(PROVIDERS).map(p => (
                      <div key={p} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ width: 100, fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>
                          {p.charAt(0).toUpperCase() + p.slice(1)}
                        </div>
                        <div style={{ position: "relative", flex: 1 }}>
                          <input
                            type={showApiKey ? "text" : "password"}
                            className="settings-input"
                            placeholder={`API Key`}
                            value={llm.api_keys?.[p] || ""}
                            onChange={(e) => setLlm({ 
                              ...llm, 
                              api_keys: { ...llm.api_keys, [p]: e.target.value }
                            })}
                            style={{ width: "100%", paddingRight: 42 }}
                          />
                          <button
                            onClick={() => setShowApiKey(!showApiKey)}
                            style={{
                              position: "absolute",
                              right: 8,
                              top: "50%",
                              transform: "translateY(-50%)",
                              background: "none",
                              border: "none",
                              color: "var(--text-tertiary)",
                              cursor: "pointer",
                              padding: 4,
                              display: "flex",
                            }}
                          >
                            {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "services" && (() => {
          const joinedServices = services
            .map((s, idx) => ({ ...s, originalIndex: idx }))
            .filter((svc) => "is_joined" in svc && svc.is_joined) as (JoinedServiceConfig & { originalIndex: number })[];
          
          const odataServices = services
            .map((s, idx) => ({ ...s, originalIndex: idx }))
            .filter((svc) => !("is_joined" in svc && svc.is_joined)) as (ServiceConfig & { originalIndex: number })[];

          const hasActiveMCPs = mcps.length > 0 || joinedServices.length > 0;

          return (
            <div className="settings-panel animate-fadeIn">
              {/* Active MCP Services */}
              <div className="settings-section">
                <h3 className="settings-section-title">
                  <Network size={16} style={{ color: "var(--text-accent)" }} />
                  <span>Active MCP Services</span>
                </h3>
                <p className="settings-section-desc">
                  These MCPs are active and registered in SurrealDB. Click "Edit MCP" to customize the selected entities or view details.
                </p>

                {hasActiveMCPs ? (
                  <div className="settings-service-list">
                    {/* Custom MCPs */}
                    {mcps.map((mcp) => (
                      <div key={`mcp-${mcp.name}`} className="settings-service-card">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                            <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
                              {mcp.name}
                            </div>
                            <span className="mcp-service-badge">
                              <Check size={9} />
                              MCP ACTIVE
                            </span>
                          </div>
                          <div style={{ fontSize: "12px", color: "var(--text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            Service: {mcp.service_name}
                            <span style={{ margin: "0 6px", opacity: 0.5 }}>•</span>
                            {mcp.url}
                          </div>
                          {mcp.description && (
                            <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: 4 }}>
                              {mcp.description}
                            </div>
                          )}
                          {mcp.prompt && (
                            <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: 4, display: "flex", gap: 4, alignItems: "flex-start" }}>
                              <span style={{ fontWeight: 600 }}>Prompt:</span>
                              <span style={{ opacity: 0.9, fontStyle: "italic" }}>{mcp.prompt}</span>
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => onNavigateToDiscovery({ mcp })}
                          className="settings-discover-btn"
                          title="Edit active MCP entities"
                          style={{ marginRight: 4 }}
                        >
                          <Network size={12} />
                          <span>Edit MCP</span>
                        </button>
                        <button
                          onClick={() => removeMCP(mcp.name)}
                          className="settings-delete-btn"
                          title="Remove MCP"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}

                    {/* Joined MCPs */}
                    {joinedServices.map((svc) => (
                      <div key={`joined-${svc.originalIndex}`} className="settings-service-card">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                            <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
                              {svc.name}
                            </div>
                            <span className="joined-service-badge">
                              <Merge size={9} />
                              JOINED
                            </span>
                          </div>
                          <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
                            {svc.source_service} ↔ {svc.target_service}
                            <span style={{ margin: "0 6px", opacity: 0.5 }}>•</span>
                            {svc.relation_type}
                            <span style={{ margin: "0 6px", opacity: 0.5 }}>•</span>
                            Key: {svc.join_key}
                          </div>
                          {svc.description && (
                            <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: 4 }}>
                              {svc.description}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => removeService(svc.originalIndex)}
                          className="settings-delete-btn"
                          title="Remove Joined MCP"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="settings-empty">
                    <Network size={24} style={{ opacity: 0.3 }} />
                    <span>No active MCP services. Use the available OData endpoints below to register schemas.</span>
                  </div>
                )}
              </div>

              {/* Available OData Services */}
              <div className="settings-section" style={{ marginTop: 32 }}>
                <h3 className="settings-section-title">
                  <Server size={16} />
                  <span>Available OData Services</span>
                </h3>
                <p className="settings-section-desc">
                  Connection endpoints waiting to be configured. Click "Create MCP" to choose entities and activate them.
                </p>

                {odataServices.length > 0 ? (
                  <div className="settings-service-list">
                    {odataServices.map((svc) => (
                      <div key={svc.originalIndex} className="settings-service-card">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                            <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
                              {svc.name}
                            </div>
                          </div>
                          <div style={{ fontSize: "12px", color: "var(--text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {svc.url}
                          </div>
                          {svc.description && (
                            <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: 4 }}>
                              {svc.description}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => onNavigateToDiscovery({ service: svc })}
                          className="settings-discover-btn"
                          title="Discover entities and create MCP"
                          style={{ marginRight: 4 }}
                        >
                          <Network size={12} />
                          <span>Create MCP</span>
                        </button>
                        <button
                          onClick={() => removeService(svc.originalIndex)}
                          className="settings-delete-btn"
                          title="Remove service endpoint"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="settings-empty">
                    <Server size={24} style={{ opacity: 0.3 }} />
                    <span>No endpoints configured. Add a new service endpoint below.</span>
                  </div>
                )}

                {/* Add Service Form */}
                <div className="settings-add-form" style={{ marginTop: 20 }}>
                  <div className="settings-add-form-title">
                    <Plus size={14} />
                    <span>Add New Service Endpoint</span>
                  </div>
                  <div className="settings-form-grid">
                    <div className="settings-field">
                      <label className="settings-label">Service Name</label>
                      <input
                        type="text"
                        className="settings-input"
                        placeholder="e.g., Northwind V4"
                        value={newService.name}
                        onChange={(e) => setNewService({ ...newService, name: e.target.value })}
                      />
                    </div>
                    <div className="settings-field">
                      <label className="settings-label">Service URL</label>
                      <input
                        type="text"
                        className="settings-input"
                        placeholder="e.g., https://services.odata.org/V4/Northwind/Northwind.svc"
                        value={newService.url}
                        onChange={(e) => setNewService({ ...newService, url: e.target.value })}
                      />
                    </div>
                    <div className="settings-field" style={{ gridColumn: "1 / -1" }}>
                      <label className="settings-label">Description (optional)</label>
                      <input
                        type="text"
                        className="settings-input"
                        placeholder="Brief description of this service"
                        value={newService.description}
                        onChange={(e) => setNewService({ ...newService, description: e.target.value })}
                      />
                    </div>
                  </div>
                  <button
                    onClick={addService}
                    disabled={!newService.name || !newService.url}
                    className="settings-add-btn"
                  >
                    <Plus size={15} />
                    <span>Add Service</span>
                  </button>
                </div>
              </div>

              {/* Join MCPs Section */}
              <div className="settings-section" style={{ marginTop: 32 }}>
                <h3 className="settings-section-title">
                  <Merge size={16} />
                  <span>Join Services</span>
                </h3>
                <p className="settings-section-desc">
                  Combine two existing services into a new, independent Joined MCP.
                  The agent will be able to query data across both services using the join relationship.
                </p>

                <button
                  onClick={onNavigateToJoin}
                  className="settings-add-btn"
                  style={{ width: "100%", justifyContent: "center" }}
                >
                  <Merge size={15} />
                  <span>Create Joined MCP</span>
                </button>
              </div>
            </div>
          );
        })()}

        {activeTab === "graph" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <GraphExplorer />
          </div>
        )}
      </div>
    </div>
  );
}
