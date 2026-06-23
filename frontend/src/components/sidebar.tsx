"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  Sparkles,
  Plus,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Trash2,
  Sun,
  Moon,
  Check,
  X,
  PanelLeftClose,
  Settings,
  User,
} from "lucide-react";
import { useTheme } from "@/contexts/theme-context";
import { Thread } from "@/lib/types";

interface SidebarProps {
  threads: Thread[];
  activeThreadId: string | null;
  isLoading: boolean;
  isOpen: boolean;
  onNewChat: () => void;
  onSelectThread: (id: string) => void;
  onDeleteThread: (id: string) => void;
  onRenameThread: (id: string, title: string) => void;
  onToggleSidebar: () => void;
  onOpenSettings: () => void;
}

export function Sidebar({
  threads,
  activeThreadId,
  isLoading,
  isOpen,
  onNewChat,
  onSelectThread,
  onDeleteThread,
  onRenameThread,
  onToggleSidebar,
  onOpenSettings,
}: SidebarProps) {
  const { theme, setTheme } = useTheme();
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Focus rename input
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const handleStartRename = (thread: Thread) => {
    setRenamingId(thread.id);
    setRenameValue(thread.title);
    setMenuOpenId(null);
  };

  const handleConfirmRename = () => {
    if (renamingId && renameValue.trim()) {
      onRenameThread(renamingId, renameValue.trim());
    }
    setRenamingId(null);
    setRenameValue("");
  };

  const handleCancelRename = () => {
    setRenamingId(null);
    setRenameValue("");
  };

  const getRelativeTime = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMin = Math.floor(diffMs / 60000);
      const diffHrs = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMin < 1) return "Just now";
      if (diffMin < 60) return `${diffMin}m ago`;
      if (diffHrs < 24) return `${diffHrs}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;
      return date.toLocaleDateString();
    } catch {
      return "";
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <aside className="sidebar">
      {/* Header */}
      <div
        style={{
          padding: "18px 16px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--border-secondary)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: "var(--radius-md)",
              background: "var(--accent-gradient)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "var(--shadow-glow)",
            }}
          >
            <Sparkles size={18} color="#fff" />
          </div>
          <div>
            <div
              className="font-display"
              style={{
                fontSize: "16px",
                fontWeight: 700,
                color: "var(--text-primary)",
                lineHeight: 1.2,
              }}
            >
              Project Nexus
            </div>
            <div
              style={{
                fontSize: "11px",
                color: "var(--text-tertiary)",
                fontWeight: 500,
              }}
            >
              OData Orchestration
            </div>
          </div>
        </div>
        <button
          onClick={onToggleSidebar}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-tertiary)",
            cursor: "pointer",
            padding: 4,
            borderRadius: "var(--radius-sm)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "all var(--transition-fast)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-tertiary)")}
          title="Close sidebar"
        >
          <PanelLeftClose size={18} />
        </button>
      </div>

      {/* New Chat Button */}
      <div style={{ padding: "14px 0 8px" }}>
        <button className="new-chat-btn" onClick={onNewChat}>
          <Plus size={18} />
          <span>New Chat</span>
        </button>
      </div>

      {/* Thread List */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "4px 0",
        }}
      >
        {isLoading ? (
          <div style={{ padding: "20px 16px" }}>
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="animate-shimmer"
                style={{
                  height: 40,
                  borderRadius: "var(--radius-md)",
                  marginBottom: 6,
                }}
              />
            ))}
          </div>
        ) : threads.length === 0 ? (
          <div
            style={{
              padding: "40px 20px",
              textAlign: "center",
              color: "var(--text-tertiary)",
              fontSize: "13px",
            }}
          >
            <MessageSquare
              size={32}
              style={{ margin: "0 auto 12px", opacity: 0.4 }}
            />
            <div>No conversations yet</div>
            <div style={{ fontSize: "12px", marginTop: 4 }}>
              Start a new chat to begin
            </div>
          </div>
        ) : (
          threads.map((thread, index) => (
            <div key={thread.id || index} style={{ position: "relative" }}>
              {renamingId === thread.id ? (
                /* Rename Input */
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "4px 8px",
                    margin: "2px 8px",
                  }}
                >
                  <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleConfirmRename();
                      if (e.key === "Escape") handleCancelRename();
                    }}
                    style={{
                      flex: 1,
                      padding: "7px 10px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--border-accent)",
                      background: "var(--bg-input)",
                      color: "var(--text-primary)",
                      fontSize: "13px",
                      outline: "none",
                      fontFamily: "inherit",
                    }}
                  />
                  <button
                    onClick={handleConfirmRename}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--accent-primary)",
                      cursor: "pointer",
                      padding: 4,
                      display: "flex",
                    }}
                  >
                    <Check size={16} />
                  </button>
                  <button
                    onClick={handleCancelRename}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--text-tertiary)",
                      cursor: "pointer",
                      padding: 4,
                      display: "flex",
                    }}
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : (
                /* Thread Item */
                <div
                  className={`sidebar-thread ${activeThreadId === thread.id ? "active" : ""
                    }`}
                  onClick={() => onSelectThread(thread.id)}
                >
                  <MessageSquare size={15} style={{ flexShrink: 0, opacity: 0.6 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {thread.title || "Untitled"}
                    </div>
                    <div
                      style={{
                        fontSize: "11px",
                        color: "var(--text-tertiary)",
                        marginTop: 1,
                      }}
                    >
                      {getRelativeTime(thread.updated_at || thread.created_at)}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId(menuOpenId === thread.id ? null : thread.id);
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--text-tertiary)",
                      cursor: "pointer",
                      padding: 2,
                      borderRadius: 4,
                      display: "flex",
                      opacity: 0.5,
                      transition: "opacity var(--transition-fast)",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                    onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.5")}
                  >
                    <MoreHorizontal size={15} />
                  </button>
                </div>
              )}

              {/* Context Menu */}
              {menuOpenId === thread.id && (
                <div
                  ref={menuRef}
                  className="dropdown-menu"
                  style={{
                    position: "absolute",
                    right: 12,
                    top: "100%",
                    zIndex: 50,
                  }}
                >
                  <button
                    className="dropdown-item"
                    onClick={() => handleStartRename(thread)}
                  >
                    <Pencil size={14} />
                    <span>Rename</span>
                  </button>
                  <button
                    className="dropdown-item danger"
                    onClick={() => {
                      onDeleteThread(thread.id);
                      setMenuOpenId(null);
                    }}
                  >
                    <Trash2 size={14} />
                    <span>Delete</span>
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Bottom section: Settings + Theme Toggle */}
      <div
        style={{
          padding: "12px 14px",
          borderTop: "1px solid var(--border-secondary)",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        {/* Settings Button */}
        <button
          className="model-selector-btn"
          onClick={onOpenSettings}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            background: "none",
            border: "none",
            padding: "8px 12px",
            cursor: "pointer",
            width: "100%",
            borderRadius: "var(--radius-md)",
            transition: "background var(--transition-fast)"
          }}
        >
          {/* User circle avatar */}
          <div style={{
            width: "32px",
            height: "32px",
            borderRadius: "50%",
            background: "rgba(255, 255, 255, 0.1)",
            border: "1px solid var(--border-secondary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-secondary)",
            flexShrink: 0
          }}>
            <User size={16} />
          </div>
          
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.2 }}>Profile</span>
            <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>Settings</span>
          </div>

          <Settings size={16} style={{ color: "var(--accent-primary)" }} />
        </button>

        {/* Theme Picker */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            marginTop: "4px",
          }}
        >
          <span
            style={{
              fontSize: "11px",
              color: "var(--text-tertiary)",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Nexus Theme
          </span>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: "6px",
            }}
          >
            {(
              [
                { id: "crimson-sidebar-light", color: "#b91c1c", label: "Crimson Sidebar Light" },
                { id: "clean-crimson-light", color: "#ffffff", label: "Clean Crimson Light" },
                { id: "soft-crimson-glass", color: "#ff8a8a", label: "Soft Crimson Glass" },
                { id: "midnight-crimson", color: "#8b1a1a", label: "Midnight Crimson" },
              ] as const
            ).map((item) => {
              const isActive = theme === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setTheme(item.id)}
                  title={item.label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "32px",
                    borderRadius: "6px",
                    background: isActive ? "var(--bg-active)" : "var(--bg-glass)",
                    border: isActive
                      ? "1px solid var(--border-accent)"
                      : "1px solid var(--border-secondary)",
                    cursor: "pointer",
                    transition: "all var(--transition-fast)",
                  }}
                  className="theme-picker-btn"
                >
                  <span
                    style={{
                      width: "12px",
                      height: "12px",
                      borderRadius: "50%",
                      backgroundColor: item.color,
                      border: item.id === "clean-crimson-light" ? "1.5px solid #b91c1c" : "none",
                      boxShadow: isActive ? `0 0 8px ${item.color === "#ffffff" ? "#b91c1c" : item.color}` : "none",
                      transition: "all var(--transition-fast)",
                    }}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}
