"use client";

import React, { useState, useEffect } from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft,
  Loader2,
  Network,
  GripVertical,
  Check,
  AlertCircle,
  ChevronRight,
  ChevronLeft,
  Layers,
  Box,
  FileText,
} from "lucide-react";
import {
  ServiceConfig,
  DiscoveredEntity,
  fetchODataMetadata,
  registerODataEntities,
  MCPConfig,
  fetchSettings,
  saveSettings,
} from "@/lib/api";

/* ─── Props ─── */
interface DiscoveryViewProps {
  service?: ServiceConfig;
  mcp?: MCPConfig;
  onBack: () => void;
}

/* ─── Droppable Container (for empty columns) ─── */
function DroppableContainer({ id, children, className }: { id: string; children: React.ReactNode; className: string }) {
  const { setNodeRef } = useDroppable({ id });
  return (
    <div ref={setNodeRef} id={id} className={className}>
      {children}
    </div>
  );
}

/* ─── Draggable Entity Card (LHS — available) ─── */
function AvailableEntityCard({
  entity,
  containerId,
}: {
  entity: DiscoveredEntity;
  containerId: string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: entity.name,
    data: { containerId },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="discovery-entity-card"
      {...attributes}
      {...listeners}
    >
      <GripVertical size={14} className="discovery-grip" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="discovery-entity-name">{entity.name}</div>
        <div className="discovery-entity-type">{entity.entity_type}</div>
      </div>
    </div>
  );
}

