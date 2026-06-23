"use client";

import React, { useState, useEffect } from "react";
import {
  ArrowLeft,
  Settings,
  Plus,
  Trash2,
  Edit2,
  Save,
  X,
  Loader2,
  Server,
  FolderOpen,
} from "lucide-react";
import {
  fetchSettings,
  saveSettings,
  ServiceConfig,
  MCPConfig,
  deleteODataMCPEntities,
} from "@/lib/api";

interface ServiceSettingsViewProps {
  service: ServiceConfig;
  onBack: () => void;
  onNavigateToDiscovery: (params: { service?: ServiceConfig; mcp?: MCPConfig }) => void;
}

export function ServiceSettingsView({ service: initialService, onBack, onNavigateToDiscovery }: ServiceSettingsViewProps) {
  const [service, setService] = useState<ServiceConfig>(initialService);
  const [mcps, setMcps] = useState<MCPConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  
  // Service Edit State
  const [isEditingService, setIsEditingService] = useState(false);
  const [editName, setEditName] = useState(service.name);
  const [editUrl, setEditUrl] = useState(service.url);
  const [editDesc, setEditDesc] = useState(service.description);
  const [savingService, setSavingService] = useState(false);

  // Delete Confirmation State
  const [deleteConfirm, setDeleteConfirm] = useState<{
    show: boolean;
    type: "service" | "mcp";
    mcpName?: string;
    message: string;
  }>({ show: false, type: "service", message: "" });

  useEffect(() => {
    loadMcps();
  }, []);

  const loadMcps = async () => {
    setLoading(true);
    const data = await fetchSettings();
    setMcps(data.mcps || []);
    setLoading(false);
  };

  // Get only MCPs associated with this service
  const serviceMcps = mcps.filter(
    (m) =>
      m.service_name === service.name ||
      m.name === service.name ||
      m.url === service.url
  );

  const saveServiceEdits = async () => {
    if (!editName.trim() || !editUrl.trim()) return;
    setSavingService(true);
    
    const data = await fetchSettings();
    const currentServices = data.services || [];
    
    const updatedServices = currentServices.map((s) => {
      if (s.name === service.name || ("url" in s && s.url === service.url)) {
        return { ...s, name: editName.trim(), url: editUrl.trim(), description: editDesc.trim() };
      }
      return s;
    });

    // Also update any associated MCPs to match the new service name/url
    const currentMcps = data.mcps || [];
    const updatedMcps = currentMcps.map((m) => {
      if (m.service_name === service.name || m.url === service.url) {
        return { ...m, service_name: editName.trim(), url: editUrl.trim() };
      }
      return m;
    });

    const success = await saveSettings({ services: updatedServices, mcps: updatedMcps });
    if (success) {
      const updatedSvc = { ...service, name: editName.trim(), url: editUrl.trim(), description: editDesc.trim() };
      setService(updatedSvc);
      setMcps(updatedMcps);
      setIsEditingService(false);
    }
    setSavingService(false);
  };

  const removeService = () => {
    setDeleteConfirm({
      show: true,
      type: "service",
      message: `Are you sure you want to remove the service endpoint "${service.name}"? This will delete all its MCP configurations and entities.`
    });
  };

  const removeMCP = (mcpName: string) => {
    setDeleteConfirm({
      show: true,
      type: "mcp",
      mcpName,
      message: `Are you sure you want to delete the MCP configuration "${mcpName}"? This will remove all its registered tools.`
    });
  };

  const handleConfirmDelete = async () => {
    const { type, mcpName } = deleteConfirm;
    setDeleteConfirm({ show: false, type: "service", message: "" });

    if (type === "service") {
      setSavingService(true);
      const data = await fetchSettings();
      const currentServices = data.services || [];
      const updatedServices = currentServices.filter((s) => s.name !== service.name && (!("url" in s) || s.url !== service.url));
      
      const mcpsToDelete = mcps.filter((m) => m.service_name === service.name || m.url === service.url);
      const updatedMcps = mcps.filter((m) => m.service_name !== service.name && m.url !== service.url);
      
      const success = await saveSettings({ services: updatedServices, mcps: updatedMcps });
      if (success) {
        for (const mcp of mcpsToDelete) {
          await deleteODataMCPEntities(mcp.name);
        }
        onBack();
      }
      setSavingService(false);
    } else if (type === "mcp" && mcpName) {
      setUpdating(mcpName);
      const data = await fetchSettings();
      const currentMcps = data.mcps || [];
      const updatedMcps = currentMcps.filter((m) => m.name !== mcpName);

      const success = await saveSettings({ mcps: updatedMcps });
      if (success) {
        await deleteODataMCPEntities(mcpName);
        setMcps(updatedMcps);
      }
      setUpdating(null);
    }
  };

  return (
    <div className="settings-view animate-fadeIn">
      {/* Top Header */}
      <div className="settings-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={onBack} className="settings-back-btn" title="Back to Services">
            <ArrowLeft size={18} />
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Server size={18} style={{ color: "var(--text-accent)" }} />
            <span className="font-display" style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary)" }}>
              {service.name} Settings
            </span>
          </div>
        </div>
      </div>

      {/* Main Panel */}
      <div className="settings-content">
        <div className="settings-panel">
          
          {/* Service Details Card */}
          <div className="settings-section" style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 className="settings-section-title">
                <Server size={16} />
                <span>Service Details</span>
              </h3>
              
              {!isEditingService && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button 
                    onClick={() => {
                      setEditName(service.name);
                      setEditUrl(service.url);
                      setEditDesc(service.description || "");
                      setIsEditingService(true);
                    }}
                    className="settings-discover-btn" 
                    title="Edit Service Endpoint"
                    style={{ padding: "4px 8px", fontSize: "11px" }}
                  >
                    <Edit2 size={11} />
                    <span>Edit Service</span>
                  </button>
                  <button 
                    onClick={removeService}
                    className="settings-delete-btn" 
                    title="Remove Service Endpoint"
                    style={{ padding: "4px 8px" }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              )}
            </div>

            <div 
              style={{ 
                background: "var(--bg-glass)", 
                border: "1px solid var(--border-primary)", 
                borderRadius: "var(--radius-md)", 
                padding: "16px",
                marginTop: "12px"
              }}
            >
              {isEditingService ? (
                <div className="settings-form-grid" style={{ gap: 12 }}>
                  <div className="settings-field">
                    <label className="settings-label">Service Name</label>
                    <input
                      type="text"
                      className="settings-input"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  </div>
                  <div className="settings-field">
                    <label className="settings-label">Service URL</label>
                    <input
                      type="text"
                      className="settings-input"
                      value={editUrl}
                      onChange={(e) => setEditUrl(e.target.value)}
                    />
                  </div>
                  <div className="settings-field" style={{ gridColumn: "1 / -1" }}>
                    <label className="settings-label">Description (optional)</label>
                    <input
                      type="text"
                      className="settings-input"
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                    />
                  </div>
                  <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                    <button 
                      onClick={() => setIsEditingService(false)}
                      className="settings-discover-btn" 
                      style={{ background: "none", border: "1px solid var(--border-secondary)" }}
                    >
                      <X size={13} />
                      <span>Cancel</span>
                    </button>
                    <button 
                      onClick={saveServiceEdits}
                      disabled={savingService || !editName.trim() || !editUrl.trim()}
                      className="settings-discover-btn" 
                      style={{ background: "var(--accent-primary)", border: "none", color: "#fff" }}
                    >
                      {savingService ? (
                        <Loader2 size={13} style={{ animation: "spin 1.2s linear infinite" }} />
                      ) : (
                        <Save size={13} />
                      )}
                      <span>Save Changes</span>
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
                    {service.name}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--text-tertiary)", wordBreak: "break-all" }}>
                    {service.url}
                  </div>
                  {service.description && (
                    <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: 8, borderTop: "1px solid var(--border-secondary)", paddingTop: 8 }}>
                      {service.description}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* MCP Configurations Section */}
          <div className="settings-section">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <h3 className="settings-section-title" style={{ margin: 0 }}>
                <Settings size={16} />
                <span>MCP Configurations</span>
              </h3>
              
              <button
                onClick={() => onNavigateToDiscovery({ service })}
                className="settings-add-btn"
                style={{ margin: 0, padding: "6px 12px", fontSize: "12px" }}
              >
                <Plus size={14} />
                <span>Create New MCP</span>
              </button>
            </div>
            
            <p className="settings-section-desc">
              Manage OData Model Context Protocol (MCP) definitions for this service.
            </p>

            {loading ? (
              <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
                <Loader2 size={24} style={{ animation: "spin 1.2s linear infinite", color: "var(--text-accent)" }} />
              </div>
            ) : serviceMcps.length > 0 ? (
              <div className="settings-service-list" style={{ marginTop: 16 }}>
                {serviceMcps.map((mcp) => {
                  const isPending = updating === mcp.name;

                  return (
                    <div 
                      key={mcp.name} 
                      className="settings-service-card"
                      style={{
                        transition: "all var(--transition-fast)",
                        display: "flex",
                        alignItems: "center",
                        gap: 16,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
                            {mcp.name}
                          </span>
                        </div>
                        <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: 2 }}>
                          {mcp.entity_sets.length} entity set{mcp.entity_sets.length === 1 ? "" : "s"} selected
                        </div>
                      </div>

                      {/* Controls Group */}
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {/* Edit Button */}
                        <button
                          onClick={() => onNavigateToDiscovery({ mcp })}
                          disabled={isPending}
                          className="settings-discover-btn"
                          style={{ padding: "6px 10px" }}
                          title="Edit MCP Entities"
                        >
                          <Edit2 size={13} />
                          <span>Edit</span>
                        </button>

                        {/* Delete Button */}
                        <button
                          onClick={() => removeMCP(mcp.name)}
                          disabled={isPending}
                          className="settings-delete-btn"
                          style={{ padding: 7 }}
                          title="Delete MCP Configuration"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="settings-empty" style={{ marginTop: 16 }}>
                <FolderOpen size={24} style={{ opacity: 0.3 }} />
                <span>No MCP configurations found for this service. Click "Create New MCP" above to add one.</span>
              </div>
            )}
          </div>

        </div>
      </div>

      {deleteConfirm.show && (
        <div className="settings-modal-overlay">
          <div className="settings-modal-content">
            <div className="settings-modal-header">
              <span style={{ fontWeight: 700, fontSize: "15px", color: "var(--text-primary)" }}>
                Confirm Delete
              </span>
              <button
                onClick={() => setDeleteConfirm({ show: false, type: "service", message: "" })}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-tertiary)",
                  cursor: "pointer",
                }}
              >
                <X size={16} />
              </button>
            </div>
            <div className="settings-modal-body">
              <p style={{ fontSize: "13.5px", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                {deleteConfirm.message}
              </p>
            </div>
            <div className="settings-modal-footer">
              <button
                onClick={() => setDeleteConfirm({ show: false, type: "service", message: "" })}
                className="settings-discover-btn"
                style={{
                  margin: 0,
                  padding: "8px 16px",
                  borderRadius: "var(--radius-sm)",
                  background: "transparent",
                  borderColor: "var(--border-primary)",
                  color: "var(--text-secondary)"
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="settings-save-btn"
                style={{
                  margin: 0,
                  padding: "8px 16px",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--error, #ef4444)",
                  color: "#ffffff"
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
