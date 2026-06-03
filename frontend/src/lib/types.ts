export interface Thread {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at?: string;
  tool_calls?: ToolCallData[];
  status?: string;
}

export interface ToolCallData {
  type: "chart" | "table";
  data: Record<string, unknown>;
}

export interface ChatRequest {
  messages: { role: string; content: string }[];
  model: string;
  thread_id?: string;
}

export interface ModelOption {
  id: string;
  name: string;
  description: string;
  icon: string;
}

export const MODELS: ModelOption[] = [
  {
    id: "llama-3.3-70b-versatile",
    name: "LLaMA 3.3 70B",
    description: "Most capable, versatile reasoning",
    icon: "🦙",
  },
  {
    id: "llama-3.1-8b-instant",
    name: "LLaMA 3.1 8B",
    description: "Fast & efficient responses",
    icon: "⚡",
  },
  {
    id: "openai/gpt-oss-120b",
    name: "GPT-OSS 120B",
    description: "OpenAI Mixture-of-Experts",
    icon: "🧠",
  },
  {
    id: "qwen/qwen3-32b",
    name: "Qwen 3 32B",
    description: "Dual-mode logic thinking model",
    icon: "🐼",
  },
  {
    id: "meta-llama/llama-4-scout-17b-16e-instruct",
    name: "LLaMA 4 Scout 17B",
    description: "Meta active MoE multimodal",
    icon: "🎯",
  },
];
