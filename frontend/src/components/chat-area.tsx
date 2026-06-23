"use client";

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  KeyboardEvent,
} from "react";
import {
  Send,
  PanelLeftOpen,
  Bot,
  User,
  Database,
  BarChart3,
  Table2,
  Zap,
  AlertCircle,
  Copy,
  Check,
  Loader2,
  MessageSquare,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { sendChatMessage, createThread } from "@/lib/api";
import { Message, Thread } from "@/lib/types";
import { ChartWidget } from "@/components/tool-ui/chart-widget";
import { TableWidget } from "@/components/tool-ui/table-widget";

interface PipelineLogsProps {
  status: string;
  isStreaming: boolean;
}

function PipelineLogs({ status, isStreaming }: PipelineLogsProps) {
  const [isOpen, setIsOpen] = useState(isStreaming);

  useEffect(() => {
    if (isStreaming) {
      setIsOpen(true);
    }
  }, [status, isStreaming]);

  return (
    <div style={{
      marginBottom: 12,
      width: "100%",
    }}>
      <div style={{
        borderRadius: "var(--radius-md)",
        background: "var(--bg-glass-subtle, rgba(255, 255, 255, 0.03))",
        border: "1px solid var(--border-secondary, rgba(255, 255, 255, 0.08))",
        overflow: "hidden",
        boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
        transition: "all var(--transition-base)",
      }}>
        {/* Toggle Header */}
        <div 
          onClick={() => setIsOpen(!isOpen)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            background: "rgba(255, 255, 255, 0.01)",
            cursor: "pointer",
            userSelect: "none",
            fontSize: "12px",
            fontWeight: 600,
            color: "var(--text-secondary)",
            borderBottom: isOpen ? "1px solid var(--border-secondary)" : "none",
          }}
        >
          {isStreaming ? (
            <Loader2 size={12} style={{ animation: "spin 1.2s linear infinite", color: "var(--accent-primary)" }} />
          ) : (
            <Database size={12} style={{ color: "var(--text-tertiary)" }} />
          )}
          <span className="font-display" style={{ flex: 1, color: "var(--text-primary)" }}>Execution Pipeline Logs</span>
          <span style={{ 
            fontSize: "10px", 
            color: "var(--text-accent)", 
            opacity: 0.8,
            background: "rgba(255, 255, 255, 0.05)",
            padding: "2px 6px",
            borderRadius: "4px",
          }}>
            {isOpen ? "Minimize" : "Expand"}
          </span>
        </div>

        {/* Content Body */}
        {isOpen && (
          <div className="markdown-status" style={{ 
            padding: "10px 14px",
            fontSize: "11px",
            lineHeight: 1.5,
            color: "var(--text-secondary)",
            opacity: 0.9,
            maxHeight: "200px",
            overflowY: "auto",
          }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {status}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

interface ChatAreaProps {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  activeThreadId: string | null;
  selectedModel: string;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onThreadCreated: (thread: Thread) => void;
  onUpdateThreadTitle: (threadId: string, title: string) => void;
}

export function ChatArea({
  messages,
  setMessages,
  activeThreadId,
  selectedModel,
  sidebarOpen,
  onToggleSidebar,
  onThreadCreated,
  onUpdateThreadTitle,
}: ChatAreaProps) {
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const threadIdRef = useRef<string | null>(activeThreadId);

  useEffect(() => {
    threadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 160) + "px";
    }
  }, [input]);

  const handleCopy = useCallback((text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    // Create thread if none active
    let currentThreadId = threadIdRef.current;
    if (!currentThreadId) {
      const title = trimmed.slice(0, 60) + (trimmed.length > 60 ? "..." : "");
      const thread = await createThread(title);
      if (thread) {
        currentThreadId = thread.id;
        threadIdRef.current = thread.id;
        onThreadCreated(thread);
      }
    }

    const userMessage: Message = {
      role: "user",
      content: trimmed,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsStreaming(true);

    // Build messages for API
    const apiMessages = [
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: trimmed },
    ];

    // Add placeholder for assistant
    const assistantMessage: Message = {
      role: "assistant",
      content: "",
      status: "🧠 Converting query to semantic vector...",
    };
    setMessages((prev) => [...prev, assistantMessage]);

    const abortController = new AbortController();
    abortRef.current = abortController;

    let accumulatedContent = "";

    await sendChatMessage(
      apiMessages,
      selectedModel,
      currentThreadId,
      {
        onToken: (token) => {
          accumulatedContent += token;
          setMessages((prev) => {
            const updated = [...prev];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg && lastMsg.role === "assistant") {
              updated[updated.length - 1] = {
                ...lastMsg,
                content: accumulatedContent,
              };
            }
            return updated;
          });
        },
        onStatus: (statusText) => {
          setMessages((prev) => {
            const updated = [...prev];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg && lastMsg.role === "assistant") {
              updated[updated.length - 1] = {
                ...lastMsg,
                status: statusText,
              };
            }
            return updated;
          });
        },
        onDone: () => {
          setIsStreaming(false);
          abortRef.current = null;
          // Auto-update thread title from first user message
          if (currentThreadId && messages.length === 0) {
            const autoTitle =
              trimmed.slice(0, 50) + (trimmed.length > 50 ? "..." : "");
            onUpdateThreadTitle(currentThreadId, autoTitle);
          }
        },
        onError: (error) => {
          setIsStreaming(false);
          abortRef.current = null;
          setMessages((prev) => {
            const updated = [...prev];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg && lastMsg.role === "assistant") {
              updated[updated.length - 1] = {
                ...lastMsg,
                content: `⚠️ Error: ${error}\n\nPlease check that the backend server is running at http://localhost:8080`,
                status: lastMsg.status, // Preserve status logs in error states
              };
            }
            return updated;
          });
        },
      },
      abortController.signal
    );
  }, [input, isStreaming, messages, selectedModel, onThreadCreated, onUpdateThreadTitle, setMessages]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleStopStreaming = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsStreaming(false);
  };

  // Try to detect and render tool results (charts/tables) from assistant messages
  const renderMessageContent = (msg: Message, idx: number) => {
    if (msg.role === "user") {
      return <span>{msg.content}</span>;
    }

    // Check for embedded JSON tool results
    const content = msg.content;
    const toolResults = extractToolResults(content);

    return (
      <div>
        {/* Render status logs if present */}
        {msg.status && (
          <PipelineLogs status={msg.status} isStreaming={idx === messages.length - 1 && isStreaming} />
        )}

        {/* Copy button */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginBottom: 6,
          }}
        >
          <button
            onClick={() => handleCopy(msg.content, idx)}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-tertiary)",
              cursor: "pointer",
              padding: 2,
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: "11px",
              opacity: 0.6,
              transition: "opacity var(--transition-fast)",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.6")}
          >
            {copiedIdx === idx ? (
              <>
                <Check size={12} /> Copied
              </>
            ) : (
              <>
                <Copy size={12} /> Copy
              </>
            )}
          </button>
        </div>

        {/* Markdown content */}
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            table: ({ children, ...props }) => (
              <div style={{ 
                overflowX: "auto", 
                width: "100%", 
                margin: "16px 0", 
                borderRadius: "var(--radius-md)", 
                border: "1px solid var(--border-secondary)",
                background: "var(--bg-glass-subtle, rgba(255, 255, 255, 0.02))",
              }}>
                <table style={{ minWidth: "max-content", width: "100%", borderCollapse: "collapse" }} {...props}>
                  {children}
                </table>
              </div>
            )
          }}
        >
          {toolResults.cleanContent}
        </ReactMarkdown>

        {/* Render tool widgets */}
        {toolResults.charts.map((chart, i) => (
          <ChartWidget key={`chart-${i}`} data={chart} />
        ))}
        {toolResults.tables.map((table, i) => (
          <TableWidget key={`table-${i}`} data={table} />
        ))}
      </div>
    );
  };

  // Suggestion chips for welcome screen
  const suggestions = [
    { icon: <BarChart3 size={22} className="welcome-chip-icon" />, text: "Analyze Financial Data" },
    { icon: <Zap size={22} className="welcome-chip-icon" />, text: "Generate Python Code" },
    { icon: <Table2 size={22} className="welcome-chip-icon" />, text: "Draft Quarterly Report" },
    { icon: <MessageSquare size={22} className="welcome-chip-icon" />, text: "Translate Document" },
  ];

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
      }}
    >
      {/* Top bar */}
      <div
        style={{
          padding: "16px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--border-secondary)",
          background: "var(--bg-glass)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {!sidebarOpen && (
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
                transition: "color var(--transition-fast)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-tertiary)")}
            >
              <PanelLeftOpen size={18} />
            </button>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Bot size={18} style={{ color: "var(--text-accent)" }} />
            <span
              className="font-display"
              style={{
                fontSize: "14px",
                fontWeight: 600,
                color: "var(--text-primary)",
              }}
            >
              Project Nexus
            </span>
          </div>
        </div>

        {isStreaming && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "var(--accent-primary)",
                animation: "pulseGlow 1.5s ease-in-out infinite",
              }}
            />
            <span
              style={{
                fontSize: "12px",
                color: "var(--text-tertiary)",
                fontWeight: 500,
              }}
            >
              Generating...
            </span>
          </div>
        )}
      </div>

      {/* Messages area */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "20px 0",
        }}
      >
        {messages.length === 0 ? (
          /* Welcome Screen */
          <div className="welcome-container">
            <h1 className="welcome-title">
              Welcome to <span className="text-gradient">Project Nexus</span>
            </h1>
            <p className="welcome-subtitle">
              Unlock advanced intelligence. Start your professional AI conversation.
            </p>
            <div className="welcome-chips">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  className="welcome-chip"
                  onClick={() => {
                    setInput(s.text);
                    textareaRef.current?.focus();
                  }}
                  style={{ animationDelay: `${i * 0.08}s` }}
                >
                  {s.icon}
                  <span>{s.text}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Message list */
          <div
            style={{
              maxWidth: 1600,
              margin: "0 auto",
              padding: "0 24px",
              width: "100%",
            }}
          >
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`message-container ${
                  msg.role === "user" ? "message-user" : "message-assistant"
                }`}
              >
                {msg.role === "assistant" && (
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "var(--radius-md)",
                      background: "var(--accent-gradient-subtle)",
                      border: "1px solid var(--border-accent)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      marginTop: 2,
                    }}
                  >
                    <Bot size={16} style={{ color: "var(--accent-primary)" }} />
                  </div>
                )}
                <div
                  className={
                    msg.role === "user" ? "bubble-user" : "bubble-assistant"
                  }
                >
                  {msg.role === "assistant" &&
                  msg.content === "" &&
                  isStreaming &&
                  idx === messages.length - 1 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {msg.status && (
                        <PipelineLogs status={msg.status} isStreaming={true} />
                      )}
                      <div className="typing-indicator" style={{ alignSelf: "flex-start", marginLeft: 4 }}>
                        <div className="typing-dot" />
                        <div className="typing-dot" />
                        <div className="typing-dot" />
                      </div>
                    </div>
                  ) : (
                    renderMessageContent(msg, idx)
                  )}
                </div>
                {msg.role === "user" && (
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "var(--radius-md)",
                      background: "var(--accent-gradient)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      marginTop: 2,
                    }}
                  >
                    <User size={16} color="#fff" />
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div
        style={{
          padding: "12px 24px 20px",
          maxWidth: 1600,
          margin: "0 auto",
          width: "100%",
        }}
      >
        <div className="chat-input-wrapper">
          <textarea
            ref={textareaRef}
            className="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your SAP data..."
            rows={1}
            disabled={isStreaming}
          />
          {isStreaming ? (
            <button
              className="send-button"
              onClick={handleStopStreaming}
              style={{
                background: "rgba(239, 68, 68, 0.9)",
              }}
              title="Stop generating"
            >
              <AlertCircle size={18} />
            </button>
          ) : (
            <button
              className="send-button"
              onClick={handleSend}
              disabled={!input.trim()}
              title="Send message"
            >
              <Send size={18} />
            </button>
          )}
        </div>
        <div
          style={{
            textAlign: "center",
            marginTop: 8,
            fontSize: "11px",
            color: "var(--text-tertiary)",
            opacity: 0.7,
          }}
        >
          Project Nexus can make mistakes. Verify important data.
        </div>
      </div>
    </div>
  );
}

/* ============================================
   TOOL RESULT EXTRACTION
   ============================================ */

interface ToolResults {
  cleanContent: string;
  charts: Record<string, unknown>[];
  tables: Record<string, unknown>[];
}

function extractToolResults(content: string): ToolResults {
  const charts: Record<string, unknown>[] = [];
  const tables: Record<string, unknown>[] = [];
  let cleanContent = content;

  // Try to extract ```json blocks that look like chart/table data
  const jsonBlockRegex = /```json\s*\n([\s\S]*?)\n```/g;
  let match;

  while ((match = jsonBlockRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);

      if (parsed.type === "chart" || parsed.chartType || parsed.chart_type) {
        charts.push(parsed);
        cleanContent = cleanContent.replace(match[0], "");
      } else if (
        parsed.type === "table" ||
        Array.isArray(parsed.rows) ||
        Array.isArray(parsed.data) ||
        (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "object")
      ) {
        const tableData = Array.isArray(parsed) ? { data: parsed } : parsed;
        tables.push(tableData);
        cleanContent = cleanContent.replace(match[0], "");
      }
    } catch {
      // Not valid JSON, leave in content
    }
  }

  return { cleanContent: cleanContent.trim(), charts, tables };
}
