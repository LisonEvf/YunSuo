import React, { useState, useRef, useEffect } from "react";
import { useStore } from "../store";

export default function ChatPanel() {
  const [input, setInput] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const messages = useStore((s) => s.chatMessages);
  const loading = useStore((s) => s.chatLoading);
  const addMessage = useStore((s) => s.addChatMessage);
  const setLoading = useStore((s) => s.setChatLoading);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

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
            if (evt.type === "delta" && evt.content) {
              assistantContent += evt.content;
              useStore.setState((s) => {
                const msgs = [...s.chatMessages];
                msgs[msgs.length - 1] = {
                  role: "assistant",
                  content: assistantContent,
                };
                return { chatMessages: msgs };
              });
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
        }}
      >
        💬
      </div>
    );
  }

  return (
    <div
      style={{
        width: 340,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#1e293b",
        color: "#e2e8f0",
        borderRight: "1px solid #334155",
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid #334155",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontWeight: 600 }}>对话</span>
        <span
          onClick={() => setCollapsed(true)}
          style={{ cursor: "pointer", color: "#64748b" }}
        >
          ◀
        </span>
      </div>

      <div
        ref={scrollRef}
        style={{ flex: 1, overflow: "auto", padding: 12 }}
      >
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              marginBottom: 8,
              padding: "8px 12px",
              borderRadius: 8,
              background: msg.role === "user" ? "#3b82f6" : "#334155",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {msg.content || "思考中..."}
          </div>
        ))}
        {loading && (
          <div style={{ color: "#64748b", fontSize: 12 }}>
            Agent 分析中...
          </div>
        )}
      </div>

      <div
        style={{
          padding: 12,
          borderTop: "1px solid #334155",
          display: "flex",
          gap: 8,
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="输入问题..."
          disabled={loading}
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: 6,
            background: "#0f172a",
            border: "1px solid #475569",
            color: "#e2e8f0",
            fontSize: 13,
            outline: "none",
          }}
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          style={{
            padding: "8px 16px",
            borderRadius: 6,
            background: "#3b82f6",
            color: "#fff",
            border: "none",
            cursor: loading ? "not-allowed" : "pointer",
            fontSize: 13,
          }}
        >
          发送
        </button>
      </div>
    </div>
  );
}
