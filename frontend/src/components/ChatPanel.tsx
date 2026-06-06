import React, { useState, useRef, useEffect, useMemo } from "react";
import { useStore } from "../store";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Component } from "@air-ui/core";
import { AirUIComponent, InteractionProvider, useAirUIStore } from "@air-ui/renderer-react";
import { sendInteraction } from "../ws-client";

// ── 类型 ────────────────────────────────────────────────────────────
interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  /** AIRUI 组件树，内联渲染在消息下方 */
  airui?: Component;
  /** 工具调用状态 */
  toolStatus?: { name: string; state: "running" | "done" | "error" }[];
}

// ── Markdown 样式 ────────────────────────────────────────────────────
const markdownComponents = {
  p: ({ children }: any) => (
    <p style={{ margin: "4px 0", lineHeight: 1.6 }}>{children}</p>
  ),
  strong: ({ children }: any) => (
    <strong style={{ color: "#fbbf24", fontWeight: 600 }}>{children}</strong>
  ),
  em: ({ children }: any) => (
    <em style={{ color: "#93c5fd" }}>{children}</em>
  ),
  code: ({ inline, className, children }: any) => {
    if (inline) {
      return (
        <code
          style={{
            background: "#1e293b",
            padding: "1px 5px",
            borderRadius: 3,
            fontSize: 12,
            color: "#7dd3fc",
          }}
        >
          {children}
        </code>
      );
    }
    return (
      <pre
        style={{
          background: "#0f172a",
          padding: 10,
          borderRadius: 6,
          overflowX: "auto",
          fontSize: 12,
          lineHeight: 1.4,
          margin: "8px 0",
        }}
      >
        <code>{children}</code>
      </pre>
    );
  },
  ul: ({ children }: any) => (
    <ul style={{ paddingLeft: 18, margin: "4px 0" }}>{children}</ul>
  ),
  ol: ({ children }: any) => (
    <ol style={{ paddingLeft: 18, margin: "4px 0" }}>{children}</ol>
  ),
  li: ({ children }: any) => (
    <li style={{ lineHeight: 1.6, margin: "2px 0" }}>{children}</li>
  ),
  table: ({ children }: any) => (
    <table
      style={{
        borderCollapse: "collapse",
        width: "100%",
        fontSize: 12,
        margin: "8px 0",
      }}
    >
      {children}
    </table>
  ),
  th: ({ children }: any) => (
    <th
      style={{
        border: "1px solid #334155",
        padding: "4px 8px",
        background: "#1e293b",
        textAlign: "left",
        fontWeight: 600,
      }}
    >
      {children}
    </th>
  ),
  td: ({ children }: any) => (
    <td style={{ border: "1px solid #334155", padding: "4px 8px" }}>
      {children}
    </td>
  ),
  blockquote: ({ children }: any) => (
    <blockquote
      style={{
        borderLeft: "3px solid #3b82f6",
        paddingLeft: 10,
        margin: "6px 0",
        color: "#94a3b8",
      }}
    >
      {children}
    </blockquote>
  ),
  h1: ({ children }: any) => (
    <h1 style={{ fontSize: 16, fontWeight: 700, margin: "8px 0 4px" }}>
      {children}
    </h1>
  ),
  h2: ({ children }: any) => (
    <h2 style={{ fontSize: 14, fontWeight: 700, margin: "8px 0 4px" }}>
      {children}
    </h2>
  ),
  h3: ({ children }: any) => (
    <h3 style={{ fontSize: 13, fontWeight: 600, margin: "6px 0 2px" }}>
      {children}
    </h3>
  ),
};

// ── AIRUI 内联渲染 ──────────────────────────────────────────────────
function AirUIInline({ comp }: { comp: Component }) {
  const doc = useStore((s) => s.doc);
  const setAiruiDoc = useAirUIStore((s) => s.setDoc);
  useEffect(() => {
    if (doc) setAiruiDoc(doc);
  }, [doc, setAiruiDoc]);

  const handler = (widgetRef: string, interaction: string, payload: Record<string, unknown>) => {
    sendInteraction(widgetRef, interaction, payload);
  };

  return (
    <div
      style={{
        marginTop: 8,
        background: "#1e293b",
        borderRadius: 8,
        padding: 10,
        border: "1px solid #334155",
      }}
    >
      <InteractionProvider value={handler}>
        <AirUIComponent comp={comp} />
      </InteractionProvider>
    </div>
  );
}

