import { useEffect, useRef, useState, useCallback } from "react";
import { useStore, type ChatMessage, type ToolStatus, type LanguageCode, type ThemeMode } from "../store";
import { t } from "../i18n";
import { sendChat } from "../chat";
import MarkdownView from "./MarkdownView";
import Icon from "./Icon";

function MessageBubble({ msg, thinkingLabel, language }: { msg: ChatMessage; thinkingLabel: string; language: LanguageCode }) {
  if (msg.role === "system") return null;
  const isUser = msg.role === "user";
  const content = msg.content || (isUser ? "" : thinkingLabel);

  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleRegenerate = () => {
    if (isUser) {
      void sendChat(content);
    } else {
      const msgs = useStore.getState().chatMessages;
      const idx = msg.id ? msgs.findIndex((m) => m.id === msg.id) : msgs.lastIndexOf(msg);
      const prevUser = idx >= 0 ? [...msgs.slice(0, idx)].reverse().find((m) => m.role === "user") : undefined;
      if (prevUser) void sendChat(prevUser.content);
    }
  };

  const rowClass = `chat-bubble-row ${isUser ? "chat-bubble-row-user" : "chat-bubble-row-bot"}`;
  const wrapClass = `chat-bubble-wrap ${isUser ? "chat-bubble-wrap-user" : ""}`;
  const bubbleClass = `chat-bubble ${isUser ? "chat-bubble-user" : "chat-bubble-bot"}`;

  return (
    <div className={rowClass}>
      <div className={wrapClass}>
        <div className={bubbleClass}>
          {isUser
            ? <MarkdownView content={content} plain />
            : <MarkdownView content={content} />}
        </div>
        {!isUser && (
          <div className="chat-msg-actions">
            <button className="chat-msg-action-btn" onClick={handleCopy} title={t(language, "copyMessage")} aria-label={t(language, "copyMessage")}>
              <Icon name={copied ? "check" : "copy"} size={12} />
            </button>
            <button className="chat-msg-action-btn" onClick={handleRegenerate} title={t(language, "regenerate")} aria-label={t(language, "regenerate")}>
              <Icon name="refresh" size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolStrip({ tools }: { tools: ToolStatus[] }) {
  if (!tools.length) return null;
  return (
    <div className="chat-tool-strip">
      {tools.map((tool) => (
        <span key={tool.name} className={`chat-tool-pill chat-tool-${tool.state}`}>
          {tool.name}: {tool.state}
        </span>
      ))}
    </div>
  );
}

const MIN_WIDTH = 260;
const MAX_WIDTH = 560;
const DEFAULT_WIDTH = 360;

const THEME_CYCLE: ThemeMode[] = ["light", "dark", "graphite", "neon", "glass", "system"];

export default function ChatPanel() {
  const [input, setInput] = useState("");
  const [showSessions, setShowSessions] = useState(false);
  const [sessionSearch, setSessionSearch] = useState("");
  const language = useStore((s) => s.appConfig.ui.language);
  const appConfig = useStore((s) => s.appConfig);
  const setAppConfig = useStore((s) => s.setAppConfig);
  const theme = useStore((s) => s.appConfig.ui.theme);
  const collapsed = appConfig.ui.chatCollapsed ?? false;
  const messages = useStore((s) => s.chatMessages);
  const loading = useStore((s) => s.chatLoading);
  const chatSessions = useStore((s) => s.chatSessions);
  const activeChatSessionId = useStore((s) => s.activeChatSessionId);
  const switchChatSession = useStore((s) => s.switchChatSession);
  const newChatSession = useStore((s) => s.newChatSession);
  const deleteChatSession = useStore((s) => s.deleteChatSession);
  const persistCurrentSession = useStore((s) => s.persistCurrentSession);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelWidth = appConfig.ui.chatWidth ?? DEFAULT_WIDTH;
  const draggingRef = useRef(false);

  const cycleTheme = useCallback(async () => {
    const idx = THEME_CYCLE.indexOf(theme);
    const next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
    const newConfig = { ...useStore.getState().appConfig, ui: { ...useStore.getState().appConfig.ui, theme: next } };
    setAppConfig({ ui: newConfig.ui });
    try {
      await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: newConfig }),
      });
    } catch { /* persistence failure doesn't block UI */ }
  }, [theme, setAppConfig]);

  // Session filtering
  const filteredSessions = chatSessions.filter((s) => {
    if (!sessionSearch.trim()) return true;
    const q = sessionSearch.toLowerCase();
    const titleMatch = (s.title || "").toLowerCase().includes(q);
    const contentMatch = s.messages.some(
      (m) => m.role === "user" && (m.content || "").toLowerCase().includes(q)
    );
    return titleMatch || contentMatch;
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  useEffect(() => {
    (window as any).__focusChatInput = () => inputRef.current?.focus();
    return () => { delete (window as any).__focusChatInput; };
  }, []);

  // Persist on unmount / page close
  useEffect(() => {
    const handler = () => persistCurrentSession();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [persistCurrentSession]);

  // Auto-resize textarea
  const autoResize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }
    void sendChat(text);
  }, [input, loading]);

  // Cmd/Ctrl+Enter to send (alternative to Enter)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        const target = e.target as HTMLElement;
        if (target?.tagName === "TEXTAREA" || target?.tagName === "INPUT") {
          e.preventDefault();
          void handleSend();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSend]);

  // Clear session search when closing the dropdown
  useEffect(() => {
    if (!showSessions) setSessionSearch("");
  }, [showSessions]);

  async function toggleCollapse() {
    const next = !collapsed;
    setAppConfig({ ui: { ...appConfig.ui, chatCollapsed: next } });
    try {
      await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: { ...appConfig, ui: { ...appConfig.ui, chatCollapsed: next } } }),
      });
    } catch { /* persistence failure doesn't block UI */ }
  }

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    const startX = e.clientX;
    const startWidth = panelWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    let currentWidth = startWidth;

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      // 鼠标向右拖动时，宽度应该增加；鼠标向左拖动时，宽度应该减少
      // 由于是右侧调整宽度，所以delta为正时宽度应增加，负时减少
      const delta = ev.clientX - startX;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));
      currentWidth = next;
      setAppConfig({ ui: { ...appConfig.ui, chatWidth: next } });
    };
    const onUp = () => {
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);

      // 保存宽度设置到持久化存储
      try {
        fetch("/api/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: { ...appConfig, ui: { ...appConfig.ui, chatWidth: currentWidth } } }),
        });
      } catch { /* persistence failure doesn't block UI */ }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [panelWidth, setAppConfig]);

  if (collapsed) {
    return (
      <aside className="chat-panel chat-panel-collapsed">
        <button onClick={toggleCollapse} title={t(language, "expandChat")} className="chat-icon-btn" aria-label={t(language, "expandChat")}>
          <Icon name="expand" size={18} />
        </button>
        <span className="chat-collapsed-label">{t(language, "chat")}</span>
      </aside>
    );
  }

  const activeSession = chatSessions.find((s) => s.id === activeChatSessionId);

  return (
    <>
      <aside className="chat-panel" style={{ width: panelWidth, minWidth: MIN_WIDTH }}>
        <div className="chat-header">
          <div className="chat-header-text" style={{ flex: 1, minWidth: 0 }}>
            <div className="chat-header-title">{t(language, "chat")}</div>
            <div className="chat-header-sub">{t(language, "chatSubtitle")}</div>
          </div>
          <button
            onClick={cycleTheme}
            title={t(language, theme === "system" ? "system" : theme)}
            className="chat-icon-btn"
            aria-label={t(language, "theme")}
          >
            <Icon name="palette" size={16} />
          </button>
          <button
            onClick={() => setShowSessions((v) => !v)}
            title={t(language, "session")}
            className="chat-icon-btn"
            aria-label={t(language, "session")}
          >
            <Icon name="messageSquare" size={16} />
          </button>
          <button
            onClick={() => { newChatSession(); setShowSessions(false); }}
            title={t(language, "newChat")}
            className="chat-icon-btn"
            aria-label={t(language, "newChat")}
          >
            <Icon name="plus" size={16} />
          </button>
          <button onClick={toggleCollapse} title={t(language, "collapseChat")} className="chat-icon-btn" aria-label={t(language, "collapseChat")}>
            <Icon name="collapse" size={18} />
          </button>
        </div>

        {showSessions && (
          <div className="chat-session-list" role="listbox" aria-label={t(language, "session")}>
            {chatSessions.length > 0 && (
              <div className="chat-session-search">
                <input
                  type="text"
                  value={sessionSearch}
                  onChange={(e) => setSessionSearch(e.target.value)}
                  placeholder={t(language, "searchSessions")}
                  className="chat-session-search-input"
                  aria-label={t(language, "searchSessions")}
                  autoFocus
                />
                {sessionSearch && (
                  <button
                    className="chat-session-search-clear"
                    onClick={() => setSessionSearch("")}
                    aria-label={t(language, "clear")}
                  >
                    <Icon name="close" size={12} />
                  </button>
                )}
              </div>
            )}
            {filteredSessions.length === 0 && (
              <div className="chat-session-empty">
                {chatSessions.length === 0 ? t(language, "noSessions") : t(language, "noResults")}
              </div>
            )}
            {filteredSessions.slice().reverse().map((s) => (
              <div
                key={s.id}
                role="option"
                aria-selected={s.id === activeChatSessionId}
                tabIndex={0}
                className={`chat-session-item ${s.id === activeChatSessionId ? "chat-session-item-active" : ""}`}
                onClick={() => { switchChatSession(s.id); setShowSessions(false); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); switchChatSession(s.id); setShowSessions(false); } }}
              >
                <span className="chat-session-title">{s.title || t(language, "untitled")}</span>
                <button
                  className="chat-session-delete"
                  onClick={(e) => { e.stopPropagation(); deleteChatSession(s.id); }}
                  title={t(language, "delete")}
                  aria-label={t(language, "delete")}
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div ref={scrollRef} className="chat-messages">
          {messages.map((msg, index) => (
            <MessageBubble key={msg.id ?? index} msg={msg} thinkingLabel={t(language, "thinking")} language={language} />
          ))}
          <ToolStrip tools={messages[messages.length - 1]?.toolStatus || []} />
          {activeSession && messages.length > 1 && (
            <div className="chat-session-info">
              {messages.length} {t(language, "messages")} · {new Date(activeSession.updatedAt).toLocaleDateString()}
            </div>
          )}
        </div>

        <div className="chat-input-area">
         <textarea
           ref={inputRef}
           value={input}
           onChange={(event) => { setInput(event.target.value); autoResize(); }}
           onKeyDown={(event) => {
             if (event.key === "Enter" && !event.shiftKey) {
               event.preventDefault();
               handleSend();
             }
           }}
           onInput={autoResize}
           placeholder={t(language, "askPlaceholder")}
           disabled={loading}
           aria-label={t(language, "askPlaceholder")}
           className="chat-textarea chat-textarea-auto"
           rows={1}
         />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className={`chat-send-btn ${loading || !input.trim() ? "chat-send-btn-disabled" : ""}`}
            aria-label={t(language, "send")}
          >
            <Icon name="send" size={15} />
            <span>{loading ? t(language, "running") : t(language, "send")}</span>
          </button>
        </div>
      </aside>
      <div className="chat-resize-handle" onMouseDown={startResize} title={t(language, "dragToResize")} role="separator" aria-orientation="vertical" />
    </>
  );
}
