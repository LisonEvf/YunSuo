import { useStore, type ToolStatus, type ChatArtifactPanel } from "./store";
import type { Component } from "@air-ui/core";
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
  // Accumulate every AIRUI panel emitted this turn so the gallery can render
  // multiple Bento cards from a single response (one per render_airui_panel call).
  let airuiPanels: ChatArtifactPanel[] = [];

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
          // Support two payload shapes: the enriched descriptor
          // { ref, title, col_span, row_span, actions, content } and the legacy
          // raw AIRUI component tree (where the whole object IS the component).
          const d = evt.data as Record<string, unknown>;
          const isDescriptor = "content" in d || "ref" in d || "title" in d;
          const component = (isDescriptor ? d.content : d) as Component;
          const panel: ChatArtifactPanel = {
            ref: String((isDescriptor ? d.ref : "") || `chat-card-${airuiPanels.length + 1}`),
            title: String((isDescriptor ? d.title : "") || ""),
            colSpan: isDescriptor ? (d.col_span as number) ?? (d.colSpan as number) : undefined,
            rowSpan: isDescriptor ? (d.row_span as number) ?? (d.rowSpan as number) : undefined,
            actions: Array.isArray(d.actions) ? (d.actions as ChatArtifactPanel["actions"]) : undefined,
            component,
          };
          airuiPanels = [...airuiPanels, panel];
          useStore.getState().updateLastMessage({
            content: assistantContent,
            airui: component, // legacy field, kept for "has artifact" detection
            airuiPanels,
            toolStatus: toolStatuses,
          });
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

/**
 * Format a UI interaction into a natural-language instruction the agent can act on.
 * This closes the loop: user interacts with a card component -> agent turn -> new UI.
 */
function formatInteractionMessage(
  widgetRef: string,
  interaction: string,
  payload: Record<string, unknown>,
): string {
  const raw = payload || {};
  // The gallery attaches the owning card's ref/title when an inner widget
  // (e.g. a Table) emits without its own ref. Surface them as readable context
  // and strip them so they don't clutter the data dump below.
  const cardTitle = typeof raw._cardTitle === "string" ? raw._cardTitle : "";
  const p: Record<string, unknown> = { ...raw };
  delete p._cardTitle;
  delete p._cardRef;
  const ctx = cardTitle ? ` on card "${cardTitle}"` : "";
  switch (interaction) {
    case "drilldown": {
      const row = p.row ?? p.data ?? p.item;
      const idx = p.index;
      const rowStr = row ? JSON.stringify(row) : "";
      return idx != null
        ? `User drilled into row ${idx} of "${widgetRef}"${ctx}${rowStr ? `: ${rowStr}` : ""}. Show detailed information for this selection.`
        : `User drilled into "${widgetRef}"${ctx}${rowStr ? `: ${rowStr}` : ""}. Show detailed information.`;
    }
    case "click": {
      const label = p.label ?? p.key ?? p.name;
      return `User clicked "${label ?? widgetRef}" on component "${widgetRef}"${ctx}.`;
    }
    case "change": {
      const val = p.value ?? p.checked;
      return `User changed "${widgetRef}"${ctx}${val !== undefined ? ` to ${JSON.stringify(val)}` : ""}.`;
    }
    case "select": {
      const val = p.value ?? p.key ?? p.tab ?? p.node ?? p.date ?? p.item;
      return `User selected ${val !== undefined ? JSON.stringify(val) : "an item"} from "${widgetRef}"${ctx}.`;
    }
    case "rowClick": {
      const row = p.row;
      return `User clicked row ${p.index ?? ""} of "${widgetRef}"${ctx}${row ? `: ${JSON.stringify(row)}` : ""}.`;
    }
    case "filter": {
      return `User filtered "${widgetRef}"${ctx} with query: ${JSON.stringify(p.query ?? "")}.`;
    }
    case "search": {
      return `User searched "${widgetRef}"${ctx} for: ${JSON.stringify(p.query ?? "")}.`;
    }
    case "action": {
      return `User triggered the action button on "${widgetRef}"${ctx}.`;
    }
    default: {
      const dataStr = Object.keys(p).length ? ` Data: ${JSON.stringify(p)}` : "";
      return `User interacted with component "${widgetRef}" (${interaction})${ctx}.${dataStr}`;
    }
  }
}

/**
 * Send a UI interaction through the agent chat flow (SSE streaming).
 * This is the closed-loop bridge: clicking a component inside a card triggers
 * a new agent turn that can generate updated/new UI.
 */
export async function sendInteractionViaChat(
  widgetRef: string,
  interaction: string,
  payload: Record<string, unknown> = {},
) {
  const message = formatInteractionMessage(widgetRef, interaction, payload);
  await sendChat(message);
}