// ── 工具状态条 ──────────────────────────────────────────────────────
function ToolStatusBar({ tools }: { tools: { name: string; state: string }[] }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
      {tools.map((t, i) => (
        <span
          key={i}
          style={{
            fontSize: 11,
            padding: "2px 8px",
            borderRadius: 10,
            background: t.state === "running" ? "#1d4ed8" : t.state === "error" ? "#7f1d1d" : "#14532d",
            color: t.state === "running" ? "#93c5fd" : t.state === "error" ? "#fca5a5" : "#86efac",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          {t.state === "running" && "⏳"}
          {t.state === "done" && "✓"}
          {t.state === "error" && "✗"}
          {t.name}
        </span>
      ))}
    </div>
  );
}

// ── 单条消息 ────────────────────────────────────────────────────────
function MessageBubble({ msg }: { msg: ChatMessage }) {
  if (msg.role === "system") return null;

  const isUser = msg.role === "user";

  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        marginBottom: 12,
        padding: "0 12px",
      }}
    >
      {/* 助手头像 */}
      {!isUser && (
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            flexShrink: 0,
            marginTop: 2,
            marginRight: 8,
          }}
        >
          AI
        </div>
      )}

      <div style={{ maxWidth: "78%", minWidth: 60 }}>
        {/* 工具调用状态 */}
        {msg.toolStatus && msg.toolStatus.length > 0 && (
          <ToolStatusBar tools={msg.toolStatus} />
        )}

        {/* 消息气泡 */}
        {msg.content && (
          <div
            style={{
              padding: "10px 14px",
              borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
              background: isUser ? "#3b82f6" : "#1e293b",
              color: isUser ? "#fff" : "#e2e8f0",
              fontSize: 13,
              lineHeight: 1.6,
              wordBreak: "break-word",
            }}
          >
            {isUser ? (
              msg.content
            ) : (
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {msg.content}
              </ReactMarkdown>
            )}
          </div>
        )}

        {/* 空内容的思考状态 */}
        {!msg.content && !msg.airui && msg.role === "assistant" && (
          <div
            style={{
              padding: "12px 16px",
              borderRadius: "16px 16px 16px 4px",
              background: "#1e293b",
              color: "#64748b",
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span className="dot-pulse" style={{ display: "inline-flex", gap: 3 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#64748b", animation: "pulse 1.2s infinite" }} />
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#64748b", animation: "pulse 1.2s 0.2s infinite" }} />
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#64748b", animation: "pulse 1.2s 0.4s infinite" }} />
            </span>
            分析中...
          </div>
        )}

        {/* AIRUI 内联渲染 */}
        {msg.airui && <AirUIInline comp={msg.airui} />}
      </div>

      {/* 用户头像 */}
      {isUser && (
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "#475569",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            flexShrink: 0,
            marginTop: 2,
            marginLeft: 8,
          }}
        >
          Me
        </div>
      )}
    </div>
  );
}

