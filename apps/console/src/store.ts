import { create } from "zustand";
import type { AirUIDocument, Component, Patch } from "@air-ui/core";
import type { ProviderPreset } from "./providerPresets";
import { applyPatches } from "@air-ui/core";

export interface ToolStatus {
  name: string;
  state: "running" | "done" | "error";
}

export interface ActiveSkill {
  slug: string;
  name: string;
  description?: string;
  source?: string;
  score?: number | null;
}

export interface RunEvent {
  id: string;
  label: string;
  detail: string;
  state: "idle" | "running" | "done" | "error";
  time: string;
}

export type ThemeMode = "light" | "dark" | "graphite" | "neon" | "glass" | "system";
export type LanguageCode = "zh-CN" | "en-US";

export interface McpServerConfig {
  name: string;
  enabled: boolean;
  /** stdio transport */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** http / sse transport */
  url?: string;
  transport?: "http" | "sse";
  headers?: Record<string, string>;
}

/** 已配置的 provider 实例（书签集合），id 唯一；active_provider_id 指向当前激活项 */
export interface ProviderInstance {
  id: string;
  /** 显示名（列表展示用），与 model.display_name 双向同步 */
  name: string;
  provider: string;
  base_url: string;
  api_key: string;
  /** 模型标识，与 model.name 双向同步 */
  model_name: string;
  max_output_tokens: number;
}

export interface AgentConfig {
  runtime: {
    max_iterations: number;
    retry_max_attempts: number;
    context_window_tokens: number;
  };
  model: {
    provider: string;
    name: string;
    base_url: string;
    api_key: string;
    max_output_tokens: number;
    /** 仅 UI 展示用，运行时不读 */
    display_name: string;
  };
  /** 已配置 provider 实例列表 */
  providers: ProviderInstance[];
  /** 当前激活的 provider 实例 id（null 表示未激活，走 model 字段） */
  active_provider_id: string | null;
  /** 合并后的 provider 预设模板列表（后端 /api/config 返回，前端只读展示） */
  provider_presets: ProviderPreset[];
  ui: {
    theme: ThemeMode;
    language: LanguageCode;
  };
  skills: {
    enabled: boolean;
    search_paths: string[];
  };
  mcp: {
    enabled: boolean;
    servers: McpServerConfig[];
  };
  plugins: {
    enabled: boolean;
    search_paths: string[];
    /** 用户配置的 marketplace 源清单 */
    marketplaces: MarketplaceSource[];
  };
}

/** marketplace 源：返回 {name, plugins:[...]} 的 JSON URL */
export interface MarketplaceSource {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  airui?: Component;
  toolStatus?: ToolStatus[];
}

export const defaultAgentConfig: AgentConfig = {
  runtime: {
    max_iterations: 12,
    retry_max_attempts: 3,
    context_window_tokens: 65536,
  },
  model: {
    provider: "llamacpp",
    name: "",
    base_url: "",
    api_key: "",
    max_output_tokens: 4096,
    display_name: "",
  },
  providers: [],
  active_provider_id: null,
  provider_presets: [],
  ui: {
    theme: "light",
    language: "zh-CN",
  },
  skills: {
    enabled: true,
    search_paths: ["packages/agent-skills"],
  },
  mcp: {
    enabled: true,
    servers: [],
  },
  plugins: {
    enabled: true,
    search_paths: [],
    marketplaces: [],
  },
};

interface AppState {
  doc: AirUIDocument | null;
  connected: boolean;
  sessionId: string;
  appConfig: AgentConfig;
  chatMessages: ChatMessage[];
  chatLoading: boolean;
  activeTools: ToolStatus[];
  activeSkills: ActiveSkill[];
  runEvents: RunEvent[];

  setDoc: (doc: AirUIDocument) => void;
  applyPatch: (patches: Patch[]) => void;
  setConnected: (connected: boolean) => void;
  setSessionId: (id: string) => void;
  setAppConfig: (config: Partial<AgentConfig>) => void;
  addChatMessage: (msg: ChatMessage) => void;
  updateLastMessage: (patch: Partial<ChatMessage>) => void;
  setChatLoading: (loading: boolean) => void;
  setActiveTools: (tools: ToolStatus[]) => void;
  setActiveSkills: (skills: ActiveSkill[]) => void;
  addRunEvent: (event: Omit<RunEvent, "id" | "time">) => void;
}

function nowLabel() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export const useStore = create<AppState>((set, get) => ({
  doc: null,
  connected: false,
  sessionId: "default",
  appConfig: defaultAgentConfig,
  chatMessages: [
    {
      role: "assistant",
      content:
        "Welcome to Yunsuo. Ask me to plan work, inspect a problem, draft a document, or render a structured artifact.",
    },
  ],
  chatLoading: false,
  activeTools: [],
  activeSkills: [],
  runEvents: [
    {
      id: "initial",
      label: "Console ready",
      detail: "Send a message to start an agent run.",
      state: "idle",
      time: nowLabel(),
    },
  ],

  setDoc: (doc) => set({ doc }),
  applyPatch: (patches) => {
    const { doc } = get();
    if (!doc) return;
    set({ doc: applyPatches(doc, patches) });
  },
  setConnected: (connected) => set({ connected }),
  setSessionId: (sessionId) => set({ sessionId }),
  setAppConfig: (config) =>
    set((s) => ({
      appConfig: {
        ...defaultAgentConfig,
        ...s.appConfig,
        ...config,
        runtime: { ...defaultAgentConfig.runtime, ...s.appConfig.runtime, ...config.runtime },
        model: { ...defaultAgentConfig.model, ...s.appConfig.model, ...config.model },
        providers: config.providers ?? s.appConfig.providers ?? [],
        active_provider_id: config.active_provider_id ?? s.appConfig.active_provider_id ?? null,
        provider_presets: config.provider_presets ?? s.appConfig.provider_presets ?? [],
        ui: { ...defaultAgentConfig.ui, ...s.appConfig.ui, ...config.ui },
        skills: { ...defaultAgentConfig.skills, ...s.appConfig.skills, ...config.skills },
        mcp: { ...defaultAgentConfig.mcp, ...s.appConfig.mcp, ...config.mcp },
        plugins: { ...defaultAgentConfig.plugins, ...s.appConfig.plugins, ...config.plugins },
      },
    })),
  addChatMessage: (msg) =>
    set((s) => ({ chatMessages: [...s.chatMessages, msg] })),
  updateLastMessage: (patch) =>
    set((s) => {
      const chatMessages = [...s.chatMessages];
      const last = chatMessages[chatMessages.length - 1];
      if (!last) return { chatMessages };
      chatMessages[chatMessages.length - 1] = { ...last, ...patch };
      return { chatMessages };
    }),
  setChatLoading: (chatLoading) => set({ chatLoading }),
  setActiveTools: (activeTools) => set({ activeTools }),
  setActiveSkills: (activeSkills) => set({ activeSkills }),
  addRunEvent: (event) =>
    set((s) => ({
      runEvents: [
        ...s.runEvents.slice(-19),
        {
          ...event,
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          time: nowLabel(),
        },
      ],
    })),
}));
