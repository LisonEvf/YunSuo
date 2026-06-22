import { useCallback, useEffect, useMemo } from "react";
import type { Component } from "@air-ui/core";
import { AirUIComponent, InteractionProvider, useAirUIStore } from "@air-ui/renderer-react";
import { useStore, defaultAgentConfig, type McpServerConfig, type ProviderInstance, type MarketplaceSource } from "../store";
import type { HomeConfig } from "../store";
import { t, messages } from "../i18n";
import { consoleLayout } from "../consoleLayout";
import { registerConsoleComponents, normalizeAirUIComponent, type ArtifactPanel } from "../airui-custom";
import { sendChat, sendInteractionViaChat, HOME_PROMPTS } from "../chat";

// 模块级注册自定义组件（幂等）
registerConsoleComponents();

interface DraftShape {
  ui: { theme: string; language: string };
  home: HomeConfig;
  model: Record<string, unknown>;
  providers: ProviderInstance[];
  active_provider_id: string | null;
  runtime: { max_iterations: number; context_window_tokens: number };
  skills: { enabled: boolean; search_paths: string[] };
  mcp: { enabled: boolean; servers: McpServerConfig[] };
  plugins: { enabled: boolean; search_paths: string[]; marketplaces: MarketplaceSource[] };
  system_prompt: string;
}

// 从后端 artifact 影子文档提取工件面板（ref=row-artifacts 下的 Widget 列表）
function collectArtifactPanels(root: Component | undefined): ArtifactPanel[] {
  if (!root || !Array.isArray(root.children)) return [];
  const row = root.children.find((c) => c?.ref === "row-artifacts");
  const widgets = row?.children ?? [];
  return widgets
    .map((widget, index): ArtifactPanel | null => {
      const ref = String(widget?.ref ?? `artifact-${index}`);
      if (ref === "artifact-empty") return null;
      const inner = widget?.type === "Widget" ? widget?.children?.[0] : widget;
      if (!inner) return null;
      const panel: ArtifactPanel = {
        ref,
        title: String(widget?.props?.title ?? ref),
        component: normalizeAirUIComponent(inner),
        actions: Array.isArray(widget?.props?.actions) ? widget.props.actions : undefined,
        colSpan: typeof widget?.props?.colSpan === "number" ? widget.props.colSpan : undefined,
        rowSpan: typeof widget?.props?.rowSpan === "number" ? widget.props.rowSpan : undefined,
      };
      return panel;
    })
    .filter((p): p is ArtifactPanel => p !== null);
}

function patchConsole(stateDelta: Record<string, unknown>) {
  const store = useAirUIStore.getState();
  if (store.doc) store.applyPatch([{ op: "update-state", stateDelta }]);
}

function openSettings() {
  const cfg = useStore.getState().appConfig;
  patchConsole({
    settingsOpen: true,
    mainVisible: false,
    settingsError: "",
    settingsSection: "domain",
    draft: {
      ui: { theme: cfg.ui.theme, language: cfg.ui.language },
      home: { enabled: cfg.home?.enabled ?? true, title: cfg.home?.title ?? "", subtitle: cfg.home?.subtitle ?? "", starters: (cfg.home?.starters ?? []).map((s) => ({ ...s })), widgets: (cfg.home?.widgets ?? []).map((w) => ({ ...w })) },
      model: { ...cfg.model },
      providers: (cfg.providers ?? []).map((p) => ({ ...p })),
      active_provider_id: cfg.active_provider_id ?? null,
      runtime: { max_iterations: cfg.runtime.max_iterations, context_window_tokens: cfg.runtime.context_window_tokens },
      skills: { enabled: cfg.skills.enabled, search_paths: [...cfg.skills.search_paths] },
      mcp: { enabled: cfg.mcp.enabled, servers: cfg.mcp.servers.map((s) => ({ ...s })) },
      plugins: { enabled: cfg.plugins.enabled, search_paths: [...cfg.plugins.search_paths], marketplaces: (cfg.plugins.marketplaces ?? []).map((m) => ({ ...m })) },
      system_prompt: cfg.system_prompt ?? "",
    } as DraftShape,
  });
  window.dispatchEvent(new CustomEvent("yunsuo:inspector-refresh"));
}

function closeSettings() {
  patchConsole({ settingsOpen: false, mainVisible: true });
}

function backHome() {
  patchConsole({ homePinned: true, artifacts: [], showcaseView: "", wikiCategory: "" });
}

function toggleWiki() {
  const doc = useAirUIStore.getState().doc;
  const view = ((doc?.state as Record<string, unknown> | undefined)?.showcaseView as string) ?? "";
  patchConsole({ showcaseView: view === "wiki" ? "" : "wiki", wikiCategory: "" });
}

function openShowcase(view: string) {
  patchConsole({ showcaseView: view, wikiCategory: "", homePinned: false, artifacts: [] });
}