// ── 主面板 ──────────────────────────────────────────────────────────
export default function ChatPanel() {
  const [input, setInput] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const messages = useStore((s) => s.chatMessages) as ChatMessage[];
  const loading = useStore((s) => s.chatLoading);
  const addMessage = useStore((s) => s.addChatMessage);
  const setLoading = useStore((s) => s.setChatLoading);
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
    addMessage({ role: "user", content: text });
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, { role: "user", content: text }],
          stream: true,
        }),
      });

      if (!res.ok || !res.body) {
        addMessage({ role: "assistant", content: `请求失败: ${res.status}` });
        setLoading(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantContent = "";
      let toolStatuses: { name: string; state: string }[] = [];
      let airuiComp: Component | undefined;

      addMessage({ role: "assistant", content: "" });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));

            switch (evt.type) {
              case "delta":
                if (evt.content) {
                  assistantContent += evt.content;
                  useStore.setState((s) => {
                    const msgs = [...s.chatMessages];
                    const last = msgs[msgs.length - 1];
                    msgs[msgs.length - 1] = { ...last, content: assistantContent };
                    return { chatMessages: msgs };
                  });
                }
                break;

              case "tool_start":
                toolStatuses = (evt.tools || []).map((t: any) => ({
                  name: t.name.replace(/^get_/, "").replace(/_/g, " "),
                  state: "running",
                }));
                useStore.setState((s) => {
                  const msgs = [...s.chatMessages];
                  const last = msgs[msgs.length - 1];
                  msgs[msgs.length - 1] = { ...last, toolStatus: [...toolStatuses] };
                  return { chatMessages: msgs };
                });
                break;

              case "tool_result": {
                const toolName = (evt.name || "").replace(/^get_/, "").replace(/_/g, " ");
                toolStatuses = toolStatuses.map((t) =>
                  t.name === toolName
                    ? { ...t, state: evt.error ? "error" : "done" }
                    : t
                );
                // 检测 AIRUI 渲染事件
                if (evt.name === "render_airui_panel" && !evt.error) {
                  try {
                    const result = JSON.parse(evt.result);
                    if (result.status === "rendered") {
                      // 渲染成功 — 在消息下方显示提示
                      assistantContent += "\n\n📊 *已渲染到看板*";
                      useStore.setState((s) => {
                        const msgs = [...s.chatMessages];
                        const last = msgs[msgs.length - 1];
                        msgs[msgs.length - 1] = {
                          ...last,
                          content: assistantContent,
                          toolStatus: [...toolStatuses],
                        };
                        return { chatMessages: msgs };
                      });
                    }
                  } catch {}
                }
                // 检测内联 AIRUI 数据
                if (evt.airui) {
                  airuiComp = evt.airui;
                  useStore.setState((s) => {
                    const msgs = [...s.chatMessages];
                    const last = msgs[msgs.length - 1];
                    msgs[msgs.length - 1] = { ...last, airui: airuiComp, toolStatus: [...toolStatuses] };
                    return { chatMessages: msgs };
                  });
                }
                break;
              }

              case "airui":
                if (evt.data) {
                  useStore.setState((s) => {
                    const msgs = [...s.chatMessages];
                    const last = msgs[msgs.length - 1];
                    msgs[msgs.length - 1] = { ...last, airui: evt.data };
                    return { chatMessages: msgs };
                  });
                }
                break;
            }
          } catch {
            // ignore
          }
        }
      }
    } catch (err) {
      addMessage({ role: "assistant", content: `连接失败: ${err}` });
    } finally {
      setLoading(false);
    }
  }

  if (collapsed) {
    return (
      <div
        onClick={() => setCollapsed(false)}
        style={{
          width: 40,
          height: "100%",
          background: "#1e293b",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          color: "#94a3b8",
          fontSize: 20,
          borderRight: "1px solid #334155",
        }}
      >
        💬
      </div>
    );
  }

  return (
    <div
      style={{
        width: 400,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#0f172a",
        color: "#e2e8f0",
        borderRight: "1px solid #1e293b",
      }}
    >
      {/* 标题栏 */}
      <div
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid #1e293b",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "#0f172a",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 14 }}>💬 对话</span>
        <span
          onClick={() => setCollapsed(true)}
          style={{
            cursor: "pointer",
            color: "#64748b",
            fontSize: 16,
            lineHeight: 1,
            padding: "2px 4px",
          }}
        >
          ◀
        </span>
      </div>

      {/* 消息列表 */}
      <div
        ref={scrollRef}
        style={{ flex: 1, overflow: "auto", padding: "12px 0" }}
      >
        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}
        {loading && !messages[messages.length - 1]?.content && (
          <div style={{ padding: "0 12px" }}>
            <div style={{ color: "#64748b", fontSize: 12, padding: "4px 8px" }}>
              Agent 思考中...
            </div>
          </div>
        )}
      </div>

      {/* 输入区域 */}
      <div
        style={{
          padding: 12,
          borderTop: "1px solid #1e293b",
          display: "flex",
          gap: 8,
          background: "#0f172a",
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
          placeholder="输入问题... (Enter 发送)"
          disabled={loading}
          style={{
            flex: 1,
            padding: "10px 14px",
            borderRadius: 8,
            background: "#1e293b",
            border: "1px solid #334155",
            color: "#e2e8f0",
            fontSize: 13,
            outline: "none",
            transition: "border-color 0.2s",
          }}
          onFocus={(e) => (e.target.style.borderColor = "#3b82f6")}
          onBlur={(e) => (e.target.style.borderColor = "#334155")}
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          style={{
            padding: "10px 18px",
            borderRadius: 8,
            background: loading || !input.trim() ? "#1e293b" : "#3b82f6",
            color: loading || !input.trim() ? "#475569" : "#fff",
            border: "none",
            cursor: loading ? "not-allowed" : "pointer",
            fontSize: 13,
            fontWeight: 500,
            transition: "background 0.2s",
          }}
        >
          发送
        </button>
      </div>

      {/* 加载动画 keyframes */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
