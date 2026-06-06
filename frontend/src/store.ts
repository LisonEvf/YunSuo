import { create } from "zustand";
import type { AirUIDocument, Patch } from "@air-ui/core";
import { applyPatches } from "@air-ui/core";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AppState {
  doc: AirUIDocument | null;
  connected: boolean;
  sessionId: string;
  chatMessages: ChatMessage[];
  chatLoading: boolean;

  setDoc: (doc: AirUIDocument) => void;
  applyPatch: (patches: Patch[]) => void;
  setConnected: (connected: boolean) => void;
  setSessionId: (id: string) => void;
  addChatMessage: (msg: ChatMessage) => void;
  setChatLoading: (loading: boolean) => void;
}

export const useStore = create<AppState>((set, get) => ({
  doc: null,
  connected: false,
  sessionId: "default",
  chatMessages: [
    {
      role: "assistant" as const,
      content:
        "👋 欢迎使用市场情绪分析助手！\n\n我可以提供实时市场分析并**生成可视化面板**，例如：\n- **今日情绪如何？** — 综合情绪周期 + KPI 面板\n- **哪些板块最强？** — 板块排行表格\n- **情绪趋势分析** — 趋势折线图\n- **赚钱手法评分** — 多维度评分面板\n\n试试看吧！",
    },
  ],
  chatLoading: false,

  setDoc: (doc) => set({ doc }),
  applyPatch: (patches) => {
    const { doc } = get();
    if (!doc) return;
    set({ doc: applyPatches(doc, patches) });
  },
  setConnected: (connected) => set({ connected }),
  setSessionId: (sessionId) => set({ sessionId }),
  addChatMessage: (msg) =>
    set((s) => ({ chatMessages: [...s.chatMessages, msg] })),
  setChatLoading: (chatLoading) => set({ chatLoading }),
}));
