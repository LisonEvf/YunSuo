import { create } from "zustand";
import type { AirUIDocument, Component, Patch } from "@air-ui/core";
import type { ProviderPreset } from "./providerPresets";
import { applyPatches } from "@air-ui/core";
import { loadSessions, saveSessions, loadActiveSessionId, saveActiveSessionId, createSession, deriveTitle, type ChatSession } from "./chatHistory";

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
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  transport?: "http" | "sse";
  headers?: Record<string, string>;
}

export interface ProviderInstance {
  id: string;
  name: string;
  provider: string;
  base_url: string;
  api_key: string;
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
    display_name: string;
  };
  providers: ProviderInstance[];
  active_provider_id: string | null;
  provider_presets: ProviderPreset[];
  ui: {
    theme: ThemeMode;
    language: LanguageCode;
    chatCollapsed?: boolean;
    chatWidth?: number;
  };
  skills: { enabled: boolean; search_paths: string[] };
  mcp: { enabled: boolean; servers: McpServerConfig[] };
  plugins: { enabled: boolean; search_paths: string[]; marketplaces: MarketplaceSource[] };
}

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

export interface McpToolFormState {
  prefixedName: string;
  toolName: string;
  properties: Record<string, { type?: string; description?: string }>;
  required: string[];
}

export const defaultAgentConfig: AgentConfig = {
  runtime: { max_iterations: 12, retry_max_attempts: 3, context_window_tokens: 65536 },
  model: { provider: "llamacpp", name: "", base_url: "", api_key: "", max_output_tokens: 4096, display_name: "" },
  providers: [],
  active_provider_id: null,
  provider_presets: [],
  ui: { theme: "light", language: "zh-CN", chatCollapsed: false, chatWidth: 360 },
  skills: { enabled: true, search_paths: ["packages/agent-skills"] },
  mcp: { enabled: true, servers: [] },
  plugins: { enabled: true, search_paths: [], marketplaces: [] },
};

const WELCOME_MESSAGES: Record<LanguageCode, string> = {
  "zh-CN": "欢迎使用云锁。让我帮你规划任务、排查问题、起草文档，或渲染一个结构化界面。",
  "en-US": "Welcome to Yunsuo. Ask me to plan work, inspect a problem, draft a document, or render a structured artifact.",
};

function getWelcomeMessage(lang: LanguageCode = "zh-CN"): ChatMessage {
  return { role: "assistant", content: WELCOME_MESSAGES[lang] ?? WELCOME_MESSAGES["zh-CN"] };
}

function nowLabel() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

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
  mcpToolForm: McpToolFormState | null;

  // Chat history
  chatSessions: ChatSession[];
  activeChatSessionId: string | null;
  initChatHistory: () => void;
  switchChatSession: (id: string) => void;
  newChatSession: () => void;
  deleteChatSession: (id: string) => void;
  persistCurrentSession: () => void;

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
  setMcpToolForm: (form: McpToolFormState | null) => void;
}

export const useStore = create<AppState>((set, get) => ({
  doc: null,
  connected: false,
  sessionId: "default",
  appConfig: defaultAgentConfig,
  chatMessages: [getWelcomeMessage()],
  chatLoading: false,
  activeTools: [],
  activeSkills: [],
  runEvents: [
    { id: "initial", label: "Console ready", detail: "Send a message to start an agent run.", state: "idle", time: nowLabel() },
  ],
  mcpToolForm: null,

  chatSessions: [],
  activeChatSessionId: null,

  initChatHistory: () => {
    const sessions = loadSessions();
    const activeId = loadActiveSessionId();
    if (sessions.length > 0 && activeId) {
      const active = sessions.find((s) => s.id === activeId);
      if (active) {
        set({ chatSessions: sessions, activeChatSessionId: activeId, chatMessages: active.messages });
        return;
      }
    }
    if (sessions.length > 0) {
      const last = sessions[sessions.length - 1];
      set({ chatSessions: sessions, activeChatSessionId: last.id, chatMessages: last.messages });
      saveActiveSessionId(last.id);
      return;
    }
    // Create initial session
    const session = createSession(getWelcomeMessage(get().appConfig.ui.language));
    const next = [session];
    saveSessions(next);
    saveActiveSessionId(session.id);
    set({ chatSessions: next, activeChatSessionId: session.id });
  },

  switchChatSession: (id) => {
    const sessions = get().chatSessions;
    const target = sessions.find((s) => s.id === id);
    if (!target) return;
    saveActiveSessionId(id);
    set({ activeChatSessionId: id, chatMessages: target.messages });
  },

  newChatSession: () => {
    // Persist current session first
    get().persistCurrentSession();
    const session = createSession(getWelcomeMessage(get().appConfig.ui.language));
    const next = [...get().chatSessions, session];
    saveSessions(next);
    saveActiveSessionId(session.id);
    set({ chatSessions: next, activeChatSessionId: session.id, chatMessages: session.messages });
  },

  deleteChatSession: (id) => {
    const sessions = get().chatSessions.filter((s) => s.id !== id);
    saveSessions(sessions);
    if (sessions.length === 0) {
      const fresh = createSession(getWelcomeMessage(get().appConfig.ui.language));
      saveSessions([fresh]);
      saveActiveSessionId(fresh.id);
      set({ chatSessions: [fresh], activeChatSessionId: fresh.id, chatMessages: fresh.messages });
    } else {
      const activeId = get().activeChatSessionId === id ? sessions[sessions.length - 1].id : get().activeChatSessionId;
      saveActiveSessionId(activeId!);
      const messages = activeId === get().activeChatSessionId && get().activeChatSessionId !== id
        ? get().chatMessages
        : sessions.find((s) => s.id === activeId)?.messages ?? [getWelcomeMessage(get().appConfig.ui.language)];
      set({ chatSessions: sessions, activeChatSessionId: activeId, chatMessages: messages });
    }
  },

  persistCurrentSession: () => {
    const { chatSessions, activeChatSessionId, chatMessages } = get();
    if (!activeChatSessionId) return;
    const updated = chatSessions.map((s) =>
      s.id === activeChatSessionId
        ? { ...s, messages: chatMessages, title: deriveTitle(chatMessages), updatedAt: Date.now() }
        : s
    );
    saveSessions(updated);
    set({ chatSessions: updated });
  },

  setDoc: (doc) => set({ doc }),
  setMcpToolForm: (mcpToolForm) => set({ mcpToolForm }),
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
  addChatMessage: (msg) => {
    set((s) => ({ chatMessages: [...s.chatMessages, msg] }));
    // Debounced persist - schedule after current call stack
    setTimeout(() => get().persistCurrentSession(), 0);
  },
  updateLastMessage: (patch) => {
    set((s) => {
      const chatMessages = [...s.chatMessages];
      const last = chatMessages[chatMessages.length - 1];
      if (!last) return { chatMessages };
      chatMessages[chatMessages.length - 1] = { ...last, ...patch };
      return { chatMessages };
    });
  },
  setChatLoading: (chatLoading) => {
    set({ chatLoading });
    // Persist when loading finishes
    if (!chatLoading) {
      setTimeout(() => get().persistCurrentSession(), 0);
    }
  },
  setActiveTools: (activeTools) => set({ activeTools }),
  setActiveSkills: (activeSkills) => set({ activeSkills }),
  addRunEvent: (event) =>
    set((s) => ({
      runEvents: [
        ...s.runEvents.slice(-19),
        { ...event, id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, time: nowLabel() },
      ],
    })),
}));
