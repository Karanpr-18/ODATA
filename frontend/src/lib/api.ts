import { Thread, Message } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

/* ============================================
   THREADS
   ============================================ */

export async function fetchThreads(): Promise<Thread[]> {
  try {
    const res = await fetch(`${API_BASE}/api/threads`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error("Failed to fetch threads");
    const data = await res.json();
    return data.threads || [];
  } catch (err) {
    console.error("fetchThreads error:", err);
    return [];
  }
}

export async function createThread(title: string): Promise<Thread | null> {
  try {
    const res = await fetch(`${API_BASE}/api/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) throw new Error("Failed to create thread");
    const data = await res.json();
    return data.thread || null;
  } catch (err) {
    console.error("createThread error:", err);
    return null;
  }
}

export async function deleteThread(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/threads/${id}`, {
      method: "DELETE",
    });
    return res.ok;
  } catch (err) {
    console.error("deleteThread error:", err);
    return false;
  }
}

export async function renameThread(id: string, title: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/threads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    return res.ok;
  } catch (err) {
    console.error("renameThread error:", err);
    return false;
  }
}

export async function fetchThreadMessages(id: string): Promise<Message[]> {
  try {
    const res = await fetch(`${API_BASE}/api/threads/${id}/messages`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error("Failed to fetch messages");
    const data = await res.json();
    return data.messages || [];
  } catch (err) {
    console.error("fetchThreadMessages error:", err);
    return [];
  }
}

/* ============================================
   CHAT (SSE STREAMING)
   ============================================ */

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
  onToolCall?: (data: Record<string, unknown>) => void;
  onStatus?: (status: string) => void;
}

export async function sendChatMessage(
  messages: { role: string; content: string }[],
  model: string,
  threadId: string | null,
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        model,
        thread_id: threadId,
      }),
      signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      callbacks.onError(`Server error: ${res.status} - ${errText}`);
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      callbacks.onError("No response stream available");
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const jsonStr = trimmed.slice(6);
        if (jsonStr === "[DONE]") {
          callbacks.onDone();
          return;
        }

        try {
          const data = JSON.parse(jsonStr);

          if (data.type === "token" && data.content) {
            callbacks.onToken(data.content);
          } else if (data.type === "status" && data.content && callbacks.onStatus) {
            callbacks.onStatus(data.content);
          } else if (data.type === "done") {
            callbacks.onDone();
            return;
          } else if (data.type === "error") {
            callbacks.onError(data.content || "Unknown streaming error");
            return;
          } else if (data.type === "tool_call" && callbacks.onToolCall) {
            callbacks.onToolCall(data);
          }
        } catch {
          // Non-JSON SSE line, try plain text token fallback
          if (jsonStr) {
            callbacks.onToken(jsonStr);
          }
        }
      }
    }

    // If we got here without a done signal, call done
    callbacks.onDone();
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      callbacks.onDone();
    } else {
      callbacks.onError((err as Error).message || "Network error");
    }
  }
}

export async function fetchSchemaGraph(): Promise<{ nodes: any[]; edges: any[] }> {
  try {
    const res = await fetch(`${API_BASE}/api/schema-graph`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error("Failed to fetch schema graph");
    return await res.json();
  } catch (err) {
    console.error("fetchSchemaGraph error:", err);
    return { nodes: [], edges: [] };
  }
}

/* ============================================
   SETTINGS
   ============================================ */

export interface LLMConfig {
  provider: string;
  active_model: string;
  fallback_model: string;
  api_keys: Record<string, string>;
}

export interface ServiceConfig {
  name: string;
  url: string;
  description: string;
}

export interface JoinConfig {
  source_service: string;
  target_service: string;
  source_table: string;
  target_table: string;
  join_key: string;
}

export interface AppSettings {
  llm: LLMConfig;
  services: ServiceConfig[];
  joins: JoinConfig[];
}

export async function fetchSettings(): Promise<AppSettings> {
  try {
    const res = await fetch(`${API_BASE}/api/settings`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error("Failed to fetch settings");
    return await res.json();
  } catch (err) {
    console.error("fetchSettings error:", err);
    return {
      llm: { provider: "", active_model: "", fallback_model: "", api_keys: {} },
      services: [],
      joins: [],
    };
  }
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    return res.ok;
  } catch (err) {
    console.error("saveSettings error:", err);
    return false;
  }
}
