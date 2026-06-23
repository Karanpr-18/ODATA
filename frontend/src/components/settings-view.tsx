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
  Power,
  PowerOff,
  RotateCw,
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
  refreshService,
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
  onNavigateToServiceSettings: (service: ServiceConfig) => void;
}

export function SettingsView({ onBack, onNavigateToDiscovery, onNavigateToJoin, onNavigateToServiceSettings }: SettingsViewProps) {
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
  const [refreshingServices, setRefreshingServices] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // New service form & CPI config
  const [newService, setNewService] = useState<ServiceConfig>({
    name: "",
    url: "",
    description: "",
  });
  const [isCPIMode, setIsCPIMode] = useState(true);
  const [selectedHeadUrl, setSelectedHeadUrl] = useState("");
  const [serviceHeadUrls, setServiceHeadUrls] = useState<string[]>([]);
  const [showHeadUrlModal, setShowHeadUrlModal] = useState(false);
  const [newHeadUrl, setNewHeadUrl] = useState("");

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
    
    const headUrls = data.service_head_urls || [
      "https://soprasteriagroup-cpi.it-cpi001-rt.cfapps.eu10.hana.ondemand.com/http/testonpremise?service="
    ];
    setServiceHeadUrls(headUrls);
    setSelectedHeadUrl("");
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus("idle");
    const success = await saveSettings({ llm, services, mcps, joins, service_head_urls: serviceHeadUrls });
    setSaving(false);
    setSaveStatus(success ? "success" : "error");
    setTimeout(() => setSaveStatus("idle"), 3000);
  };

  const addService = async () => {
    if (!newService.name || !newService.url) return;
    const updatedServices = [...services, { ...newService, is_active: true }];
    setServices(updatedServices);
    setNewService({ name: "", url: "", description: "" });
    await saveSettings({ llm, services: updatedServices, mcps, joins, service_head_urls: serviceHeadUrls });
  };

  const toggleServiceStatus = async (index: number, currentStatus: boolean) => {
    const updatedServices = services.map((s, idx) => {
      if (idx === index) {
        return { ...s, is_active: !currentStatus };
      }
      return s;
    });
    setServices(updatedServices);
    await saveSettings({ llm, services: updatedServices, mcps, joins, service_head_urls: serviceHeadUrls });
  };

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleRefreshService = async (serviceName: string, url: string) => {
    setRefreshingServices((prev) => ({ ...prev, [url]: true }));
    try {
      const res = await refreshService(serviceName, url);
      if (res && res.status === "success") {
        showToast(res.message, "success");
      } else {
        showToast(`Failed to refresh service ${serviceName}.`, "error");
      }
    } catch (err) {
      console.error("Refresh service error:", err);
      showToast(`An error occurred while refreshing service ${serviceName}.`, "error");
    } finally {
      setRefreshingServices((prev) => ({ ...prev, [url]: false }));
    }
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
    
    await saveSettings({ llm, services: updatedServices, mcps: updatedMcps, joins: updatedJoins, service_head_urls: serviceHeadUrls });
  };

  const removeMCP = async (mcpName: string) => {
    const updatedMcps = mcps.filter((m) => m.name !== mcpName);
    setMcps(updatedMcps);
    await deleteODataMCPEntities(mcpName);
    await saveSettings({ llm, services, mcps: updatedMcps, joins, service_head_urls: serviceHeadUrls });
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

          return (
            <div className="settings-panel animate-fadeIn">
              {/* Available OData Services */}
              <div className="settings-section">
                <h3 className="settings-section-title">
                  <Server size={16} />
                  <span>Available OData Services</span>
                </h3>
                <p className="settings-section-desc">
                  Connection endpoints configured for Project Nexus. Click "Create MCP" or "Edit MCP" to manage active OData entities.
                </p>

                {odataServices.length > 0 ? (
                  <div className="settings-service-list">
                    {odataServices.map((svc) => {
                      const serviceMcps = mcps.filter((m) => m.service_name === svc.name || m.name === svc.name || m.url === svc.url);
                      const mcpCount = serviceMcps.length;
                      const hasMcp = mcpCount > 0;
                      const associatedMcp = serviceMcps[0];

                      const isActive = svc.is_active !== false;

                      return (
                        <div 
                          key={svc.originalIndex} 
                          className="settings-service-card"
                          style={{
                            opacity: isActive ? 1 : 0.75,
                            transition: "all var(--transition-fast)",
                            display: "flex",
                            alignItems: "center",
                            gap: 12
                          }}
                        >
                          {/* Active/Inactive Dot Indicator */}
                          <div 
                            style={{
                              width: "8px",
                              height: "8px",
                              borderRadius: "50%",
                              backgroundColor: isActive ? "var(--success, #10b981)" : "var(--error, #ef4444)",
                              boxShadow: isActive ? "0 0 8px var(--success, #10b981)" : "0 0 8px var(--error, #ef4444)",
                              flexShrink: 0,
                              transition: "all var(--transition-fast)"
                            }}
                            title={isActive ? "Active" : "Inactive"}
                          />

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
                            <div style={{ fontSize: "11.5px", color: "var(--text-accent)", marginTop: 5, fontWeight: 550 }}>
                              {mcpCount} MCP{mcpCount === 1 ? "" : "s"} registered
                            </div>
                          </div>
                          
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            {/* Toggle Power Button */}
                            <button
                              onClick={() => toggleServiceStatus(svc.originalIndex, isActive)}
                              className="settings-discover-btn"
                              style={{
                                background: isActive ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)",
                                borderColor: isActive ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.2)",
                                color: isActive ? "var(--success, #10b981)" : "var(--error, #ef4444)",
                                padding: "6px 10px",
                              }}
                              title={isActive ? "Deactivate Service" : "Activate Service"}
                            >
                              {isActive ? (
                                <Power size={13} />
                              ) : (
                                <PowerOff size={13} />
                              )}
                              <span style={{ fontSize: "11.5px", fontWeight: 600 }}>
                                {isActive ? "Active" : "Inactive"}
                              </span>
                            </button>

                            {/* Refresh Button */}
                            <button
                              onClick={() => handleRefreshService(svc.name, svc.url)}
                              disabled={refreshingServices[svc.url]}
                              className="settings-discover-btn"
                              title="Refresh Metadata & Sync Entities"
                              style={{ padding: "6px 10px" }}
                            >
                              {refreshingServices[svc.url] ? (
                                <Loader2 size={12} style={{ animation: "spin 1.2s linear infinite" }} />
                              ) : (
                                <RotateCw size={12} />
                              )}
                              <span>Refresh</span>
                            </button>

                            <button
                              onClick={() => onNavigateToServiceSettings(svc)}
                              className="settings-discover-btn"
                              title="Manage Service and MCPs"
                              style={{ padding: "6px 10px" }}
                            >
                              <Settings size={12} />
                              <span>Settings</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
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
                  
                  {/* Mode Toggle Selector */}
                  <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                    <button
                      type="button"
                      onClick={() => {
                        setIsCPIMode(true);
                        setNewService({
                          name: "",
                          url: `${selectedHeadUrl}&metadata=true`,
                          description: ""
                        });
                      }}
                      style={{
                        flex: 1,
                        padding: "8px 12px",
                        fontSize: "12.5px",
                        fontWeight: 600,
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid",
                        borderColor: isCPIMode ? "var(--border-accent)" : "var(--border-primary)",
                        background: isCPIMode ? "var(--accent-gradient-subtle)" : "var(--bg-input)",
                        color: isCPIMode ? "var(--text-accent)" : "var(--text-secondary)",
                        cursor: "pointer",
                        transition: "all var(--transition-fast)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6
                      }}
                    >
                      <Server size={13} />
                      <span>CPI Service Mode</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsCPIMode(false);
                        setNewService({
                          name: "",
                          url: "",
                          description: ""
                        });
                      }}
                      style={{
                        flex: 1,
                        padding: "8px 12px",
                        fontSize: "12.5px",
                        fontWeight: 600,
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid",
                        borderColor: !isCPIMode ? "var(--border-accent)" : "var(--border-primary)",
                        background: !isCPIMode ? "var(--accent-gradient-subtle)" : "var(--bg-input)",
                        color: !isCPIMode ? "var(--text-accent)" : "var(--text-secondary)",
                        cursor: "pointer",
                        transition: "all var(--transition-fast)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6
                      }}
                    >
                      <Link2 size={13} />
                      <span>Manual URL Mode</span>
                    </button>
                  </div>

                  <div className="settings-form-grid">
                    {isCPIMode ? (
                      <>
                        {/* CPI Dropdown and Settings Button */}
                        <div className="settings-field" style={{ gridColumn: "1 / -1" }}>
                          <label className="settings-label">Service Head URL</label>
                          <div style={{ display: "flex", gap: 8 }}>
                            <select
                              className="settings-input"
                              value={selectedHeadUrl}
                              onChange={(e) => {
                                const val = e.target.value;
                                setSelectedHeadUrl(val);
                                setNewService({
                                  ...newService,
                                  url: val ? `${val}${newService.name}&metadata=true` : ""
                                });
                              }}
                              style={{ flex: 1 }}
                            >
                              <option value="">Select Service Prefix...</option>
                              {serviceHeadUrls.map((url, idx) => (
                                <option key={idx} value={url}>
                                  {url}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => setShowHeadUrlModal(true)}
                              className="settings-discover-btn"
                              style={{ padding: "0 12px", height: "38px" }}
                              title="Manage Service Head URLs"
                            >
                              <Settings size={14} />
                            </button>
                          </div>
                        </div>

                        {/* CPI Service Name */}
                        <div className="settings-field" style={{ gridColumn: "1 / -1" }}>
                          <label className="settings-label">Service Name</label>
                          <input
                            type="text"
                            className="settings-input"
                            placeholder="e.g., PP_MPE_ORDER_MANAGE"
                            value={newService.name}
                            onChange={(e) => {
                              const val = e.target.value.trim();
                              setNewService({
                                ...newService,
                                name: val,
                                url: `${selectedHeadUrl}${val}&metadata=true`
                              });
                            }}
                          />
                        </div>

                        {newService.name && (
                          <div style={{ gridColumn: "1 / -1", fontSize: "11px", color: "var(--text-tertiary)", marginTop: -4 }}>
                            <span style={{ fontWeight: 600 }}>Constructed URL:</span>{" "}
                            <code style={{ color: "var(--text-accent)", wordBreak: "break-all" }}>
                              {selectedHeadUrl}{newService.name}&metadata=true
                            </code>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        {/* Standard/Manual fields */}
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
                      </>
                    )}

                    {/* Common Description Field */}
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
                    disabled={!newService.name || !newService.url || (isCPIMode && !selectedHeadUrl)}
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

                {joinedServices.length > 0 && (
                  <div className="settings-service-list" style={{ marginTop: 12, marginBottom: 16 }}>
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
                )}

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
      
      {showHeadUrlModal && (
        <div className="settings-modal-overlay">
          <div className="settings-modal-content" style={{ maxWidth: "800px", width: "90%" }}>
            <div className="settings-modal-header">
              <span style={{ fontWeight: 700, fontSize: "15px", color: "var(--text-primary)" }}>
                Manage Service Head URLs
              </span>
              <button
                onClick={async () => {
                  setShowHeadUrlModal(false);
                  await saveSettings({ llm, services, mcps, joins, service_head_urls: serviceHeadUrls });
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-tertiary)",
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
            <div className="settings-modal-body" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <p className="settings-section-desc" style={{ marginBottom: "12px" }}>
                Add, edit, or delete the base/prefix URLs used for CPI services.
              </p>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "240px", overflowY: "auto", paddingRight: "4px" }}>
                {serviceHeadUrls.map((url, idx) => (
                  <div key={idx} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <input
                      type="text"
                      className="settings-input"
                      value={url}
                      onChange={(e) => {
                        const updated = [...serviceHeadUrls];
                        updated[idx] = e.target.value;
                        setServiceHeadUrls(updated);
                        if (selectedHeadUrl === url) {
                          setSelectedHeadUrl(e.target.value);
                        }
                      }}
                      style={{ flex: 1, padding: "8px 12px", fontSize: "12.5px" }}
                    />
                    <div style={{ width: 80, display: "flex", justifyContent: "flex-end", flexShrink: 0 }}>
                      <button
                        onClick={() => {
                          const updated = serviceHeadUrls.filter((_, i) => i !== idx);
                          setServiceHeadUrls(updated);
                          if (selectedHeadUrl === url && updated.length > 0) {
                            setSelectedHeadUrl(updated[0]);
                          }
                        }}
                        className="settings-delete-btn"
                        title="Delete URL"
                        style={{ margin: 0 }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
                {serviceHeadUrls.length === 0 && (
                  <div style={{ textAlign: "center", fontSize: "12px", color: "var(--text-tertiary)", padding: "12px 0" }}>
                    No head URLs configured. Add one below.
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "12px", borderTop: "1px solid var(--border-secondary)", paddingTop: "12px" }}>
                <input
                  type="text"
                  className="settings-input"
                  placeholder="e.g., https://cpi-rt.hana.ondemand.com/http/service?"
                  value={newHeadUrl}
                  onChange={(e) => setNewHeadUrl(e.target.value)}
                  style={{ flex: 1, padding: "8px 12px", fontSize: "12.5px" }}
                  onKeyDown={async (e) => {
                    if (e.key === "Enter" && newHeadUrl.trim()) {
                      const val = newHeadUrl.trim();
                      const updated = [...serviceHeadUrls, val];
                      setServiceHeadUrls(updated);
                      if (!selectedHeadUrl) {
                        setSelectedHeadUrl(val);
                      }
                      setNewHeadUrl("");
                    }
                  }}
                />
                <div style={{ width: 80, display: "flex", justifyContent: "flex-end", flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (newHeadUrl.trim()) {
                        const val = newHeadUrl.trim();
                        const updated = [...serviceHeadUrls, val];
                        setServiceHeadUrls(updated);
                        if (!selectedHeadUrl) {
                          setSelectedHeadUrl(val);
                        }
                        setNewHeadUrl("");
                      }
                    }}
                    className="settings-discover-btn"
                    style={{ height: "36px", padding: "0 12px", display: "flex", alignItems: "center", gap: "4px", margin: 0 }}
                  >
                    <Plus size={13} />
                    <span style={{ fontSize: "12px" }}>Add</span>
                  </button>
                </div>
              </div>
            </div>
            <div className="settings-modal-footer">
              <button
                onClick={async () => {
                  setShowHeadUrlModal(false);
                  await saveSettings({ llm, services, mcps, joins, service_head_urls: serviceHeadUrls });
                }}
                className="settings-save-btn"
                style={{ margin: 0, padding: "8px 16px", borderRadius: "var(--radius-sm)" }}
              >
                <span>Save & Close</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: "24px",
            right: "24px",
            background: "var(--bg-glass-heavy)",
            backdropFilter: "blur(12px)",
            border: toast.type === "success" ? "1px solid var(--success, #10b981)" : "1px solid var(--error, #ef4444)",
            borderRadius: "var(--radius-md)",
            padding: "12px 16px",
            color: "var(--text-primary)",
            boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            gap: 10,
            animation: "fadeIn 0.2s ease",
            fontSize: "13px",
            fontWeight: 500,
          }}
        >
          {toast.type === "success" ? (
            <Check size={16} style={{ color: "var(--success, #10b981)" }} />
          ) : (
            <AlertCircle size={16} style={{ color: "var(--error, #ef4444)" }} />
          )}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}
