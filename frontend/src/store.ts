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
  chatMessages: [],
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