async function saveSettings() {
  const appStore = useStore.getState();
  const lang = appStore.appConfig.ui.language;
  const draft = (useAirUIStore.getState().doc?.state as Record<string, unknown> | undefined)?.draft as DraftShape | undefined;
  if (!draft) return;
  patchConsole({ settingsSaving: true, settingsError: "" });
  try {
    const current = appStore.appConfig;
    const next = {
      ...current,
      ui: { ...current.ui, ...draft.ui },
      home: draft.home ?? current.home ?? { enabled: true, title: "", subtitle: "", starters: [] },
      model: { ...current.model, ...draft.model },
      providers: draft.providers ?? current.providers ?? [],
      active_provider_id: draft.active_provider_id ?? current.active_provider_id ?? null,
      runtime: {
        ...current.runtime,
        max_iterations: draft.runtime.max_iterations,
        context_window_tokens: draft.runtime.context_window_tokens,
      },
      skills: { ...current.skills, ...draft.skills },
      mcp: { ...current.mcp, ...draft.mcp },
      plugins: { ...current.plugins, ...draft.plugins },
      system_prompt: draft.system_prompt ?? current.system_prompt ?? "",
    };
    const res = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: next }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    const saved = payload?.config ?? next;
    useStore.getState().setAppConfig(saved);
    useStore.getState().addRunEvent({ label: t(lang, "saved"), detail: saved?.model?.name || saved?.model?.provider || "config", state: "done" });
    patchConsole({ settingsSaving: false, settingsOpen: false, mainVisible: true });
  } catch (err) {
    patchConsole({ settingsSaving: false, settingsError: String(err) });
    useStore.getState().addRunEvent({ label: t(lang, "settingsSaveFailed"), detail: String(err), state: "error" });
  }
}

