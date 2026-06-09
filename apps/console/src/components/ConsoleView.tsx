import { useCallback, useEffect, useMemo } from "react";
import type { Component } from "@air-ui/core";
import { AirUIComponent, InteractionProvider, useAirUIStore } from "@air-ui/renderer-react";
import { useStore, defaultAgentConfig, type McpServerConfig, type ProviderInstance, type MarketplaceSource } from "../store";
import { t, messages } from "../i18n";
import { sendInteraction } from "../ws-client";
import { consoleLayout } from "../consoleLayout";
import { registerConsoleComponents, normalizeAirUIComponent, type ArtifactPanel } from "../airui-custom";
import { sendChat, HOME_PROMPTS } from "../chat";

// 模块级注册自定义组件（幂等）
registerConsoleComponents();

interface DraftShape {
  ui: { theme: string; language: string };
  model: Record<string, unknown>;
  providers: ProviderInstance[];
  active_provider_id: string | null;
  runtime: { max_iterations: number; context_window_tokens: number };
  skills: { enabled: boolean; search_paths: string[] };
  mcp: { enabled: boolean; servers: McpServerConfig[] };
  plugins: { enabled: boolean; search_paths: string[]; marketplaces: MarketplaceSource[] };
}

// 从后端 artifact 影子文档提取工件面板（ref=row-artifacts 下的 Widget 列表）
function collectArtifactPanels(root: Component | undefined): ArtifactPanel[] {
  if (!root || !Array.isArray(root.children)) return [];
  const row = root.children.find((c) => c?.ref === "row-artifacts");
  const widgets = row?.children ?? [];
  return widgets
    .map((widget, index) => {
      const ref = String(widget?.ref ?? `artifact-${index}`);
      if (ref === "artifact-empty") return null;
      const inner = widget?.type === "Widget" ? widget?.children?.[0] : widget;
      if (!inner) return null;
      return { ref, title: String(widget?.props?.title ?? ref), component: normalizeAirUIComponent(inner) };
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
    draft: {
      ui: { theme: cfg.ui.theme, language: cfg.ui.language },
      model: { ...cfg.model },
      providers: (cfg.providers ?? []).map((p) => ({ ...p })),
      active_provider_id: cfg.active_provider_id ?? null,
      runtime: { max_iterations: cfg.runtime.max_iterations, context_window_tokens: cfg.runtime.context_window_tokens },
      skills: { enabled: cfg.skills.enabled, search_paths: [...cfg.skills.search_paths] },
      mcp: { enabled: cfg.mcp.enabled, servers: cfg.mcp.servers.map((s) => ({ ...s })) },
      plugins: { enabled: cfg.plugins.enabled, search_paths: [...cfg.plugins.search_paths], marketplaces: (cfg.plugins.marketplaces ?? []).map((m) => ({ ...m })) },
    } as DraftShape,
  });
}

function closeSettings() {
  patchConsole({ settingsOpen: false, mainVisible: true });
}

function backHome() {
  patchConsole({ homePinned: true, artifacts: [], wikiOpen: false, wikiCategory: "" });
}

function toggleWiki() {
  const doc = useAirUIStore.getState().doc;
  const open = ((doc?.state as Record<string, unknown> | undefined)?.wikiOpen as boolean) ?? false;
  patchConsole({ wikiOpen: !open, wikiCategory: "" });
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
  const lastAiruiComp = useMemo(
    () => [...chatMessages].reverse().find((m) => m.airui)?.airui,
    [chatMessages]
  );

  // artifacts 同步：合并后端影子文档面板 + 最近一条聊天 airui（starter 走 chat 通道时由此上主区）
  useEffect(() => {
    if (!useAirUIStore.getState().doc) return;
    const wsPanels = collectArtifactPanels(artifactDoc?.root);
    const chatPanel = lastAiruiComp
      ? [{ ref: "chat-artifact", title: t(language, "latestArtifact"), component: normalizeAirUIComponent(lastAiruiComp) }]
      : [];
    applyPatch([{ op: "update-state", stateDelta: { artifacts: [...wsPanels, ...chatPanel] } }]);
  }, [artifactDoc, lastAiruiComp, language, applyPatch]);

  // REST 轮询：runtime KPI + 全部 skills + agent config
  useEffect(() => {
    let cancelled = false;
    async function loadInspector() {
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
          skillsRes.json(),
          memoryRes.json(),
          trajectoriesRes.json(),
          configRes.json(),
          mcpRes.json(),
          pluginsRes.json(),
        ]);
        if (cancelled) return;
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
    }
    loadInspector();
    const timer = window.setInterval(loadInspector, 15000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [language, setAppConfig]);

  const handleInteraction = useCallback((widgetRef: string, interaction: string, payload: Record<string, unknown>) => {
    if (widgetRef === "console:home" && interaction === "click") backHome();
    else if (widgetRef === "console:wiki" && interaction === "click") toggleWiki();
    else if (widgetRef === "console:settings" && interaction === "click") openSettings();
    else if (widgetRef === "console:cancel" && interaction === "click") closeSettings();
    else if (widgetRef === "console:save" && interaction === "click") void saveSettings();
    else if (widgetRef.startsWith("home:")) {
      const prompt = HOME_PROMPTS[widgetRef];
      if (prompt) void sendChat(prompt);
    } else sendInteraction(widgetRef, interaction, payload);
  }, []);

  if (!airuiDoc) return null;

  return (
    <InteractionProvider value={handleInteraction}>
      <AirUIComponent comp={airuiDoc.root} />
    </InteractionProvider>
  );
}
