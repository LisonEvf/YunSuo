import { useStore, type ToolStatus } from "./store";
import { useAirUIStore } from "@air-ui/renderer-react";

/**
 * 共享的聊天发送逻辑（流式）。ChatPanel 的输入框与主页 starter 卡片共用。
 * 产出的 airui 写入最后一条 assistant 消息，由 ConsoleView 桥接进主画廊。
 */
export async function sendChat(text: string) {
  const trimmed = text.trim();
  const store = useStore.getState();
  if (!trimmed || store.chatLoading) return;

  // 新对话开始：解除首页 pin，让后续 artifact 正常进画廊
  const airuiState = useAirUIStore.getState();
  if (airuiState.doc && (airuiState.doc.state as Record<string, unknown>).homePinned) {
    airuiState.applyPatch([{ op: "update-state", stateDelta: { homePinned: false } }]);
  }

  const messages = store.chatMessages;
  store.addChatMessage({ role: "user", content: trimmed });
  store.addChatMessage({ role: "assistant", content: "" });
  store.setChatLoading(true);
  store.setActiveTools([]);
  store.setActiveSkills([]);
  store.addRunEvent({ label: "Request accepted", detail: trimmed.slice(0, 120), state: "running" });

  let assistantContent = "";
  let toolStatuses: ToolStatus[] = [];
  let autoCollapsedThisSession = false;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [...messages, { role: "user", content: trimmed }],
        stream: true,
      }),
    });

    if (!res.ok || !res.body) {
      const detail = `Request failed: ${res.status}`;
      useStore.getState().updateLastMessage({ content: detail });
      useStore.getState().addRunEvent({ label: "Request failed", detail, state: "error" });
      return;
    }

   const reader = res.body.getReader();
   const decoder = new TextDecoder();
   let buffer = "";

   while (true) {
     const { done, value } = await reader.read();
     if (done) break;

     buffer += decoder.decode(value, { stream: true });
     const lines = buffer.split("\n");
     buffer = lines.pop() || "";

     for (const line of lines) {
       if (!line.startsWith("data: ")) continue;
       const evt = JSON.parse(line.slice(6));

        if (evt.type === "skills") {
          useStore.getState().setActiveSkills(evt.skills || []);
          const names = (evt.skills || []).map((skill: { name?: string; slug?: string }) => skill.name || skill.slug);
          if (names.length) {
            useStore.getState().addRunEvent({ label: "Skills selected", detail: names.join(", "), state: "running" });
          }
        }

        if (evt.type === "delta" && evt.content) {
          assistantContent += evt.content;
          useStore.getState().updateLastMessage({ content: assistantContent, toolStatus: toolStatuses });
        }

        if (evt.type === "tool_start") {
          toolStatuses = (evt.tools || []).map((tool: { name: string }) => ({ name: tool.name, state: "running" }));
          useStore.getState().setActiveTools(toolStatuses);
          useStore.getState().updateLastMessage({ content: assistantContent, toolStatus: toolStatuses });
          useStore.getState().addRunEvent({
            label: "Tool call started",
            detail: toolStatuses.map((tool) => tool.name).join(", "),
            state: "running",
          });
        }

        if (evt.type === "tool_result") {
          toolStatuses = toolStatuses.map((tool) =>
            tool.name === evt.name ? { ...tool, state: evt.error ? "error" : "done" } : tool
          );
          useStore.getState().setActiveTools(toolStatuses);
          useStore.getState().updateLastMessage({ content: assistantContent, toolStatus: toolStatuses });
          useStore.getState().addRunEvent({
            label: evt.error ? "Tool call failed" : "Tool call completed",
            detail: evt.name || "unknown",
            state: evt.error ? "error" : "done",
          });
        }

        if (evt.type === "airui" && evt.data) {
          useStore.getState().updateLastMessage({ content: assistantContent, airui: evt.data, toolStatus: toolStatuses });
          if (!autoCollapsedThisSession) {
            autoCollapsedThisSession = true;
            const cfg = useStore.getState().appConfig;
            useStore.getState().setAppConfig({ ui: { ...cfg.ui, chatCollapsed: true } });
          }
        }

        if (evt.type === "config_changed" && evt.config) {
          useStore.getState().setAppConfig(evt.config);
        }

        if (evt.type === "done") {
          useStore.getState().addRunEvent({ label: "Final response", detail: "Assistant response completed.", state: "done" });
          window.dispatchEvent(new CustomEvent("yunsuo:inspector-refresh"));
          // 主动关闭流：某些代理（Vite preview）转发 SSE 时不关闭连接，
          // 导致 reader.read() 永久等待，chatLoading 卡住。
          try { await reader.cancel(); } catch { /* ignore */ }
          return;
        }
      }
    }
  } catch (err) {
    const detail = `Connection failed: ${err}`;
    useStore.getState().updateLastMessage({ content: detail });
    useStore.getState().addRunEvent({ label: "Connection failed", detail, state: "error" });
  } finally {
    useStore.getState().setChatLoading(false);
  }
}

/** 主页 starter 卡片 → prompt 映射。 */
export const HOME_PROMPTS: Record<string, string> = {
  "home:start": "用 KPI 和图表生成一个示例运营看板",
  "home:prompt-dashboard": "用 KPI 和图表生成一个示例运营看板",
  "home:prompt-chart": "渲染一张示例柱状图",
  "home:prompt-table": "生成一个示例数据表格",
  "home:prompt-doc": "用 Markdown 起草一份示例文档",
};
