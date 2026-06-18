"use client";

import React, { useState } from "react";
import {
  ArrowLeft,
  Link2,
  Plus,
  Check,
  AlertCircle,
  Loader2,
  Server,
  ChevronDown,
  Merge,
} from "lucide-react";
import {
  ServiceConfig,
  JoinedServiceConfig,
  saveSettings,
  AppSettings,
} from "@/lib/api";

/* ─── Props ─── */
interface JoinViewProps {
  services: (ServiceConfig | JoinedServiceConfig)[];
  onBack: () => void;
  onServiceCreated: (newService: JoinedServiceConfig) => void;
}

const RELATION_TYPES = [
  { value: "1-1", label: "One-to-One (1:1)", desc: "Each record maps to exactly one record" },
  { value: "1-many", label: "One-to-Many (1:N)", desc: "One record maps to multiple records" },
  { value: "many-to-many", label: "Many-to-Many (N:M)", desc: "Multiple records map to multiple records" },
] as const;

/* ─── Main Join View ─── */
export function JoinView({ services, onBack, onServiceCreated }: JoinViewProps) {
  const [mcpName, setMcpName] = useState("");
  const [sourceService, setSourceService] = useState("");
  const [targetService, setTargetService] = useState("");
  const [sourceTable, setSourceTable] = useState("");
  const [targetTable, setTargetTable] = useState("");
  const [joinKey, setJoinKey] = useState("");
  const [relationType, setRelationType] = useState<"1-1" | "1-many" | "many-to-many">("1-many");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const canCreate =
    mcpName.trim() &&
    sourceService &&
    targetService &&
    sourceService !== targetService &&
    joinKey.trim();

  const handleCreate = async () => {
    if (!canCreate) return;
    setSaving(true);
    setStatus(null);

    const joinedService: JoinedServiceConfig = {
      name: mcpName.trim(),
      description: `Joined MCP: ${sourceService} ↔ ${targetService} (${relationType})`,
      is_joined: true,
      source_service: sourceService,
      target_service: targetService,
      source_table: sourceTable,
      target_table: targetTable,
      join_key: joinKey.trim(),
      relation_type: relationType,
    };

    try {
      // Add the joined service to the existing services list
      const updatedServices = [...services, joinedService];
      const success = await saveSettings({
        services: updatedServices,
      } as Partial<AppSettings>);

      if (success) {
        setStatus({
          type: "success",
          message: `✓ Joined MCP "${mcpName}" created successfully!`,
        });
        onServiceCreated(joinedService);
        // Reset form
        setMcpName("");
        setSourceService("");
        setTargetService("");
        setSourceTable("");
        setTargetTable("");
        setJoinKey("");
      } else {
        setStatus({
          type: "error",
          message: "Failed to save the joined MCP. Please try again.",
        });
      }
    } catch (err) {
      setStatus({
        type: "error",
        message: (err as Error).message || "Failed to create joined MCP",
      });
    } finally {
      setSaving(false);
    }
  };

  // Only show non-joined services as source/target options
  const baseServices = services.filter(
    (s) => !("is_joined" in s && s.is_joined)
  );

  return (
    <div className="settings-view">
      {/* Header */}
      <div className="settings-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={onBack}
            className="settings-back-btn"
            title="Back to Services"
          >
            <ArrowLeft size={18} />
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Merge size={18} style={{ color: "var(--text-accent)" }} />
            <span
              className="font-display"
              style={{
                fontSize: "16px",
                fontWeight: 700,
                color: "var(--text-primary)",
              }}
            >
              Join Services
            </span>
          </div>
        </div>
      </div>

      {/* Status banner */}
      {status && (
        <div
          className={`discovery-status-banner ${status.type === "success" ? "success" : "error"}`}
        >
          {status.type === "success" ? (
            <Check size={16} />
          ) : (
            <AlertCircle size={16} />
          )}
          <span>{status.message}</span>
        </div>
      )}

      {/* Body */}
      <div className="settings-content">
        <div className="settings-panel animate-fadeIn">
          {/* Intro */}
          <div className="settings-section">
            <h3 className="settings-section-title">
              <Link2 size={16} />
              <span>Create a Joined MCP</span>
            </h3>
            <p className="settings-section-desc">
              Combine two existing services into a new, independent Joined MCP.
              The agent will be able to query data across both services using the
              join relationship you define.
            </p>
          </div>

          {/* Existing MCPs preview */}
          {baseServices.length < 2 ? (
            <div className="join-warning-box">
              <AlertCircle size={18} />
              <div>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>
                  Not enough services
                </div>
                <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                  You need at least 2 registered services to create a join.
                  Go back and add more services first.
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* MCP Name */}
              <div className="join-form-section">
                <div className="settings-field" style={{ maxWidth: 400 }}>
                  <label className="settings-label">New MCP Name</label>
                  <input
                    type="text"
                    className="settings-input"
                    placeholder="e.g., Sales & Customers Combined"
                    value={mcpName}
                    onChange={(e) => setMcpName(e.target.value)}
                  />
                </div>
              </div>

              {/* Service Selection */}
              <div className="join-services-grid">
                {/* Source */}
                <div className="join-service-box">
                  <div className="join-service-box-header">
                    <Server size={14} />
                    <span>Source Service</span>
                  </div>
                  <select
                    className="settings-input"
                    value={sourceService}
                    onChange={(e) => setSourceService(e.target.value)}
                  >
                    <option value="">Select source MCP...</option>
                    {baseServices.map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <div className="settings-field" style={{ marginTop: 12 }}>
                    <label className="settings-label">Source Table</label>
                    <input
                      type="text"
                      className="settings-input"
                      placeholder="e.g., Orders"
                      value={sourceTable}
                      onChange={(e) => setSourceTable(e.target.value)}
                    />
                  </div>
                </div>

                {/* Center relationship */}
                <div className="join-relation-center">
                  <div className="join-relation-line" />
                  <div className="join-relation-badge">
                    <Link2 size={14} />
                  </div>
                  <div className="join-relation-line" />
                </div>

                {/* Target */}
                <div className="join-service-box">
                  <div className="join-service-box-header">
                    <Server size={14} />
                    <span>Target Service</span>
                  </div>
                  <select
                    className="settings-input"
                    value={targetService}
                    onChange={(e) => setTargetService(e.target.value)}
                  >
                    <option value="">Select target MCP...</option>
                    {baseServices.map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <div className="settings-field" style={{ marginTop: 12 }}>
                    <label className="settings-label">Target Table</label>
                    <input
                      type="text"
                      className="settings-input"
                      placeholder="e.g., Customers"
                      value={targetTable}
                      onChange={(e) => setTargetTable(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Relationship configuration */}
              <div className="join-config-section">
                <div className="settings-form-grid">
                  <div className="settings-field">
                    <label className="settings-label">Relationship Type</label>
                    <select
                      className="settings-input"
                      value={relationType}
                      onChange={(e) =>
                        setRelationType(
                          e.target.value as "1-1" | "1-many" | "many-to-many"
                        )
                      }
                    >
                      {RELATION_TYPES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <span className="join-relation-desc">
                      {RELATION_TYPES.find((r) => r.value === relationType)
                        ?.desc}
                    </span>
                  </div>
                  <div className="settings-field">
                    <label className="settings-label">Join Key</label>
                    <input
                      type="text"
                      className="settings-input"
                      placeholder="e.g., CustomerID"
                      value={joinKey}
                      onChange={(e) => setJoinKey(e.target.value)}
                    />
                    <span className="join-relation-desc">
                      The shared key field linking both tables
                    </span>
                  </div>
                </div>
              </div>

              {/* Validation warning */}
              {sourceService &&
                targetService &&
                sourceService === targetService && (
                  <div className="join-warning-box" style={{ marginTop: 16 }}>
                    <AlertCircle size={16} />
                    <span>Source and target services must be different.</span>
                  </div>
                )}

              {/* Create button */}
              <div style={{ marginTop: 28 }}>
                <button
                  onClick={handleCreate}
                  disabled={!canCreate || saving}
                  className="settings-save-btn"
                  style={{ width: "100%", justifyContent: "center", padding: "12px 24px" }}
                >
                  {saving ? (
                    <Loader2
                      size={16}
                      style={{ animation: "spin 1.2s linear infinite" }}
                    />
                  ) : (
                    <Plus size={16} />
                  )}
                  <span>
                    {saving ? "Creating Joined MCP..." : "Create Joined MCP"}
                  </span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
