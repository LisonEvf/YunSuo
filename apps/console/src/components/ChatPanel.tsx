import { useEffect, useRef, useState } from "react";
import { useStore, type ChatMessage, type ToolStatus } from "../store";
import { t } from "../i18n";
import { sendChat } from "../chat";

function MessageBubble({ msg, thinkingLabel }: { msg: ChatMessage; thinkingLabel: string }) {
  if (msg.role === "system") return null;
  const isUser = msg.role === "user";

  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", marginBottom: 12 }}>
      <div
        style={{
          maxWidth: "86%",
          padding: "10px 12px",
          borderRadius: 8,
          background: isUser ? "var(--color-primary)" : "var(--color-surface)",
          color: isUser ? "var(--color-primary-text)" : "var(--color-text)",
          border: isUser ? "1px solid var(--color-primary)" : "1px solid var(--color-border)",
          boxShadow: isUser ? "none" : "var(--air-shadow)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontSize: 13,
          lineHeight: 1.55,
        }}
      >
        {msg.content || (isUser ? "" : thinkingLabel)}
      </div>
    </div>
  );
}

function ToolStrip({ tools }: { tools: ToolStatus[] }) {
  if (!tools.length) return null;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
      {tools.map((tool) => (
        <span
          key={tool.name}
          style={{
            fontSize: 11,
            padding: "3px 8px",
            borderRadius: 999,
            background:
              tool.state === "running"
                ? "var(--color-surface-muted)"
                : tool.state === "error"
                  ? "var(--air-dangerBg)"
                  : "var(--color-primary-soft)",
            color:
              tool.state === "running" ? "var(--color-info)" : tool.state === "error" ? "var(--color-danger)" : "var(--color-success)",
            border: "1px solid var(--color-border)",
          }}
        >
          {tool.name}: {tool.state}
        </span>
      ))}
    </div>
  );
}

export default function ChatPanel() {
  const [input, setInput] = useState("");
  const language = useStore((s) => s.appConfig.ui.language);
  const appConfig = useStore((s) => s.appConfig);
  const setAppConfig = useStore((s) => s.setAppConfig);
  const collapsed = appConfig.ui.chatCollapsed ?? false;
  const messages = useStore((s) => s.chatMessages);
  const loading = useStore((s) => s.chatLoading);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    void sendChat(text);
  }

  async function toggleCollapse() {
    const next = !collapsed;
    const newUi = { ...appConfig.ui, chatCollapsed: next };
    setAppConfig({ ui: newUi });
    try {
      await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: { ...appConfig, ui: newUi } }),
      });
    } catch {
      // 持久化失败不阻塞 UI 折叠
    }
  }

  if (collapsed) {
    return (
      <aside
        className="chat-panel"
        style={{
          width: 40, minWidth: 40, height: "100%",
          display: "flex", flexDirection: "column", alignItems: "center",
          gap: 12, paddingTop: 12,
          background: "var(--color-surface-muted)",
          borderRight: "1px solid var(--color-border)",
        }}
      >
        <button
          onClick={toggleCollapse}
          title={t(language, "expandChat")}
          style={{
            width: 28, height: 28, borderRadius: 6,
            border: "1px solid var(--color-border)", background: "var(--color-surface)",
            color: "var(--color-text)", cursor: "pointer", fontSize: 16, lineHeight: 1,
          }}
        >›</button>
        <span style={{ writingMode: "vertical-rl", fontSize: 12, color: "var(--color-muted)", letterSpacing: 2 }}>
          {t(language, "chat")}
        </span>
      </aside>
    );
  }

  return (
    <aside
      className="chat-panel"
      style={{
        width: 320,
        minWidth: 320,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--color-surface-muted)",
        borderRight: "1px solid var(--color-border)",
      }}
    >
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--color-text)" }}>{t(language, "chat")}</div>
          <div style={{ fontSize: 12, color: "var(--color-muted)", marginTop: 2 }}>{t(language, "chatSubtitle")}</div>
        </div>
        <button
          onClick={toggleCollapse}
          title={t(language, "collapseChat")}
          style={{
            width: 28, height: 28, borderRadius: 6, flexShrink: 0,
            border: "1px solid var(--color-border)", background: "var(--color-surface)",
            color: "var(--color-text)", cursor: "pointer", fontSize: 16, lineHeight: 1,
          }}
        >‹</button>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflow: "auto", padding: 14 }}>
        {messages.map((msg, index) => (
          <MessageBubble key={index} msg={msg} thinkingLabel={t(language, "thinking")} />
        ))}
        <ToolStrip tools={messages[messages.length - 1]?.toolStatus || []} />
      </div>

      <div style={{ padding: 12, borderTop: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              handleSend();
            }
          }}
          placeholder={t(language, "askPlaceholder")}
          disabled={loading}
          style={{
            width: "100%",
            minHeight: 72,
            resize: "vertical",
            boxSizing: "border-box",
            padding: "10px 11px",
            borderRadius: 8,
            border: "1px solid var(--color-border-strong)",
            outline: "none",
            fontSize: 13,
            lineHeight: 1.45,
            color: "var(--color-text)",
            background: loading ? "var(--color-app-bg)" : "var(--color-surface)",
          }}
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          style={{
            width: "100%",
            marginTop: 8,
            height: 36,
            borderRadius: 8,
            border: "none",
            background: loading || !input.trim() ? "var(--color-border)" : "var(--color-primary)",
            color: loading || !input.trim() ? "var(--color-muted)" : "var(--color-primary-text)",
            fontWeight: 700,
            cursor: loading || !input.trim() ? "not-allowed" : "pointer",
          }}
        >
          {loading ? t(language, "running") : t(language, "send")}
        </button>
      </div>
    </aside>
  );
}
