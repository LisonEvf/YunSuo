/**
 * Chat history persistence: saves chat sessions to localStorage.
 * Each session stores messages + timestamp. Active session id is tracked.
 */

import type { Component } from "@air-ui/core";

/** Minimal chat message shape for serialization (avoids circular import with store.ts) */
export interface SerializableMessage {
  role: "user" | "assistant" | "system";
  content: string;
  airui?: Component;
  toolStatus?: Array<{ name: string; state: "running" | "done" | "error" }>;
}

const STORAGE_KEY = "yunsuo:chat-sessions";
const ACTIVE_KEY = "yunsuo:chat-active-session";

export interface ChatSession {
  id: string;
  title: string;
  messages: SerializableMessage[];
  createdAt: number;
  updatedAt: number;
}

export function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s: any) => s && s.id && Array.isArray(s.messages));
  } catch {
    return [];
  }
}

export function saveSessions(sessions: ChatSession[]): void {
  try {
    const trimmed = sessions
      .slice(-20)
      .map((s) => ({
        ...s,
        messages: s.messages.slice(-200),
      }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage might be full; silently skip
  }
}

export function loadActiveSessionId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function saveActiveSessionId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    // ignore
  }
}

export function createSession(firstMessage?: SerializableMessage): ChatSession {
  const id = `s-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`;
  return {
    id,
    title: firstMessage
      ? firstMessage.content.slice(0, 40)
      : "New chat",
    messages: firstMessage ? [firstMessage] : [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function deriveTitle(messages: SerializableMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (firstUser) {
    return firstUser.content.slice(0, 40) || "New chat";
  }
  return messages.length > 0 ? "New chat" : "Empty chat";
}