/* ─── Draggable Entity Card (RHS — selected, with description) ─── */
function SelectedEntityCard({
  entity,
  containerId,
  description,
  onDescriptionChange,
}: {
  entity: DiscoveredEntity;
  containerId: string;
  description: string;
  onDescriptionChange: (desc: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: entity.name,
    data: { containerId },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="discovery-entity-card selected-card"
      {...attributes}
    >
      <div className="discovery-card-top" {...listeners}>
        <GripVertical size={14} className="discovery-grip" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="discovery-entity-name">{entity.name}</div>
          <div className="discovery-entity-type">{entity.entity_type}</div>
        </div>
      </div>
      <div className="discovery-desc-row">
        <FileText size={12} style={{ color: "var(--text-tertiary)", flexShrink: 0, marginTop: 2 }} />
        <input
          type="text"
          className="discovery-desc-input"
          placeholder="Add a description for the model (optional)"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  );
}

/* ─── Overlay card shown while dragging ─── */
function DragOverlayCard({ entity }: { entity: DiscoveredEntity }) {
  return (
    <div className="discovery-entity-card dragging-overlay">
      <GripVertical size={14} className="discovery-grip" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="discovery-entity-name">{entity.name}</div>
        <div className="discovery-entity-type">{entity.entity_type}</div>
      </div>
    </div>
  );
}

/* ─── Main Discovery View ─── */
export function DiscoveryView({ service, mcp, onBack }: DiscoveryViewProps) {
  const isEditMode = !!mcp;
  const activeService = mcp
    ? { name: mcp.service_name, url: mcp.url, description: mcp.description || "" }
    : service!;

  const [loading, setLoading] = useState(true);
  const [mcpName, setMcpName] = useState(mcp ? mcp.name : "");
  const [prompt, setPrompt] = useState(mcp ? (mcp.prompt || "") : "");
  const [allEntities, setAllEntities] = useState<DiscoveredEntity[]>([]);
  const [availableNames, setAvailableNames] = useState<string[]>([]);
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [status, setStatus] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  /* Fetch metadata on mount */
  useEffect(() => {
    (async () => {
      setLoading(true);
      setFetchError(null);
      try {
        const data = await fetchODataMetadata(activeService.url, mcp?.name);
        setAllEntities(data.entity_sets);
        
        const registeredNames = data.registered_entities.map((r) => r.name);
        
        // Available are those metadata entities not yet registered
        setAvailableNames(data.entity_sets.map((e) => e.name).filter(name => !registeredNames.includes(name)));
        setSelectedNames(registeredNames);
        
        const initialDescriptions: Record<string, string> = {};
        data.registered_entities.forEach((r) => {
          if (r.description) {
            initialDescriptions[r.name] = r.description;
          }
        });
        setDescriptions(initialDescriptions);
      } catch (err) {
        setFetchError((err as Error).message || "Failed to fetch metadata");
      } finally {
        setLoading(false);
      }
    })();
  }, [activeService.url, mcp?.name]);

  /* Helpers */
  const entityMap = new Map(allEntities.map((e) => [e.name, e]));

  const moveToSelected = (name: string) => {
    setAvailableNames((prev) => prev.filter((n) => n !== name));
    setSelectedNames((prev) => [...prev, name]);
  };

  const moveToAvailable = (name: string) => {
    setSelectedNames((prev) => prev.filter((n) => n !== name));
    setAvailableNames((prev) => [...prev, name]);
  };

  const moveAllToSelected = () => {
    setSelectedNames((prev) => [...prev, ...availableNames]);
    setAvailableNames([]);
  };

  const moveAllToAvailable = () => {
    setAvailableNames((prev) => [...prev, ...selectedNames]);
    setSelectedNames([]);
  };

  const updateDescription = (name: string, desc: string) => {
    setDescriptions((prev) => ({ ...prev, [name]: desc }));
  };

  /* Drag handlers */
  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const activeContainer = active.data.current?.containerId;
    const overId = over.id as string;

    // Determine target container
    let targetContainer: string;
    if (overId === "available-drop" || overId === "selected-drop") {
      targetContainer = overId === "available-drop" ? "available" : "selected";
    } else {
      // Dropped over another entity card — figure out which column it's in
      targetContainer = availableNames.includes(overId) ? "available" : "selected";
    }

    const activeName = active.id as string;

    if (activeContainer === "available" && targetContainer === "selected") {
      moveToSelected(activeName);
    } else if (activeContainer === "selected" && targetContainer === "available") {
      moveToAvailable(activeName);
    }
  };

  /* Register */
  const handleRegister = async () => {
    if (!mcpName.trim()) {
      setStatus({
        type: "error",
        message: "Please enter a name for the MCP.",
      });
      return;
    }

    setRegistering(true);
    setStatus(null);
    try {
      // Filter out empty descriptions
      const nonEmptyDescs: Record<string, string> = {};
      for (const [k, v] of Object.entries(descriptions)) {
        if (v.trim()) nonEmptyDescs[k] = v.trim();
      }

      // 1. Register entities in SurrealDB
      const res = await registerODataEntities(
        mcpName.trim(), // Stored as module name
        activeService.url,
        selectedNames,
        Object.keys(nonEmptyDescs).length > 0 ? nonEmptyDescs : undefined
      );

      // 2. Load latest settings and add/update MCP record
      const settings = await fetchSettings();
      const existingMcps = settings.mcps || [];

      const newMcp: MCPConfig = {
        name: mcpName.trim(),
        service_name: activeService.name,
        url: activeService.url,
        description: `MCP schema containing: ${selectedNames.join(", ")}`,
        entity_sets: selectedNames,
        entity_descriptions: nonEmptyDescs,
        prompt: prompt.trim(),
      };

      let updatedMcps: MCPConfig[];
      if (isEditMode) {
        updatedMcps = existingMcps.map((m) => (m.name.toLowerCase() === mcp.name.toLowerCase() ? newMcp : m));
      } else {
        if (existingMcps.some((m) => m.name.toLowerCase() === newMcp.name.toLowerCase())) {
          throw new Error(`An MCP named "${newMcp.name}" already exists. Please choose a unique name.`);
        }
        updatedMcps = [...existingMcps, newMcp];
      }

      const saveSuccess = await saveSettings({ mcps: updatedMcps });
      if (!saveSuccess) {
        throw new Error("Failed to save MCP configuration to application settings.");
      }

      setStatus({
        type: "success",
        message: isEditMode
          ? `✓ MCP "${mcpName.trim()}" updated successfully!`
          : `✓ MCP "${mcpName.trim()}" created successfully with ${res.registered_entities_count} entities and ${res.relationships_created_count} relations!`,
      });
    } catch (err) {
      setStatus({
        type: "error",
        message: (err as Error).message || "Failed to register entities",
      });
    } finally {
      setRegistering(false);
    }
  };

  const activeEntity = activeId ? entityMap.get(activeId) : null;

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
            <Network size={18} style={{ color: "var(--text-accent)" }} />
            <span
              className="font-display"
              style={{
                fontSize: "16px",
                fontWeight: 700,
                color: "var(--text-primary)",
              }}
            >
              {isEditMode ? "Edit MCP" : "Create MCP"}
            </span>
            <span
              style={{
                fontSize: "13px",
                color: "var(--text-tertiary)",
                fontWeight: 500,
              }}
            >
              — Source: {activeService.name}
            </span>
          </div>
        </div>
        <button
          onClick={handleRegister}
          disabled={selectedNames.length === 0 || registering || !mcpName.trim()}
          className="settings-save-btn"
        >
          {registering ? (
            <Loader2
              size={15}
              style={{ animation: "spin 1.2s linear infinite" }}
            />
          ) : (
            <Check size={15} />
          )}
          <span>
            {registering
              ? (isEditMode ? "Saving Changes..." : "Creating MCP...")
              : (isEditMode ? "Save Changes" : `Create MCP (${selectedNames.length})`)}
          </span>
        </button>
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
      <div className="settings-content" style={{ padding: 0, display: "flex", flexDirection: "column", height: "100%" }}>
        {/* MCP Name Header */}
        <div style={{ borderBottom: "1px solid var(--border-primary)", padding: "16px 24px", background: "var(--bg-glass-heavy)", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "24px" }}>
            <div style={{ flex: 1, minWidth: "250px", display: "flex", flexDirection: "column", gap: 6 }}>
              <label className="settings-label" style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-secondary)" }}>
                MCP Name
              </label>
              <input
                type="text"
                className="settings-input"
                placeholder="e.g., Northwind Sales MCP"
                value={mcpName}
                onChange={(e) => setMcpName(e.target.value)}
                readOnly={isEditMode}
                style={{
                  width: "100%",
                  fontSize: "14px",
                  fontWeight: 600,
                  opacity: isEditMode ? 0.75 : 1,
                  cursor: isEditMode ? "not-allowed" : "text",
                  backgroundColor: isEditMode ? "rgba(255, 255, 255, 0.02)" : "var(--bg-primary)"
                }}
              />
              {!isEditMode && (
                <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
                  Define a unique name for this MCP. Multiple MCPs can be created from the same service.
                </span>
              )}
            </div>

            <div style={{ flex: 2, minWidth: "350px", display: "flex", flexDirection: "column", gap: 6 }}>
              <label className="settings-label" style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-secondary)" }}>
                MCP Prompt & Instructions (Optional)
              </label>
              <textarea
                className="settings-input"
                placeholder="Instructions / description for the LLM model on how to utilize this MCP (e.g. key filters, specific interpretations of data fields)."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={2}
                style={{
                  width: "100%",
                  fontSize: "13px",
                  fontWeight: 400,
                  resize: "vertical",
                  minHeight: "42px",
                  fontFamily: "inherit",
                  padding: "8px 12px"
                }}
              />
              <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
                Optional instructions or context about this MCP that will be passed to the agent model.
              </span>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="discovery-loading" style={{ flex: 1 }}>
            <Loader2
              size={28}
              style={{
                animation: "spin 1.2s linear infinite",
                color: "var(--text-accent)",
              }}
            />
            <span>Fetching service metadata...</span>
          </div>
        ) : fetchError ? (
          <div className="discovery-loading" style={{ flex: 1 }}>
            <AlertCircle
              size={28}
              style={{ color: "#ef4444" }}
            />
            <span style={{ color: "#ef4444" }}>{fetchError}</span>
            <button onClick={onBack} className="settings-add-btn" style={{ marginTop: 12 }}>
              Go Back
            </button>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="discovery-columns">
              {/* LHS — Available */}
              <div className="discovery-column">
                <div className="discovery-column-header">
                  <div className="discovery-column-title">
                    <Layers size={16} />
                    <span>Available Entities</span>
                  </div>
                  <span className="discovery-column-count">
                    {availableNames.length}
                  </span>
                </div>
                <div className="discovery-column-actions">
                  <button
                    onClick={moveAllToSelected}
                    disabled={availableNames.length === 0}
                    className="discovery-move-all-btn"
                  >
                    Move All
                    <ChevronRight size={14} />
                  </button>
                </div>
                <SortableContext
                  items={availableNames}
                  strategy={verticalListSortingStrategy}
                  id="available"
                >
                  <DroppableContainer id="available-drop" className="discovery-entity-list">
                    {availableNames.length === 0 ? (
                      <div className="discovery-empty">
                        <Box size={20} style={{ opacity: 0.3 }} />
                        <span>All entities selected</span>
                      </div>
                    ) : (
                      availableNames.map((name) => {
                        const entity = entityMap.get(name);
                        return entity ? (
                          <div key={name} onDoubleClick={() => moveToSelected(name)}>
                            <AvailableEntityCard
                              entity={entity}
                              containerId="available"
                            />
                          </div>
                        ) : null;
                      })
                    )}
                  </DroppableContainer>
                </SortableContext>
              </div>

              {/* Center arrows */}
              <div className="discovery-center-divider">
                <div className="discovery-arrow-icon">
                  <ChevronRight size={20} />
                </div>
                <div className="discovery-arrow-icon reverse">
                  <ChevronLeft size={20} />
                </div>
              </div>

              {/* RHS — Selected (with description inputs) */}
              <div className="discovery-column selected">
                <div className="discovery-column-header">
                  <div className="discovery-column-title">
                    <Check size={16} />
                    <span>Selected Entities</span>
                  </div>
                  <span className="discovery-column-count accent">
                    {selectedNames.length}
                  </span>
                </div>
                <div className="discovery-column-actions">
                  <button
                    onClick={moveAllToAvailable}
                    disabled={selectedNames.length === 0}
                    className="discovery-move-all-btn"
                  >
                    <ChevronLeft size={14} />
                    Remove All
                  </button>
                </div>
                <SortableContext
                  items={selectedNames}
                  strategy={verticalListSortingStrategy}
                  id="selected"
                >
                  <DroppableContainer id="selected-drop" className="discovery-entity-list">
                    {selectedNames.length === 0 ? (
                      <div className="discovery-empty">
                        <Box size={20} style={{ opacity: 0.3 }} />
                        <span>Drag entities here to select them</span>
                      </div>
                    ) : (
                      selectedNames.map((name) => {
                        const entity = entityMap.get(name);
                        return entity ? (
                          <div key={name} onDoubleClick={() => moveToAvailable(name)}>
                            <SelectedEntityCard
                              entity={entity}
                              containerId="selected"
                              description={descriptions[name] || ""}
                              onDescriptionChange={(desc) => updateDescription(name, desc)}
                            />
                          </div>
                        ) : null;
                      })
                    )}
                  </DroppableContainer>
                </SortableContext>
              </div>
            </div>

            <DragOverlay>
              {activeEntity ? <DragOverlayCard entity={activeEntity} /> : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
    </div>
  );
}
