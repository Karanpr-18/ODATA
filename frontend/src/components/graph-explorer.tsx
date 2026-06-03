"use client";

import React, { useState, useEffect } from "react";
import {
  Database,
  Network,
  Info,
  Table,
  Key,
  Search,
  Share2,
  Loader2,
} from "lucide-react";
import { fetchSchemaGraph } from "@/lib/api";

interface Column {
  name: string;
  type: string;
  isKey?: boolean;
}

interface Node {
  id: string;
  name: string;
  entitySet: string;
  module: string;
  description: string;
  url: string;
  columns: Column[];
  x: number;
  y: number;
  icon?: string;
}

interface Edge {
  from: string;
  to: string;
  label: string;
  isBridge?: boolean;
}

interface VisualNode {
  id: string;
  parentId?: string;
  name: string;
  type: "table" | "column";
  dataType?: string;
  isKey?: boolean;
  x: number;
  y: number;
  color: string;
}

interface VisualEdge {
  from: string;
  to: string;
  type: "parent-to-column" | "relationship";
  label?: string;
}


// Fallbacks removed per user request for dynamic data

export function GraphExplorer() {
  const [dbData, setDbData] = useState<{ nodes: any[]; edges: any[] }>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  const handleNodeClick = (node: VisualNode) => {
    if (node.type === "table") {
      setSelectedNodeId(node.id);
    } else if (node.parentId) {
      setSelectedNodeId(node.parentId);
    }
  };


  useEffect(() => {
    async function loadData() {
      setLoading(true);
      const data = await fetchSchemaGraph();
      if (data && data.nodes && data.nodes.length > 0) {
        setDbData(data);
        // Default select first node
        setSelectedNodeId(data.nodes[0].id);
      }
      setLoading(false);
    }
    loadData();
  }, []);

  // ── DYNAMIC HIERARCHICAL PLANET LAYOUT CALCULATOR ──
  // Layout engine that organizes tables into dynamic horizontal topological columns/layers
  const layoutNodes = (nodes: any[], edges: any[]): Node[] => {
    if (nodes.length === 0) return [];
    
    // 1. Build adjacency list and in-degree map
    const inDegree: Record<string, number> = {};
    const adj: Record<string, string[]> = {};
    
    nodes.forEach((n) => {
      inDegree[n.id] = 0;
      adj[n.id] = [];
    });
    
    edges.forEach((e) => {
      if (adj[e.from] && inDegree[e.to] !== undefined) {
        adj[e.from].push(e.to);
        inDegree[e.to]++;
      }
    });
    
    // 2. Compute layers using BFS
    const queue: string[] = [];
    const layers: Record<string, number> = {};
    
    nodes.forEach((n) => {
      if (inDegree[n.id] === 0) {
        queue.push(n.id);
        layers[n.id] = 0;
      }
    });
    
    if (queue.length === 0 && nodes.length > 0) {
      queue.push(nodes[0].id);
      layers[nodes[0].id] = 0;
    }
    
    let head = 0;
    while (head < queue.length) {
      const u = queue[head++];
      const currentLayer = layers[u] || 0;
      
      adj[u].forEach((v) => {
        const nextLayer = currentLayer + 1;
        if (layers[v] === undefined || layers[v] < nextLayer) {
          layers[v] = nextLayer;
          if (!queue.includes(v)) {
            queue.push(v);
          }
        }
      });
    }
    
    nodes.forEach((n) => {
      if (layers[n.id] === undefined) {
        layers[n.id] = 0;
      }
    });
    
    // 3. Group nodes by layer
    const layerGroups: Record<number, any[]> = {};
    nodes.forEach((n) => {
      const l = layers[n.id];
      if (!layerGroups[l]) layerGroups[l] = [];
      layerGroups[l].push(n);
    });
    
    // 4. Position nodes symmetrically
    const laidOut: Node[] = [];
    const colSpacing = 320;
    const rowSpacing = 240;
    const canvasHeight = 580;
    const startX = 180;
    
    Object.keys(layerGroups).forEach((lStr) => {
      const l = parseInt(lStr);
      const group = layerGroups[l];
      const colX = startX + l * colSpacing;
      
      const groupHeight = (group.length - 1) * rowSpacing;
      const colStartY = (canvasHeight - groupHeight) / 2;
      
      group.forEach((node, idx) => {
        const rowY = colStartY + idx * rowSpacing;
        
        laidOut.push({
          id: node.id,
          name: node.name,
          entitySet: node.entitySet || "N/A",
          module: node.module || "General",
          description: node.description || "No description provided.",
          url: node.url || "",
          columns: node.columns || [],
          x: colX,
          y: rowY,
        });
      });
    });
    
    return laidOut;
  };

  // Finds matching columns between two nodes to draw column-level connections
  const getColumnConnection = (fromNode: any, toNode: any) => {
    // Look for columns with the same name
    for (const col1 of fromNode.columns || []) {
      for (const col2 of toNode.columns || []) {
        if (col1.name.toLowerCase() === col2.name.toLowerCase()) {
          return { fromCol: col1.name, toCol: col2.name };
        }
      }
    }
    // Fallback: if fromNode has a column matching toNode's key
    const toKey = (toNode.columns || []).find((c: any) => c.isKey)?.name;
    if (toKey) {
      const matchingFromCol = (fromNode.columns || []).find((c: any) => 
        c.name.toLowerCase().includes(toKey.toLowerCase()) || 
        toKey.toLowerCase().includes(c.name.toLowerCase())
      );
      if (matchingFromCol) {
        return { fromCol: matchingFromCol.name, toCol: toKey };
      }
    }
    return null; // Fallback to table-to-table connection
  };

  const palette = ["#10B981", "#EF4444", "#F59E0B", "#8B5CF6", "#3B82F6", "#EC4899", "#14B8A6", "#F43F5E", "#84CC16"];
  const modules = Array.from(new Set(dbData.nodes.map((n) => n.module || "General")));
  const moduleColorMap = Object.fromEntries(
    modules.map((mod, i) => [mod as string, palette[i % palette.length]])
  );

  const getModuleColorLocal = (module: string) => {
    return moduleColorMap[module || "General"] || "rgba(255,255,255,0.4)";
  };

  const generateVisualGraph = (dbNodes: any[], dbEdges: any[]): { nodes: VisualNode[], edges: VisualEdge[] } => {
    const visualNodes: VisualNode[] = [];
    const visualEdges: VisualEdge[] = [];
    
    // 1. First, layout the Table Nodes using our Layered layout spacing
    const tableNodes = layoutNodes(dbNodes, dbEdges);
    
    // 2. Add all Table Nodes to visualNodes
    tableNodes.forEach(table => {
      const nodeColor = getModuleColorLocal(table.module);
      visualNodes.push({
        id: table.id,
        name: table.name.replace("Northwind ", ""),
        type: "table",
        x: table.x,
        y: table.y,
        color: nodeColor
      });
      
      // 3. Add all Column Nodes orbiting their parent table
      const cols = table.columns || [];
      const numCols = cols.length;
      const radius = 95;
      
      cols.forEach((col, idx) => {
        // Space them evenly in a circle
        const angle = (idx / numCols) * 2 * Math.PI;
        const x = table.x + radius * Math.cos(angle);
        const y = table.y + radius * Math.sin(angle);
        const colId = `${table.id}.${col.name}`;
        
        visualNodes.push({
          id: colId,
          parentId: table.id,
          name: col.name,
          type: "column",
          dataType: col.type,
          isKey: !!col.isKey,
          x,
          y,
          color: col.isKey ? "#F59E0B" : "rgba(255,255,255,0.7)"
        });
        
        // Add structural link between Table and Column
        visualEdges.push({
          from: table.id,
          to: colId,
          type: "parent-to-column"
        });
      });
    });
    
    // 4. Add relationship edges
    dbEdges.forEach(edge => {
      const fromTable = tableNodes.find(n => n.id === edge.from);
      const toTable = tableNodes.find(n => n.id === edge.to);
      if (!fromTable || !toTable) return;
      
      // Find column-level connection if any
      const colConn = getColumnConnection(fromTable, toTable);
      if (colConn) {
        const fromColId = `${fromTable.id}.${colConn.fromCol}`;
        const toColId = `${toTable.id}.${colConn.toCol}`;
        visualEdges.push({
          from: fromColId,
          to: toColId,
          type: "relationship",
          label: edge.label
        });
      } else {
        // Fallback to table-to-table connection
        visualEdges.push({
          from: fromTable.id,
          to: toTable.id,
          type: "relationship",
          label: edge.label
        });
      }
    });
    
    return { nodes: visualNodes, edges: visualEdges };
  };

  const getBezierPath = (startX: number, startY: number, endX: number, endY: number) => {
    const dx = Math.abs(endX - startX);
    const controlOffset = Math.min(120, dx / 2 + 10);
    
    // Smooth horizontal flowing curve
    const cp1x = startX + (endX > startX ? controlOffset : -controlOffset);
    const cp1y = startY;
    const cp2x = endX + (endX > startX ? -controlOffset : controlOffset);
    const cp2y = endY;
    
    return `M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}`;
  };

  if (loading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "var(--bg-chat)" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <Loader2 size={32} style={{ animation: "spin 1.2s linear infinite", color: "var(--text-accent)" }} />
          <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-secondary)" }}>Querying SurrealDB Schema Graph...</span>
        </div>
      </div>
    );
  }

  const { nodes: visualNodes, edges: visualEdges } = generateVisualGraph(dbData.nodes, dbData.edges);

  const selectedNode = dbData.nodes.find((n) => n.id === selectedNodeId) || dbData.nodes[0];
  const filteredColumns = selectedNode ? selectedNode.columns.filter((c: any) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  ) : [];

  // Identify connected edges and nodes to highlight neighborhood
  const getNeighborhood = (nodeId: string | null) => {
    if (!nodeId) return { edges: [], nodes: [] };
    
    // Find all edges directly connected to this node
    let connectedEdges = visualEdges.filter(
      (e) => e.from === nodeId || e.to === nodeId
    );
    
    // If it's a table node, also include all relationships connected to its column moons!
    if (!nodeId.includes(".")) {
      const colEdges = visualEdges.filter(e => 
        e.type === "relationship" && 
        (e.from.startsWith(nodeId + ".") || e.to.startsWith(nodeId + "."))
      );
      connectedEdges = [...connectedEdges, ...colEdges];
    }
    
    const connectedNodes = connectedEdges.flatMap((e) => [e.from, e.to]);
    return { edges: connectedEdges, nodes: Array.from(new Set(connectedNodes)) };
  };

  const activeNodeId = hoveredNodeId || selectedNodeId;
  const neighborhood = getNeighborhood(activeNodeId);

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "var(--bg-chat)",
        transition: "background var(--transition-base)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Top Header */}
      <div
        style={{
          padding: "16px 24px",
          borderBottom: "1px solid var(--border-secondary)",
          background: "var(--bg-glass)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Network size={20} style={{ color: "var(--text-accent)" }} />
          <span
            className="font-display"
            style={{
              fontSize: "15px",
              fontWeight: 650,
              color: "var(--text-primary)",
            }}
          >
            SurrealDB Dynamic Schema & Relationship Graph
          </span>
        </div>

        {/* Legend */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: "11px",
            fontWeight: 600,
            background: "rgba(255,255,255,0.01)",
            padding: "4px 12px",
            borderRadius: "var(--radius-full)",
            border: "1px solid var(--border-secondary)",
          }}
        >
          {(modules as string[]).map(mod => (
            <div key={mod} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: moduleColorMap[mod] }} />
              <span style={{ color: "var(--text-secondary)" }}>{mod}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Main Splits */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        
        {/* Left Canvas - Dynamic Clustered SVG Map */}
        <div
          style={{
            flex: 1,
            position: "relative",
            background: "radial-gradient(circle, var(--bg-chat) 30%, rgba(0,0,0,0.2) 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-start",
            overflow: "auto",
            padding: 40,
          }}
        >
          {visualNodes.length === 0 ? (
            <div style={{ color: "var(--text-tertiary)", fontSize: "14px" }}>No active graph metadata found in SurrealDB.</div>
          ) : (
            <svg
              width={1000 * zoom}
              height={580 * zoom}
              style={{
                overflow: "visible",
                flexShrink: 0,
                transition: "width 0.2s ease-out, height 0.2s ease-out",
              }}
            >
              <g 
                transform={`scale(${zoom})`} 
                style={{ 
                  transformOrigin: "top left", 
                  transition: "transform 0.2s ease-out" 
                }}
              >
                {/* Arrow Marker Definitions */}
                <defs>
                  <marker
                    id="arrow-std"
                    viewBox="0 0 10 10"
                    refX="6"
                    refY="5"
                    markerWidth="5"
                    markerHeight="5"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(255,255,255,0.25)" />
                  </marker>
                  <marker
                    id="arrow-hl"
                    viewBox="0 0 10 10"
                    refX="6"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-accent)" />
                  </marker>
                </defs>

                {/* Render Network Edges */}
                {visualEdges.map((edge, idx) => {
                  const fromNode = visualNodes.find((n) => n.id === edge.from);
                  const toNode = visualNodes.find((n) => n.id === edge.to);
                  if (!fromNode || !toNode) return null;

                  const isHighlighted =
                    neighborhood.edges.some((e) => e.from === edge.from && e.to === edge.to) ||
                    (selectedNodeId === edge.from || selectedNodeId === edge.to || 
                     (fromNode.parentId === selectedNodeId && edge.type === "parent-to-column") ||
                     (toNode.parentId === selectedNodeId && edge.type === "parent-to-column"));

                  const isParentLink = edge.type === "parent-to-column";

                  let edgeColor = "rgba(255,255,255,0.06)";
                  if (isHighlighted) {
                    edgeColor = isParentLink ? "rgba(255,255,255,0.18)" : "var(--text-accent)";
                  } else if (isParentLink) {
                    edgeColor = "rgba(255,255,255,0.04)";
                  }

                  const pathData = getBezierPath(fromNode.x, fromNode.y, toNode.x, toNode.y);

                  return (
                    <g key={`edge-${idx}`}>
                      {/* Glowing wide edge line */}
                      {!isParentLink && (
                        <path
                          d={pathData}
                          fill="none"
                          stroke="var(--text-accent)"
                          strokeWidth={isHighlighted ? 3 : 0}
                          opacity="0.14"
                          style={{ transition: "all var(--transition-fast)" }}
                        />
                      )}
                      {/* Core connector line */}
                      <path
                        d={pathData}
                        fill="none"
                        stroke={edgeColor}
                        strokeWidth={isHighlighted ? 1.5 : isParentLink ? 1 : 1.2}
                        markerEnd={isParentLink ? "none" : isHighlighted ? "url(#arrow-hl)" : "url(#arrow-std)"}
                        strokeDasharray={isParentLink ? "3,3" : "none"}
                        style={{ transition: "all var(--transition-fast)" }}
                      />
                      
                      {/* Floating relation label */}
                      {!isParentLink && isHighlighted && edge.label && (
                        <g>
                          <rect
                            x={(fromNode.x + toNode.x) / 2 - 38}
                            y={(fromNode.y + toNode.y) / 2 - 8}
                            width="76"
                            height="14"
                            rx="4"
                            fill="var(--bg-chat)"
                            stroke="var(--border-accent)"
                            strokeWidth="0.8"
                          />
                          <text
                            x={(fromNode.x + toNode.x) / 2}
                            y={(fromNode.y + toNode.y) / 2 + 2}
                            textAnchor="middle"
                            fill="var(--text-accent)"
                            fontSize="7px"
                            fontWeight="650"
                          >
                            {edge.label}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}

                {/* Render Network Nodes (Table Planets and Column Moons) */}
                {visualNodes.map((node) => {
                  const isTable = node.type === "table";
                  const isSelected = selectedNodeId === node.id || (node.parentId === selectedNodeId);
                  const isHovered = hoveredNodeId === node.id || (node.parentId === hoveredNodeId);
                  const isNeighbor = neighborhood.nodes.includes(node.id);
                  
                  const isDirectActive = selectedNodeId === node.id || hoveredNodeId === node.id;
                  
                  const radius = isTable 
                    ? (isDirectActive ? 22 : 18) 
                    : (isDirectActive ? 8 : node.isKey ? 6 : 5.5);

                  const nodeColor = node.color;

                  // For column text labels, calculate offsets relative to parent table center
                  let textAnchor: "start" | "middle" | "end" = "start";
                  let dx = 10;
                  let dy = 3.5;
                  if (!isTable && node.parentId) {
                    const parentNode = visualNodes.find((n) => n.id === node.parentId);
                    const parentX = parentNode ? parentNode.x : node.x;
                    const parentY = parentNode ? parentNode.y : node.y;

                    if (node.x > parentX + 5) {
                      textAnchor = "start";
                      dx = 10;
                    } else if (node.x < parentX - 5) {
                      textAnchor = "end";
                      dx = -10;
                    } else {
                      textAnchor = "middle";
                      dx = 0;
                      dy = node.y > parentY ? 14 : -10;
                    }
                  }

                  return (
                    <g
                      key={node.id}
                      transform={`translate(${node.x}, ${node.y})`}
                      onClick={() => handleNodeClick(node)}
                      onMouseEnter={() => setHoveredNodeId(node.id)}
                      onMouseLeave={() => setHoveredNodeId(null)}
                      style={{ cursor: "pointer" }}
                    >
                      {/* Glowing ring under tables / active nodes */}
                      {(isTable || isDirectActive) && (
                        <circle
                          r={radius + (isTable ? 6 : 3)}
                          fill="none"
                          stroke={nodeColor}
                          strokeWidth={isDirectActive ? 2.5 : 1}
                          opacity={isDirectActive ? 0.35 : 0.15}
                          style={{ transition: "all var(--transition-fast)" }}
                        />
                      )}

                      {/* Core node dot */}
                      <circle
                        r={radius}
                        fill={isTable ? "rgba(15, 23, 42, 0.95)" : nodeColor}
                        stroke={isTable ? nodeColor : "var(--bg-chat)"}
                        strokeWidth={isTable ? 2.5 : 1.5}
                        style={{
                          transition: "all var(--transition-fast)",
                          filter: isDirectActive ? `drop-shadow(0 0 6px ${nodeColor})` : "none",
                        }}
                      />

                      {/* Table Name Label directly in the graph canvas */}
                      {isTable && (
                        <g transform="translate(0, -28)">
                          <rect
                            x="-60"
                            y="-11"
                            width="120"
                            height="18"
                            rx="4"
                            fill="var(--bg-glass-heavy, rgba(15, 23, 42, 0.9))"
                            stroke={isDirectActive ? "var(--border-accent)" : "rgba(255,255,255,0.08)"}
                            strokeWidth="1"
                          />
                          <text
                            textAnchor="middle"
                            y="1"
                            fill="#ffffff"
                            fontSize="9.5px"
                            fontWeight="750"
                            className="font-display"
                          >
                            {node.name}
                          </text>
                        </g>
                      )}

                      {/* Column Field Name & Data Type label in Graph */}
                      {!isTable && (
                        <text
                          dx={dx}
                          dy={dy}
                          textAnchor={textAnchor}
                          fill={isDirectActive ? "#ffffff" : isNeighbor ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.4)"}
                          fontSize={isDirectActive ? "9.5px" : "8.5px"}
                          fontWeight={isDirectActive ? "700" : "500"}
                          style={{
                            transition: "all var(--transition-fast)",
                            userSelect: "none",
                            pointerEvents: "none",
                          }}
                        >
                          {node.name}
                          {isDirectActive && (
                            <tspan fill="rgba(255,255,255,0.4)" fontSize="8px" fontWeight="400">
                              {" "}({node.dataType})
                            </tspan>
                          )}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>
          )}

          {/* Floating Zoom Widget */}
          {visualNodes.length > 0 && (
            <div
              style={{
                position: "absolute",
                bottom: 20,
                right: 20,
                display: "flex",
                flexDirection: "column",
                gap: 6,
                background: "var(--bg-glass-heavy, rgba(15, 23, 42, 0.85))",
                border: "1px solid var(--border-secondary, rgba(255, 255, 255, 0.08))",
                borderRadius: "8px",
                padding: "4px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                zIndex: 10,
              }}
            >
              <button
                onClick={() => setZoom(prev => Math.min(2, prev + 0.15))}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "6px",
                  background: "rgba(255,255,255,0.03)",
                  border: "none",
                  color: "#ffffff",
                  fontSize: "16px",
                  fontWeight: "bold",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "background var(--transition-fast)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
                title="Zoom In"
              >
                +
              </button>
              <button
                onClick={() => setZoom(1)}
                style={{
                  width: 32,
                  height: 20,
                  borderRadius: "4px",
                  background: "transparent",
                  border: "none",
                  color: "var(--text-tertiary)",
                  fontSize: "9px",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                title="Reset Zoom"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                onClick={() => setZoom(prev => Math.max(0.5, prev - 0.15))}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "6px",
                  background: "rgba(255,255,255,0.03)",
                  border: "none",
                  color: "#ffffff",
                  fontSize: "16px",
                  fontWeight: "bold",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "background var(--transition-fast)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
                title="Zoom Out"
              >
                −
              </button>
            </div>
          )}

          {/* Quick Info Box */}
          <div
            style={{
              position: "absolute",
              bottom: 16,
              left: 20,
              borderRadius: "var(--radius-md)",
              padding: "10px 14px",
              background: "var(--bg-glass-subtle, rgba(255, 255, 255, 0.02))",
              border: "1px solid var(--border-secondary)",
              maxWidth: 260,
              fontSize: "11px",
              color: "var(--text-tertiary)",
              lineHeight: 1.4,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
              <Share2 size={12} style={{ color: "var(--text-accent)" }} />
              <span>SurrealDB Dynamic Schema Map</span>
            </div>
            Direct, real-time database schema graph visualization. Every table and expands/belongs_to link is retrieved dynamically from the active SurrealDB instance.
          </div>
        </div>

        {/* Right Side Panel - Columns, metadata, and detail keys */}
        {selectedNode && (
          <div
            style={{
              width: 380,
              borderLeft: "1px solid var(--border-secondary)",
              background: "var(--bg-sidebar, rgba(0, 0, 0, 0.05))",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Summary Drawer */}
            <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border-secondary)" }}>
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 650,
                  color: getModuleColorLocal(selectedNode.module),
                  background: `${getModuleColorLocal(selectedNode.module)}12`,
                  border: `1px solid ${getModuleColorLocal(selectedNode.module)}30`,
                  padding: "2px 8px",
                  borderRadius: "var(--radius-full)",
                  display: "inline-block",
                  marginBottom: 8,
                }}
              >
                {selectedNode.module} Domain
              </span>
              <h2
                className="font-display"
                style={{
                  fontSize: "18px",
                  fontWeight: 700,
                  color: "var(--text-primary)",
                  margin: "0 0 6px 0",
                }}
              >
                {selectedNode.name}
              </h2>
              <p
                style={{
                  fontSize: "12px",
                  color: "var(--text-secondary)",
                  margin: "0 0 12px 0",
                  lineHeight: 1.4,
                }}
              >
                {selectedNode.description}
              </p>

              <div
                style={{
                  fontSize: "11px",
                  color: "var(--text-tertiary)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <div>
                  <strong>Entity Set Name:</strong> <code>{selectedNode.entitySet}</code>
                </div>
                <div>
                  <strong>Relative OData URI:</strong> <code>{selectedNode.url}</code>
                </div>
              </div>
            </div>

            {/* Column search filter */}
            <div
              style={{
                padding: "10px 16px",
                background: "rgba(255, 255, 255, 0.01)",
                borderBottom: "1px solid var(--border-secondary)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Search size={14} style={{ color: "var(--text-tertiary)" }} />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter columns..."
                style={{
                  border: "none",
                  background: "transparent",
                  color: "var(--text-primary)",
                  fontSize: "12.5px",
                  outline: "none",
                  width: "100%",
                  fontFamily: "inherit",
              }}
            />
          </div>

          {/* Columns & Field list */}
          <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: "11px",
                fontWeight: 600,
                color: "var(--text-tertiary)",
                marginBottom: 10,
                padding: "0 6px",
              }}
            >
              <Table size={12} />
              <span>Columns & Data Types ({filteredColumns.length})</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {filteredColumns.map((col: any) => (
                <div
                  key={col.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 12px",
                    borderRadius: "var(--radius-sm)",
                    background: col.isKey ? "rgba(59, 130, 246, 0.03)" : "rgba(255, 255, 255, 0.01)",
                    border: col.isKey
                      ? "1px solid rgba(59, 130, 246, 0.15)"
                      : "1px solid var(--border-secondary)",
                    transition: "all var(--transition-fast)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    {col.isKey ? (
                      <Key size={13} style={{ color: "var(--text-accent)", flexShrink: 0 }} />
                    ) : (
                      <div
                        style={{
                          width: 4,
                          height: 4,
                          borderRadius: "50%",
                          background: "var(--text-tertiary)",
                          opacity: 0.5,
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <span
                      style={{
                        fontSize: "13px",
                        fontWeight: col.isKey ? 600 : 500,
                        color: col.isKey ? "var(--text-primary)" : "var(--text-secondary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {col.name}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: "10.5px",
                      color: col.isKey ? "var(--text-accent)" : "var(--text-tertiary)",
                      background: col.isKey ? "rgba(59, 130, 246, 0.08)" : "var(--bg-tertiary)",
                      padding: "2px 6px",
                      borderRadius: "4px",
                      fontFamily: "monospace",
                    }}
                  >
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