export default function ConsoleView() {
  const airuiDoc = useAirUIStore((s) => s.doc);
  const setAiruiDoc = useAirUIStore((s) => s.setDoc);
  const applyPatch = useAirUIStore((s) => s.applyPatch);

  const language = useStore((s) => s.appConfig.ui.language);
  const connected = useStore((s) => s.connected);
  const activeTools = useStore((s) => s.activeTools);
  const chatLoading = useStore((s) => s.chatLoading);
  const runEvents = useStore((s) => s.runEvents);
  const activeSkills = useStore((s) => s.activeSkills);
  const artifactDoc = useStore((s) => s.doc);
  const chatMessages = useStore((s) => s.chatMessages);
  const setAppConfig = useStore((s) => s.setAppConfig);

  // 初始化预设骨架（首语言文案一并注入，避免首帧模板闪现）
  useEffect(() => {
    if (useAirUIStore.getState().doc) return;
    const lang = useStore.getState().appConfig.ui.language;
    setAiruiDoc({
      ...consoleLayout,
      state: { ...consoleLayout.state, t: messages[lang] ?? messages["en-US"], saveLabel: t(lang, "save") },
    });
  }, [setAiruiDoc]);

  // 文案 / 连接态 / 工具数 / loading 同步（不订阅 airuiDoc，避免与 applyPatch 互触）
  useEffect(() => {
    if (!useAirUIStore.getState().doc) return;
    applyPatch([{
      op: "update-state",
      stateDelta: {
        t: messages[language] ?? messages["en-US"],
        connected,
        connText: connected ? t(language, "connected") : t(language, "disconnected"),
        activeToolsText: `${activeTools.length} ${t(language, "activeTools")}`,
        chatLoading,
        saveLabel: t(language, "save"),
      },
    }]);
  }, [language, connected, activeTools, chatLoading, applyPatch]);

  // active skills / 运行时间线同步，并派生 runDist 供主页 Chart
  useEffect(() => {
    if (!useAirUIStore.getState().doc) return;
    const labels = ["done", "running", "error", "idle"];
    const values = labels.map((s) => runEvents.filter((e) => e.state === s).length);
    applyPatch([{ op: "update-state", stateDelta: { activeSkills, runEvents, runDist: { labels, values } } }]);
  }, [activeSkills, runEvents, applyPatch]);

  // 最近一条带 airui 的消息（稳定引用：流式 delta 期间不变化，避免每 token 重渲染）
 // Most recent assistant turn that produced AIRUI panels. A turn may carry
 // several panels (airuiPanels) -> each becomes its own Bento card. Falls back
 // to the legacy single-component `airui` field for older persisted sessions.
 const lastAiruiMsg = useMemo(
   () => [...chatMessages].reverse().find((m) => m.role === "assistant"),
   [chatMessages]
 );

 const chatArtifacts = useMemo<ArtifactPanel[]>(() => {
   const msg = lastAiruiMsg;
    if (msg?.airuiPanels?.length) {
      return msg.airuiPanels.map((p, i) => ({
        ref: p.ref || `chat-card-${i}`,
        title: p.title || t(language, "latestArtifact"),
        component: normalizeAirUIComponent(p.component),
        actions: p.actions,
        colSpan: p.colSpan,
        rowSpan: p.rowSpan,
      }));
    }
    if (msg?.airui) {
      return [{ ref: "chat-artifact", title: t(language, "latestArtifact"), component: normalizeAirUIComponent(msg.airui) }];
    }
    return [];
  }, [lastAiruiMsg, language]);

  // artifacts 同步：合并后端影子文档面板 + 最近一条聊天 airui（starter 走 chat 通道时由此上主区）
  useEffect(() => {
    if (!useAirUIStore.getState().doc) return;
    // 新对话（仅 welcome 消息）时回到首页，清空画廊
    const isNewSession = chatMessages.length <= 1;
    if (isNewSession) {
      applyPatch([{ op: "update-state", stateDelta: { homePinned: true, artifacts: [], showcaseView: "", wikiCategory: "" } }]);
      return;
    }
    // 画廊更新策略：每轮对话只显示当前轮次的产物，不累积历史。
    // 有 chat 对话时（chatMessages > 1）：画廊完全由 chatArtifacts 驱动
    //   — 当前轮次有 artifact 就显示，没有就清空（不回退到 WS 旧数据）。
    // 无 chat 对话时（预设看板等非 chat 通道）：画廊由 wsPanels 驱动。
    const wsPanels = collectArtifactPanels(artifactDoc?.root);
    const hasChatHistory = chatMessages.length > 1;
    const merged: ArtifactPanel[] = hasChatHistory ? chatArtifacts : wsPanels;
    applyPatch([{ op: "update-state", stateDelta: { artifacts: merged } }]);
  }, [artifactDoc, chatArtifacts, applyPatch, chatMessages]);

  // loadInspector 函数定义
  const loadInspector = useCallback(async () => {
    try {
      const [skillsRes, memoryRes, trajectoriesRes, configRes, mcpRes, pluginsRes] = await Promise.all([
        fetch("/api/skills"),
        fetch("/api/memory/stats"),
        fetch("/api/trajectories/summary"),
        fetch("/api/config"),
        fetch("/api/mcp/status"),
        fetch("/api/plugins"),
      ]);
      const [skills, memory, trajectories, config, mcpStatus, pluginsData] = await Promise.all([
        skillsRes.json(), memoryRes.json(), trajectoriesRes.json(),
        configRes.json(), mcpRes.json(), pluginsRes.json(),
      ]);
      const loaded = config?.config || defaultAgentConfig;
      setAppConfig(loaded);
      const lang = loaded?.ui?.language || language;
      const docState = useAirUIStore.getState().doc;
      if (docState) {
        useAirUIStore.getState().applyPatch([{
          op: "update-state",
          stateDelta: {
            skills: skills.skills || [],
            mcpServers: mcpStatus.servers || [],
            plugins: pluginsData.plugins || [],
            runtime: {
              modelText: loaded?.model?.name || t(lang, "notLoaded"),
              memoryText: `${memory.total || 0} ${t(lang, "entries")}`,
              trajectoriesText: `${trajectories.total || 0} ${t(lang, "samples")}`,
              failedText: `${trajectories.failed || 0}`,
              skillsCountText: String(skills.skills?.length || 0),
            },
          },
        }]);
      }
    } catch {
      // 静默：保留上一次 inspector 数据
    }
  }, [language, setAppConfig]);

  // mount + 语言切换时拉一次（不再定时轮询）
  useEffect(() => { void loadInspector(); }, [loadInspector]);

  // 事件驱动刷新：chat done / 进设置页时触发
  useEffect(() => {
    const handler = () => { void loadInspector(); };
    window.addEventListener("yunsuo:inspector-refresh", handler);
    return () => window.removeEventListener("yunsuo:inspector-refresh", handler);
  }, [loadInspector]);

  const handleInteraction = useCallback((widgetRef: string, interaction: string, payload: Record<string, unknown>) => {
    if (widgetRef === "console:home" && interaction === "click") backHome();
    else if (widgetRef === "console:wiki" && interaction === "click") toggleWiki();
    else if (widgetRef === "showcase:wiki" && interaction === "click") openShowcase("wiki");
    else if (widgetRef === "showcase:stock-sentiment" && interaction === "click") {
      // Trigger the preset stock-sentiment dashboard (no LLM, deterministic).
      const airStore = useAirUIStore.getState();
      useStore.getState().setChatLoading(true);
      fetch("/api/preset/dashboard", { method: "POST" })
        .then((r) => r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)))
        .then(() => {
          useStore.getState().setChatLoading(false);
          if (airStore.doc) airStore.applyPatch([{ op: "update-state", stateDelta: { homePinned: false, showcaseView: "" } }]);
        })
        .catch(() => {
          useStore.getState().setChatLoading(false);
          if (airStore.doc) airStore.applyPatch([{ op: "update-state", stateDelta: { showcaseView: "" } }]);
        });
    }
    else if (widgetRef === "console:settings" && interaction === "click") openSettings();
    else if (widgetRef === "console:cancel" && interaction === "click") closeSettings();
    else if (widgetRef === "console:save" && interaction === "click") void saveSettings();
    else if (widgetRef.startsWith("home:")) {
      const prompt = HOME_PROMPTS[widgetRef];
      if (prompt) void sendChat(prompt);
    } else void sendInteractionViaChat(widgetRef, interaction, payload);
  }, []);

  if (!airuiDoc) return null;

  return (
    <InteractionProvider value={handleInteraction}>
      <AirUIComponent comp={airuiDoc.root} />
    </InteractionProvider>
  );
}
