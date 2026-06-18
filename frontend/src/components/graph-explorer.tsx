"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Database,
  Network,
  Table,
  Key,
  Search,
  Share2,
  Loader2,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from "lucide-react";
import { fetchSchemaGraph } from "@/lib/api";

interface Column {
  name: string;
  type: string;
  isKey?: boolean;
}

interface RawNode {
  id: string;
  name: string;
  entitySet: string;
  module: string;
  description: string;
  url: string;
  columns: Column[];
}

interface Edge {
  from: string;
  to: string;
  label: string;
}

interface LayoutNode extends RawNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

const CARD_WIDTH = 220;
const CARD_HEADER = 36;
const COL_ROW_HEIGHT = 22;
const CARD_PADDING_BOTTOM = 8;
const COL_SPACING = 360;
const ROW_SPACING = 32;

const PALETTE = ["#10B981", "#3B82F6", "#F59E0B", "#8B5CF6", "#EF4444", "#EC4899", "#14B8A6", "#F43F5E", "#84CC16"];

export function GraphExplorer() {
  const [dbData, setDbData] = useState<{ nodes: RawNode[]; edges: Edge[] }>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      const data = await fetchSchemaGraph();
      if (data && data.nodes && data.nodes.length > 0) {
        setDbData(data);
        setSelectedNodeId(data.nodes[0].id);
      }
      setLoading(false);
    }
    loadData();
  }, []);

  // Module colors
  const modules = useMemo(() => Array.from(new Set(dbData.nodes.map((n) => n.module || "General"))), [dbData.nodes]);
  const moduleColorMap = useMemo(() => Object.fromEntries(modules.map((mod, i) => [mod, PALETTE[i % PALETTE.length]])), [modules]);
  const getColor = (mod: string) => moduleColorMap[mod || "General"] || "#94a3b8";

  // Layout: compute positions using layered DAG
  const layoutNodes: LayoutNode[] = useMemo(() => {
    const nodes = dbData.nodes;
    const edges = dbData.edges;
    if (nodes.length === 0) return [];

    // Build adjacency and in-degree
    const inDeg: Record<string, number> = {};
    const adj: Record<string, string[]> = {};
    nodes.forEach((n) => { inDeg[n.id] = 0; adj[n.id] = []; });
    edges.forEach((e) => {
      if (adj[e.from] && inDeg[e.to] !== undefined) {
        adj[e.from].push(e.to);
        inDeg[e.to]++;
      }
    });

    // BFS layering
    const queue: string[] = [];
    const layers: Record<string, number> = {};
    nodes.forEach((n) => { if (inDeg[n.id] === 0) { queue.push(n.id); layers[n.id] = 0; } });
    if (queue.length === 0 && nodes.length > 0) { queue.push(nodes[0].id); layers[nodes[0].id] = 0; }

    let head = 0;
    while (head < queue.length) {
      const u = queue[head++];
      adj[u].forEach((v) => {
        const next = (layers[u] || 0) + 1;
        if (layers[v] === undefined || layers[v] < next) {
          layers[v] = next;
          if (!queue.includes(v)) queue.push(v);
        }
      });
    }
    nodes.forEach((n) => { if (layers[n.id] === undefined) layers[n.id] = 0; });

    // Group by layer
    const layerGroups: Record<number, RawNode[]> = {};
    nodes.forEach((n) => {
      const l = layers[n.id];
      if (!layerGroups[l]) layerGroups[l] = [];
      layerGroups[l].push(n);
    });

    // Position
    const result: LayoutNode[] = [];
    Object.keys(layerGroups).sort((a, b) => +a - +b).forEach((lStr) => {
      const l = parseInt(lStr);
      const group = layerGroups[l];
      let currentY = 0;

      group.forEach((node) => {
        const numCols = (node.columns || []).length;
        const cardH = CARD_HEADER + numCols * COL_ROW_HEIGHT + CARD_PADDING_BOTTOM;
        result.push({
          ...node,
          x: l * COL_SPACING,
          y: currentY,
          width: CARD_WIDTH,
          height: cardH,
        });
        currentY += cardH + ROW_SPACING;
      });
    });

    return result;
  }, [dbData]);

  // SVG canvas size
  const svgWidth = useMemo(() => {
    if (layoutNodes.length === 0) return 800;
    return Math.max(...layoutNodes.map((n) => n.x + n.width)) + 100;
  }, [layoutNodes]);
  const svgHeight = useMemo(() => {
    if (layoutNodes.length === 0) return 600;
    return Math.max(...layoutNodes.map((n) => n.y + n.height)) + 100;
  }, [layoutNodes]);

  const selectedNode = dbData.nodes.find((n) => n.id === selectedNodeId) || dbData.nodes[0];
  const filteredColumns = selectedNode
    ? (selectedNode.columns || []).filter((c: Column) => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : [];

  // Pan handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) { // left click
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    }
  };
  const handleMouseUp = () => setIsPanning(false);
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((prev) => Math.min(2.5, Math.max(0.3, prev - e.deltaY * 0.001)));
  };

  if (loading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", height: "100%", background: "var(--bg-chat)" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <Loader2 size={32} style={{ animation: "spin 1.2s linear infinite", color: "var(--text-accent)" }} />
          <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-secondary)" }}>Loading Schema Graph...</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-chat)", overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        padding: "12px 24px",
        borderBottom: "1px solid var(--border-secondary)",
        background: "var(--bg-glass)",
        backdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        zIndex: 10,
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Network size={18} style={{ color: "var(--text-accent)" }} />
          <span className="font-display" style={{ fontSize: "15px", fontWeight: 650, color: "var(--text-primary)" }}>
            Entity Relationship Graph
          </span>
        </div>
        {/* Legend */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: "11px", fontWeight: 600 }}>
          {modules.map((mod) => (
            <div key={mod} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: moduleColorMap[mod] }} />
              <span style={{ color: "var(--text-secondary)" }}>{mod}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Canvas */}
        <div
          style={{
            flex: 1,
            position: "relative",
            overflow: "hidden",
            background: "radial-gradient(ellipse at center, var(--bg-primary) 0%, var(--bg-chat) 70%)",
            cursor: isPanning ? "grabbing" : "grab",
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        >
          {layoutNodes.length === 0 ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-tertiary)", fontSize: 14 }}>
              No entities found in SurrealDB. Register some entities first.
            </div>
          ) : (
            <svg
              width="100%"
              height="100%"
              style={{ overflow: "visible" }}
            >
              <defs>
                <marker id="graph-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--text-accent)" opacity="0.6" />
                </marker>
              </defs>
              <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
                {/* Edges */}
                {dbData.edges.map((edge, idx) => {
                  const from = layoutNodes.find((n) => n.id === edge.from);
                  const to = layoutNodes.find((n) => n.id === edge.to);
                  if (!from || !to) return null;

                  const isSelected = selectedNodeId === edge.from || selectedNodeId === edge.to;
                  const fromX = from.x + from.width;
                  const fromY = from.y + from.height / 2;
                  const toX = to.x;
                  const toY = to.y + to.height / 2;

                  // If target is to the left, reverse port sides
                  const sx = toX > fromX ? fromX : from.x;
                  const sy = fromY;
                  const ex = toX > fromX ? toX : to.x + to.width;
                  const ey = toY;

                  const dx = Math.abs(ex - sx);
                  const cpOff = Math.max(60, dx * 0.4);

                  const path = `M ${sx} ${sy} C ${sx + (ex > sx ? cpOff : -cpOff)} ${sy}, ${ex + (ex > sx ? -cpOff : cpOff)} ${ey}, ${ex} ${ey}`;

                  return (
                    <g key={`e-${idx}`}>
                      {/* Glow */}
                      {isSelected && (
                        <path d={path} fill="none" stroke="var(--text-accent)" strokeWidth={4} opacity={0.1} />
                      )}
                      <path
                        d={path}
                        fill="none"
                        stroke={isSelected ? "var(--text-accent)" : "var(--text-tertiary)"}
                        strokeWidth={isSelected ? 2 : 1.2}
                        opacity={isSelected ? 0.8 : 0.25}
                        markerEnd="url(#graph-arrow)"
                        style={{ transition: "all 0.2s ease" }}
                      />
                      {/* Label */}
                      {isSelected && edge.label && (
                        <g>
                          <rect
                            x={(sx + ex) / 2 - 50}
                            y={(sy + ey) / 2 - 10}
                            width="100"
                            height="18"
                            rx="4"
                            fill="var(--bg-secondary)"
                            stroke="var(--border-accent)"
                            strokeWidth="1"
                            opacity="0.95"
                          />
                          <text
                            x={(sx + ex) / 2}
                            y={(sy + ey) / 2 + 3}
                            textAnchor="middle"
                            fill="var(--text-accent)"
                            fontSize="10px"
                            fontWeight="600"
                          >
                            {edge.label.length > 18 ? edge.label.slice(0, 18) + "…" : edge.label}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}

                {/* Node Cards */}
                {layoutNodes.map((node) => {
                  const isSelected = selectedNodeId === node.id;
                  const color = getColor(node.module);
                  const cols = node.columns || [];

                  return (
                    <g
                      key={node.id}
                      transform={`translate(${node.x}, ${node.y})`}
                      onClick={() => setSelectedNodeId(node.id)}
                      style={{ cursor: "pointer" }}
                    >
                      {/* Card shadow */}
                      <rect
                        x={2} y={2}
                        width={node.width} height={node.height}
                        rx={10}
                        fill="rgba(0,0,0,0.15)"
                      />
                      {/* Card body */}
                      <rect
                        width={node.width} height={node.height}
                        rx={10}
                        fill="var(--bg-secondary)"
                        stroke={isSelected ? color : "var(--border-primary)"}
                        strokeWidth={isSelected ? 2 : 1}
                        style={{ transition: "all 0.2s ease" }}
                      />
                      {/* Colored header bar */}
                      <rect
                        width={node.width} height={CARD_HEADER}
                        rx={10}
                        fill={color}
                        opacity={isSelected ? 0.2 : 0.1}
                      />
                      {/* Bottom corners mask for header */}
                      <rect
                        y={CARD_HEADER - 10}
                        width={node.width} height={10}
                        fill={color}
                        opacity={isSelected ? 0.2 : 0.1}
                      />
                      {/* Table icon + name */}
                      <g transform={`translate(12, ${CARD_HEADER / 2})`}>
                        <circle r={4} fill={color} />
                      </g>
                      <text
                        x={24}
                        y={CARD_HEADER / 2 + 4}
                        fill="var(--text-primary)"
                        fontSize="12px"
                        fontWeight="700"
                        fontFamily="'Outfit', sans-serif"
                      >
                        {node.name.length > 22 ? node.name.slice(0, 22) + "…" : node.name}
                      </text>

                      {/* Separator */}
                      <line x1={0} y1={CARD_HEADER} x2={node.width} y2={CARD_HEADER} stroke="var(--border-primary)" strokeWidth={1} />

                      {/* Columns */}
                      {cols.map((col, ci) => {
                        const cy = CARD_HEADER + ci * COL_ROW_HEIGHT + COL_ROW_HEIGHT / 2 + 2;
                        return (
                          <g key={col.name} transform={`translate(0, ${cy})`}>
                            {/* Key icon or dot */}
                            {col.isKey ? (
                              <g transform="translate(12, -4)">
                                <rect x={-3} y={-3} width={8} height={8} rx={2} fill="#F59E0B" opacity={0.2} />
                                <rect x={-1} y={-1} width={4} height={4} rx={1} fill="#F59E0B" />
                              </g>
                            ) : (
                              <circle cx={12} cy={-1} r={2} fill="var(--text-tertiary)" opacity={0.4} />
                            )}
                            {/* Column name */}
                            <text
                              x={24}
                              y={2}
                              fill={col.isKey ? "var(--text-primary)" : "var(--text-secondary)"}
                              fontSize="11px"
                              fontWeight={col.isKey ? "600" : "400"}
                            >
                              {col.name.length > 18 ? col.name.slice(0, 18) + "…" : col.name}
                            </text>
                            {/* Type badge */}
                            <text
                              x={node.width - 10}
                              y={2}
                              textAnchor="end"
                              fill="var(--text-tertiary)"
                              fontSize="9px"
                              fontFamily="monospace"
                            >
                              {col.type}
                            </text>
                          </g>
                        );
                      })}
                    </g>
                  );
                })}
              </g>
            </svg>
          )}

          {/* Zoom controls */}
          {layoutNodes.length > 0 && (
            <div style={{
              position: "absolute", bottom: 16, right: 16,
              display: "flex", flexDirection: "column", gap: 4,
              background: "var(--bg-glass-heavy)", border: "1px solid var(--border-primary)",
              borderRadius: 8, padding: 4, boxShadow: "var(--shadow-md)", zIndex: 10,
            }}>
              <button onClick={() => setZoom((p) => Math.min(2.5, p + 0.2))} className="graph-zoom-btn" title="Zoom In">
                <ZoomIn size={16} />
              </button>
              <button onClick={() => { setZoom(1); setPan({ x: 40, y: 40 }); }} className="graph-zoom-btn" title="Reset">
                <Maximize2 size={14} />
              </button>
              <button onClick={() => setZoom((p) => Math.max(0.3, p - 0.2))} className="graph-zoom-btn" title="Zoom Out">
                <ZoomOut size={16} />
              </button>
              <div style={{ textAlign: "center", fontSize: 9, color: "var(--text-tertiary)", fontWeight: 600, padding: "2px 0" }}>
                {Math.round(zoom * 100)}%
              </div>
            </div>
          )}
        </div>

        {/* Right Side Panel */}
        {selectedNode && (
          <div style={{
            width: 340, borderLeft: "1px solid var(--border-secondary)",
            background: "var(--bg-sidebar)", display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0,
          }}>
            {/* Summary */}
            <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid var(--border-secondary)" }}>
              <span style={{
                fontSize: 10, fontWeight: 700, color: getColor(selectedNode.module),
                background: `${getColor(selectedNode.module)}15`, border: `1px solid ${getColor(selectedNode.module)}30`,
                padding: "2px 8px", borderRadius: "var(--radius-full)", display: "inline-block", marginBottom: 8,
              }}>
                {selectedNode.module}
              </span>
              <h2 className="font-display" style={{ fontSize: 17, fontWeight: 700, color: "var(--text-primary)", margin: "0 0 6px" }}>
                {selectedNode.name}
              </h2>
              <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 10px", lineHeight: 1.5 }}>
                {selectedNode.description}
              </p>
              <div style={{ fontSize: 11, color: "var(--text-tertiary)", display: "flex", flexDirection: "column", gap: 3 }}>
                <div><strong>Entity Set:</strong> <code style={{ background: "var(--bg-tertiary)", padding: "1px 5px", borderRadius: 4, fontSize: 10 }}>{selectedNode.entitySet}</code></div>
                <div><strong>OData URI:</strong> <code style={{ background: "var(--bg-tertiary)", padding: "1px 5px", borderRadius: 4, fontSize: 10 }}>{selectedNode.url}</code></div>
              </div>
            </div>

            {/* Search */}
            <div style={{
              padding: "8px 16px", borderBottom: "1px solid var(--border-secondary)",
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <Search size={14} style={{ color: "var(--text-tertiary)" }} />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter columns..."
                style={{
                  border: "none", background: "transparent", color: "var(--text-primary)",
                  fontSize: 12.5, outline: "none", width: "100%", fontFamily: "inherit",
                }}
              />
            </div>

            {/* Columns list */}
            <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px" }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 6, fontSize: 11,
                fontWeight: 600, color: "var(--text-tertiary)", marginBottom: 8, padding: "0 4px",
              }}>
                <Table size={12} />
                <span>Columns ({filteredColumns.length})</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {filteredColumns.map((col: Column) => (
                  <div
                    key={col.name}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "7px 10px", borderRadius: "var(--radius-sm)",
                      background: col.isKey ? "rgba(59, 130, 246, 0.04)" : "transparent",
                      border: col.isKey ? "1px solid rgba(59, 130, 246, 0.12)" : "1px solid var(--border-secondary)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {col.isKey ? (
                        <Key size={12} style={{ color: "var(--text-accent)", flexShrink: 0 }} />
                      ) : (
                        <div style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--text-tertiary)", opacity: 0.4, flexShrink: 0 }} />
                      )}
                      <span style={{ fontSize: 12.5, fontWeight: col.isKey ? 600 : 450, color: col.isKey ? "var(--text-primary)" : "var(--text-secondary)" }}>
                        {col.name}
                      </span>
                    </div>
                    <span style={{
                      fontSize: 10, color: col.isKey ? "var(--text-accent)" : "var(--text-tertiary)",
                      background: col.isKey ? "rgba(59, 130, 246, 0.08)" : "var(--bg-tertiary)",
                      padding: "2px 6px", borderRadius: 4, fontFamily: "monospace",
                    }}>
                      {col.type}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
