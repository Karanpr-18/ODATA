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
} from "lucide-react";
import {
  fetchSettings,
  saveSettings,
  AppSettings,
  LLMConfig,
  ServiceConfig,
  JoinConfig,
} from "@/lib/api";
import { GraphExplorer } from "@/components/graph-explorer";

type SettingsTab = "models" | "services" | "graph";

interface SettingsViewProps {
  onBack: () => void;
}

export function SettingsView({ onBack }: SettingsViewProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("models");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");

  // LLM State
  const [llm, setLlm] = useState<LLMConfig>({
    provider: "",
    api_key: "",
    base_url: "",
    active_model: "",
    fallback_model: "",
  });
  const [showApiKey, setShowApiKey] = useState(false);

  // Services State
  const [services, setServices] = useState<ServiceConfig[]>([]);
  const [joins, setJoins] = useState<JoinConfig[]>([]);

  // New service form
  const [newService, setNewService] = useState<ServiceConfig>({
    name: "",
    url: "",
    description: "",
  });

  // New join form
  const [newJoin, setNewJoin] = useState<JoinConfig>({
    source_service: "",
    target_service: "",
    source_table: "",
    target_table: "",
    join_key: "",
  });

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    const data = await fetchSettings();
    setLlm(data.llm || { provider: "", api_key: "", base_url: "", active_model: "", fallback_model: "" });
    setServices(data.services || []);
    setJoins(data.joins || []);
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus("idle");
    const success = await saveSettings({ llm, services, joins });
    setSaving(false);
    setSaveStatus(success ? "success" : "error");
    setTimeout(() => setSaveStatus("idle"), 3000);
  };

  const addService = () => {
    if (!newService.name || !newService.url) return;
    setServices((prev) => [...prev, { ...newService }]);
    setNewService({ name: "", url: "", description: "" });
  };

  const removeService = (index: number) => {
    setServices((prev) => prev.filter((_, i) => i !== index));
  };

  const addJoin = () => {
    if (!newJoin.source_service || !newJoin.target_service || !newJoin.join_key) return;
    setJoins((prev) => [...prev, { ...newJoin }]);
    setNewJoin({ source_service: "", target_service: "", source_table: "", target_table: "", join_key: "" });
  };

  const removeJoin = (index: number) => {
    setJoins((prev) => prev.filter((_, i) => i !== index));
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
                {/* Provider */}
                <div className="settings-field">
                  <label className="settings-label">Provider</label>
                  <input
                    type="text"
                    className="settings-input"
                    placeholder="e.g., Groq, OpenAI, Anthropic"
                    value={llm.provider}
                    onChange={(e) => setLlm({ ...llm, provider: e.target.value })}
                  />
                </div>

                {/* Base URL */}
                <div className="settings-field">
                  <label className="settings-label">Base URL</label>
                  <input
                    type="text"
                    className="settings-input"
                    placeholder="e.g., https://api.groq.com/openai/v1"
                    value={llm.base_url}
                    onChange={(e) => setLlm({ ...llm, base_url: e.target.value })}
                  />
                </div>

                {/* API Key */}
                <div className="settings-field" style={{ gridColumn: "1 / -1" }}>
                  <label className="settings-label">API Key</label>
                  <div style={{ position: "relative" }}>
                    <input
                      type={showApiKey ? "text" : "password"}
                      className="settings-input"
                      placeholder="sk-..."
                      value={llm.api_key}
                      onChange={(e) => setLlm({ ...llm, api_key: e.target.value })}
                      style={{ paddingRight: 42 }}
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

                {/* Active Model */}
                <div className="settings-field">
                  <label className="settings-label">Primary Model</label>
                  <input
                    type="text"
                    className="settings-input"
                    placeholder="e.g., llama-3.3-70b-versatile"
                    value={llm.active_model}
                    onChange={(e) => setLlm({ ...llm, active_model: e.target.value })}
                  />
                </div>

                {/* Fallback Model */}
                <div className="settings-field">
                  <label className="settings-label">Fallback Model</label>
                  <input
                    type="text"
                    className="settings-input"
                    placeholder="e.g., llama-3.1-8b-instant"
                    value={llm.fallback_model}
                    onChange={(e) => setLlm({ ...llm, fallback_model: e.target.value })}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "services" && (
          <div className="settings-panel animate-fadeIn">
            {/* Existing Services */}
            <div className="settings-section">
              <h3 className="settings-section-title">
                <Server size={16} />
                <span>OData Services</span>
              </h3>
              <p className="settings-section-desc">
                Manage connected OData services. Add new services or remove existing ones.
              </p>

              {services.length > 0 ? (
                <div className="settings-service-list">
                  {services.map((svc, idx) => (
                    <div key={idx} className="settings-service-card">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)", marginBottom: 2 }}>
                          {svc.name}
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
                        onClick={() => removeService(idx)}
                        className="settings-delete-btn"
                        title="Remove service"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="settings-empty">
                  <Server size={24} style={{ opacity: 0.3 }} />
                  <span>No services configured yet</span>
                </div>
              )}

              {/* Add Service Form */}
              <div className="settings-add-form">
                <div className="settings-add-form-title">
                  <Plus size={14} />
                  <span>Add New Service</span>
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

            {/* Joins */}
            <div className="settings-section" style={{ marginTop: 32 }}>
              <h3 className="settings-section-title">
                <Link2 size={16} />
                <span>Service Joins</span>
              </h3>
              <p className="settings-section-desc">
                Define relationships between tables across services. Useful when two services share a common key.
              </p>

              {joins.length > 0 ? (
                <div className="settings-service-list">
                  {joins.map((join, idx) => (
                    <div key={idx} className="settings-service-card">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>
                          {join.source_service}.{join.source_table}
                          <span style={{ color: "var(--text-accent)", margin: "0 8px" }}>⟷</span>
                          {join.target_service}.{join.target_table}
                        </div>
                        <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: 3 }}>
                          Join Key: <code style={{ background: "var(--bg-tertiary)", padding: "1px 5px", borderRadius: 4, fontSize: "10.5px" }}>{join.join_key}</code>
                        </div>
                      </div>
                      <button
                        onClick={() => removeJoin(idx)}
                        className="settings-delete-btn"
                        title="Remove join"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="settings-empty">
                  <Link2 size={24} style={{ opacity: 0.3 }} />
                  <span>No joins configured</span>
                </div>
              )}

              {/* Add Join Form */}
              <div className="settings-add-form">
                <div className="settings-add-form-title">
                  <Plus size={14} />
                  <span>Add New Join</span>
                </div>
                <div className="settings-form-grid">
                  <div className="settings-field">
                    <label className="settings-label">Source Service</label>
                    <input
                      type="text"
                      className="settings-input"
                      placeholder="e.g., Northwind"
                      value={newJoin.source_service}
                      onChange={(e) => setNewJoin({ ...newJoin, source_service: e.target.value })}
                    />
                  </div>
                  <div className="settings-field">
                    <label className="settings-label">Target Service</label>
                    <input
                      type="text"
                      className="settings-input"
                      placeholder="e.g., SAP Sales"
                      value={newJoin.target_service}
                      onChange={(e) => setNewJoin({ ...newJoin, target_service: e.target.value })}
                    />
                  </div>
                  <div className="settings-field">
                    <label className="settings-label">Source Table</label>
                    <input
                      type="text"
                      className="settings-input"
                      placeholder="e.g., Orders"
                      value={newJoin.source_table}
                      onChange={(e) => setNewJoin({ ...newJoin, source_table: e.target.value })}
                    />
                  </div>
                  <div className="settings-field">
                    <label className="settings-label">Target Table</label>
                    <input
                      type="text"
                      className="settings-input"
                      placeholder="e.g., SalesOrders"
                      value={newJoin.target_table}
                      onChange={(e) => setNewJoin({ ...newJoin, target_table: e.target.value })}
                    />
                  </div>
                  <div className="settings-field" style={{ gridColumn: "1 / -1" }}>
                    <label className="settings-label">Join Key</label>
                    <input
                      type="text"
                      className="settings-input"
                      placeholder="e.g., CustomerID"
                      value={newJoin.join_key}
                      onChange={(e) => setNewJoin({ ...newJoin, join_key: e.target.value })}
                    />
                  </div>
                </div>
                <button
                  onClick={addJoin}
                  disabled={!newJoin.source_service || !newJoin.target_service || !newJoin.join_key}
                  className="settings-add-btn"
                >
                  <Plus size={15} />
                  <span>Add Join</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === "graph" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <GraphExplorer />
          </div>
        )}
      </div>
    </div>
  );
}
