import { type FC, type CSSProperties, useState, useEffect } from "react";
import type { Component } from "@air-ui/core";
import { AirUIComponent, useAirUIStore } from "@air-ui/renderer-react";
import { useInteraction } from "@air-ui/renderer-react";
import { useStore } from "../store";
import { sendChat } from "../chat";
import { type McpToolLite, type McpServerLite, type ArtifactPanel } from "./helpers";
import type { HomeStarter, HomeWidget } from "../store";
import { removeNodeByRef, savePreset, listPresets, deletePreset, type UIPreset } from "./presets";
import { listPanels, runPanel, deletePanel, listFlows, runFlow, deleteFlow, type Panel, type Flow } from "../panels";
import Icon from "../components/Icon";
import { showToast } from "../components/Toast";
import PromptModal from "../components/PromptModal";

/* Legacy AIRUI preset skeleton 鈥?superseded by CapabilityHome, kept for import stability. */
export const homeLayout: Component = {
  type: "Pane",
  props: { className: "home-view", direction: "column", gap: "large" },
  children: [],
};

/* Shared Morandi bento styles. */
const heroStyle: CSSProperties = { position: "relative", overflow: "hidden", padding: "30px 32px", borderRadius: "var(--radius-card-lg)", border: "1px solid var(--color-border)", background: "radial-gradient(120% 140% at 88% -20%, var(--color-primary-soft) 0%, transparent 55%), linear-gradient(135deg, var(--color-surface) 0%, var(--color-surface-muted) 100%)", boxShadow: "var(--air-shadow)", display: "flex", flexDirection: "column", gap: "var(--space-md)" };
const cardTitleStyle: CSSProperties = { fontSize: 13, fontWeight: 700, color: "var(--color-text)", letterSpacing: "-0.01em", display: "flex", alignItems: "center", gap: 8 };
const accentBar: CSSProperties = { width: 3, height: 14, borderRadius: 2, background: "var(--color-primary)" };
const sectionTitleStyle: CSSProperties = { fontSize: 15, fontWeight: 700, color: "var(--color-text)", letterSpacing: "-0.015em" };
const captionStyle: CSSProperties = { fontSize: 12, color: "var(--color-muted)", lineHeight: 1.55 };
const rowStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "9px 0", borderBottom: "1px solid var(--air-borderLight)", fontSize: 12 };
const rowNameStyle: CSSProperties = { fontWeight: 600, color: "var(--color-text)" };
const rowDescStyle: CSSProperties = { color: "var(--color-muted)", fontSize: 11, textAlign: "right" as const };
const pillGhostStyle: CSSProperties = { height: 34, padding: "0 16px", borderRadius: "var(--radius-pill)", border: "1px solid var(--color-primary-border)", background: "transparent", color: "var(--color-primary-strong)", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 };

/** MCP tool click: fire chat directly when no required params, else open the param form. */
async function handleMcpToolClick(srvIdx: number, toolIdx: number) {
  const state = (useAirUIStore.getState().doc?.state ?? {}) as Record<string, unknown>;
  const servers = (state.mcpServers as McpServerLite[]) ?? [];
  const srv = servers[srvIdx];
  const tool = srv?.tools?.[toolIdx];
  if (!srv?.name || !tool?.name) return;
  const prefixedName = `mcp_${srv.name}_${tool.name}`;
  const required = tool.inputSchema?.required ?? [];
  if (required.length === 0) {
    void sendChat(`璇疯皟鐢ㄥ伐鍏?${prefixedName}`);
  } else {
    useStore.getState().setMcpToolForm({
      prefixedName,
      toolName: tool.name,
      properties: tool.inputSchema?.properties ?? {},
      required,
    });
  }
}

/* 鈹€鈹€ Capability-aware home: Bento Grid layout 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */

/* Customizable domain launcher home. Renders when home.starters is non-empty:
 * the hero uses the configured title/subtitle, and each starter is a one-click
 * card that fires sendChat(prompt) 鈥?the entry point of the closed UI loop. */
const starterCardStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, padding: "18px 18px", borderRadius: "var(--radius-card)", border: "1px solid var(--color-border)", background: "var(--color-surface)", boxShadow: "var(--air-shadow)", cursor: "pointer", textAlign: "left", transition: "transform .15s, box-shadow .15s, border-color .15s" };
const starterLabelStyle: CSSProperties = { fontSize: 14, fontWeight: 700, color: "var(--color-text)", letterSpacing: "-0.01em" };
const starterHintStyle: CSSProperties = { fontSize: 11, color: "var(--color-muted)", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" };

/* 鈹€鈹€ Live home widgets: MCP-backed data cards 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */

/** One widget resolved by the backend into a concrete AIRUI component. */
interface ResolvedHomeWidget {
  ref: string;
  title?: string;
  colSpan?: number;
  component: Component;
  actions?: { label: string; prompt: string; variant?: string }[];
}

/* Map a 1-12 colSpan onto the responsive bento classes that actually exist. */
const bentoColClass = (span?: number): string => {
  const s = span ?? 6;
  if (s >= 10) return "bento-col-12";
  if (s >= 8) return "bento-col-8";
  if (s >= 5) return "bento-col-6";
  if (s >= 3) return "bento-col-4";
  return "bento-col-3";
};

const widgetActionPrimary: CSSProperties = { height: 30, padding: "0 14px", borderRadius: "var(--radius-pill)", border: "1px solid var(--color-primary)", background: "var(--color-primary)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" };
const widgetActionGhost: CSSProperties = { height: 30, padding: "0 14px", borderRadius: "var(--radius-pill)", border: "1px solid var(--color-primary-border)", background: "transparent", color: "var(--color-primary-strong)", fontSize: 12, fontWeight: 600, cursor: "pointer" };

/** A single live-data card: title bar + resolved component + action buttons
 *  that close the UI loop via sendChat. */
const LiveWidgetCard: FC<{ widget: ResolvedHomeWidget; loading?: boolean }> = ({ widget, loading }) => {
  const actions = widget.actions ?? [];
  return (
    <div className={"m-card " + bentoColClass(widget.colSpan)} style={{ gap: 12, overflow: "hidden", minWidth: 0 }}>
      {widget.title && (
        <div style={{ ...cardTitleStyle, flexShrink: 0 }}>
          <span style={accentBar} />{widget.title}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, opacity: loading ? 0.45 : 1 }}>
        <AirUIComponent comp={widget.component} />
      </div>
      {actions.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flexShrink: 0 }}>
          {actions.map((a, i) => (
            <button key={i} onClick={() => void sendChat(a.prompt)} style={a.variant === "primary" ? widgetActionPrimary : widgetActionGhost}>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const CustomHome: FC<{ starters: HomeStarter[]; widgets?: HomeWidget[]; title: string; subtitle: string }> = ({ starters, widgets, title, subtitle }) => {
  const doc = useAirUIStore((s) => s.doc);
  const t = ((doc?.state as Record<string, unknown> | undefined)?.t as Record<string, string>) || {};
  const emit = useInteraction();
  const run = (s: HomeStarter) => { void sendChat(s.prompt); };

  /* A starter with a `preset` renders a deterministic live dashboard from MCP
   *  data (no LLM) via POST /api/preset/dashboard, then shows the gallery. The
   *  chat prompt is the fallback if the endpoint errors or is missing. */
  const runPreset = (s: HomeStarter) => {
    if (!s.preset) { void sendChat(s.prompt); return; }
    useStore.getState().setChatLoading(true);
    fetch("/api/preset/dashboard", { method: "POST" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
      .then(() => {
        useStore.getState().setChatLoading(false);
        const airStore = useAirUIStore.getState();
        if (airStore.doc) airStore.applyPatch([{ op: "update-state", stateDelta: { homePinned: false } }]);
      })
      .catch(() => { useStore.getState().setChatLoading(false); void sendChat(s.prompt); });
  };

  /* Resolve live widgets once per configuration. The backend calls each MCP
   *  tool directly (no LLM) and returns AIRUI components for Table/KPI/Text. */
  const [live, setLive] = useState<ResolvedHomeWidget[]>([]);
  const [loadingWidgets, setLoadingWidgets] = useState(false);
  const widgetSig = JSON.stringify(widgets ?? []);
  useEffect(() => {
    let cancelled = false;
    if (!widgets || widgets.length === 0) { setLive([]); return; }
    setLoadingWidgets(true);
    fetch("/api/home/widgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ widgets }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
      .then((data) => {
        if (cancelled) return;
        setLive(Array.isArray(data?.widgets) ? (data.widgets as ResolvedHomeWidget[]) : []);
      })
      .catch(() => { if (!cancelled) setLive([]); })
      .finally(() => { if (!cancelled) setLoadingWidgets(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgetSig]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
      <div className="bento-hero">
        <div className="bento-hero-glow" />
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--color-text)", letterSpacing: "-0.02em" }}>{title || t.homeWelcome}</div>
          {subtitle && <div style={{ ...captionStyle, maxWidth: 620 }}>{subtitle}</div>}
        </div>
      </div>
      {live.length > 0 && (
        <div className="bento-grid">
          {live.map((w) => (
            <LiveWidgetCard key={w.ref} widget={w} loading={loadingWidgets} />
          ))}
        </div>
      )}
      <div className="bento-grid">
        {starters.map((s, i) => {
          const primary = s.variant === "primary";
          return (
         <button
           key={i}
           onClick={() => (s.preset ? runPreset(s) : run(s))}
              className="m-card m-card-hover"
              style={{
                ...starterCardStyle,
                borderColor: primary ? "var(--color-primary-border)" : starterCardStyle.borderColor,
                background: primary ? "radial-gradient(120% 140% at 90% -20%, var(--color-primary-soft) 0%, transparent 60%), var(--color-surface)" : starterCardStyle.background,
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {primary && <span style={{ width: 3, height: 14, borderRadius: 2, background: "var(--color-primary)" }} />}
                <span style={starterLabelStyle}>{s.label}</span>
              </span>
              <span style={starterHintStyle}>{s.prompt}</span>
            </button>
          );
        })}
      </div>
      <PanelLibrarySection />
    </div>
  );
};

/** 面板库区块 —— 自包含组件，在 CapabilityHome 与 CustomHome 都渲染，
 *  让外行用户无论是否配置自定义首页都能看到/运行内置预设与自定义面板。 */
const PanelLibrarySection: FC = () => {
  const [panels, setPanels] = useState<Panel[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const refreshPanels = () => { void listPanels().then(setPanels); };
  const refreshFlows = () => { void listFlows().then(setFlows); };
  useEffect(() => { refreshPanels(); refreshFlows(); }, []);
  useEffect(() => {
    const h = () => { refreshPanels(); refreshFlows(); };
    window.addEventListener("yunsuo:inspector-refresh", h);
    return () => window.removeEventListener("yunsuo:inspector-refresh", h);
  }, []);
  if (panels.length === 0 && flows.length === 0) return null;
  return (
    <>
      {panels.length > 0 && (
        <div className="bento-grid">
          <div className="bento-col-12 m-card">
            <div style={cardTitleStyle}><span style={accentBar} />我的面板<span className="m-card-count">{panels.length}</span></div>
            <div className="m-card-list">
              {panels.map((p) => (
                <div key={p.id} style={{ ...rowStyle, alignItems: "center" }}>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
                    <span style={rowNameStyle}>
                      {p.name}
                      {p.is_builtin ? <span style={{ color: "var(--color-primary)", fontSize: 10, marginLeft: 8, fontWeight: 700 }}>内置</span> : null}
                      {p.mcp_tools && p.mcp_tools.length > 0 ? <span style={{ color: "var(--color-primary)", fontSize: 10, marginLeft: 8 }}>`{p.mcp_tools.length}</span> : null}
                    </span>
                    <span style={rowDescStyle}>{p.description || p.starter_prompt.slice(0, 60)}</span>
                  </span>
                  <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button onClick={() => { void runPanel(p.id).then((r) => { if (r) void sendChat(r.starter_prompt); }); }} style={{ padding: "4px 12px", fontSize: 12, fontWeight: 600, borderRadius: "var(--radius-pill)", cursor: "pointer", border: "1px solid var(--color-primary)", background: "var(--color-primary)", color: "#fff" }}>运行</button>
                    {!p.is_builtin && <button onClick={() => { if (window.confirm(`删除面板「{p.name}」？`)) { void deletePanel(p.id).then(refreshPanels); } }} style={{ padding: "4px 10px", fontSize: 12, borderRadius: "var(--radius-pill)", cursor: "pointer", border: "1px solid var(--color-border)", background: "transparent", color: "var(--color-muted)" }}>删除</button>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {flows.length > 0 && (
        <div className="bento-grid">
          <div className="bento-col-12 m-card">
            <div style={cardTitleStyle}><span style={accentBar} />我的流程<span className="m-card-count">{flows.length}</span></div>
            <div className="m-card-list">
              {flows.map((f) => (
                <div key={f.id} style={{ ...rowStyle, alignItems: "center" }}>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
                    <span style={rowNameStyle}>{f.name}<span style={{ color: "var(--color-muted)", fontSize: 11, marginLeft: 8 }}>{f.steps.length} 步</span></span>
                    <span style={rowDescStyle}>{f.description || f.steps.map((s) => s.label).join(" → ")}</span>
                  </span>
                  <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button onClick={() => { void (async () => { const r = await runFlow(f.id); if (!r) return; for (const step of r.steps) { if (step.prompt) await sendChat(step.prompt); } })(); }} style={{ padding: "4px 12px", fontSize: 12, fontWeight: 600, borderRadius: "var(--radius-pill)", cursor: "pointer", border: "1px solid var(--color-primary)", background: "var(--color-primary)", color: "#fff" }}>运行</button>
                    <button onClick={() => { if (window.confirm(`删除流程「{f.name}」？`)) { void deleteFlow(f.id).then(refreshFlows); } }} style={{ padding: "4px 10px", fontSize: 12, borderRadius: "var(--radius-pill)", cursor: "pointer", border: "1px solid var(--color-border)", background: "transparent", color: "var(--color-muted)" }}>删除</button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
export const CapabilityHome: FC = () => {
  const doc = useAirUIStore((s) => s.doc);
  const setDoc = useAirUIStore((s) => s.setDoc);
  const state = (doc?.state ?? {}) as Record<string, unknown>;
  const t = (state.t as Record<string, string>) || {};
  const emit = useInteraction();
  const skills = (state.skills as Array<{ name?: string; description?: string }>) ?? [];
  const mcpServers = (state.mcpServers as Array<{ name?: string; connected?: boolean; tools?: Array<{ name?: string; description?: string }> }>) ?? [];
  const plugins = (state.plugins as Array<{ name?: string; path?: string }>) ?? [];
 const runtime = (state.runtime as { modelText?: string; skillsCountText?: string; memoryText?: string; failedText?: string; trajectoriesText?: string }) ?? {};
const [presets, setPresets] = useState<UIPreset[]>(() => listPresets());
useEffect(() => {
  const handler = () => setPresets(listPresets());
  window.addEventListener("presets-changed", handler);
  return () => window.removeEventListener("presets-changed", handler);
}, []);
 const hasAny = skills.length > 0 || mcpServers.length > 0 || plugins.length > 0 || presets.length > 0;
  // Customizable start page: a configured domain launcher takes precedence
  // over the generic capability home, making the UI 鈥?not chat 鈥?the entry.
  // (kept after all hooks so hook order is stable across renders)
 const homeCfg = useStore((s) => s.appConfig.home);
  const homeStarters = Array.isArray(homeCfg?.starters) ? homeCfg.starters : [];
  const homeWidgets = homeCfg?.widgets ?? [];
  if (homeCfg?.enabled !== false && (homeStarters.length > 0 || homeWidgets.length > 0)) {
    return <CustomHome starters={homeStarters} widgets={homeWidgets} title={homeCfg.title} subtitle={homeCfg.subtitle} />;
  }

 const insertPreset = (preset: UIPreset) => {
    if (!doc) return;
    const artifacts = ((state.artifacts as ArtifactPanel[]) ?? []);
    const newArtifact: ArtifactPanel = {
      ref: `preset-${Date.now()}`,
      title: preset.title || preset.name,
      component: preset.component,
    };
    setDoc({ ...doc, state: { ...state, artifacts: [...artifacts, newArtifact], homePinned: false } });
  };

  if (!hasAny) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
        <div style={heroStyle}>
          <div className="bento-hero-glow" />
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--color-text)", letterSpacing: "-0.02em" }}>{t.homeWelcome}</div>
          <div style={{ ...captionStyle, maxWidth: 540 }}>{t.homeSubtitle}</div>
          <AirUIComponent comp={{ type: "Button", ref: "home:start", props: { label: t.homeStart, variant: "primary" } }} />
        </div>
        <div className="bento-grid">
          <div className="bento-col-12 m-card" style={{ alignItems: "center", gap: 12, padding: "40px 24px", textAlign: "center" }}>
            <Icon name="puzzle" size={40} className="home-empty-icon" />
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text)" }}>{t.noCapabilityTitle}</div>
            <div style={{ ...captionStyle, maxWidth: 420 }}>{t.noCapabilityDesc}</div>
            <AirUIComponent comp={{ type: "Button", ref: "console:settings", props: { label: t.openSettings, variant: "primary" } }} />
          </div>
        </div>
      </div>
    );
  }

  const halfCol = (other: boolean) => (other ? "bento-col-6 m-card m-card-hover" : "bento-col-12 m-card m-card-hover");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
      {/* (1) Hero 鈥?full-width lavender glow */}
      <div className="bento-hero">
        <div className="bento-hero-glow" />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "var(--space-lg)", flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--color-text)", letterSpacing: "-0.02em" }}>{t.capaoilityTitle || t.homeWelcome}</div>
            <div style={{ ...captionStyle, maxWidth: 520 }}>{t.homeSubtitle}</div>
          </div>
          <AirUIComponent comp={{ type: "Button", ref: "home:start", props: { label: t.homeStart, variant: "primary" } }} />
        </div>
      </div>

      {/* (2) Live Status 鈥?four KPI bento tiles */}
      <div className="bento-grid">
        <div className="bento-col-3 m-card">
          <span className="m-stat-label">{t.model}</span>
          <span className="m-stat-num">{runtime.modelText || "-"}</span>
        </div>
        <div className="bento-col-3 m-card">
          <span className="m-stat-label">{t.activeSkills}</span>
          <span className="m-stat-num">{runtime.skillsCountText || "0"}</span>
        </div>
        <div className="bento-col-3 m-card">
          <span className="m-stat-label">{t.memory}</span>
          <span className="m-stat-num">{runtime.memoryText || "0 " + (t.entries || "")}</span>
        </div>
        <div className="bento-col-3 m-card">
          <span className="m-stat-label">{t.failures}</span>
        <span className="m-stat-num" style={{ color: runtime.failedText && runtime.failedText !== "0" ? "var(--color-danger)" : "var(--color-text)" }}>{runtime.failedText || "0"}</span>
       </div>
     </div>

     {/* (2b) Showcase templates: component gallery + stock sentiment */}
     <div className="bento-grid">
       <button
         onClick={() => emit("showcase:wiki", "click", {})}
         className="bento-col-6 m-card m-card-hover"
         style={{ ...starterCardStyle, cursor: "pointer" }}
       >
         <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
           <Icon name="layout" size={16} />
           <span style={starterLabelStyle}>{t.showcaseGallery || "Component Gallery"}</span>
         </span>
         <span style={starterHintStyle}>{t.showcaseGalleryDesc || "Browse and interact with AIRUI built-in components."}</span>
       </button>
       <button
         onClick={() => emit("showcase:stock-sentiment", "click", {})}
         className="bento-col-6 m-card m-card-hover"
         style={{ ...starterCardStyle, cursor: "pointer", borderColor: "var(--color-primary-border)", background: "radial-gradient(120% 140% at 90% -20%, var(--color-primary-soft) 0%, transparent 60%), var(--color-surface)" }}
       >
         <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
           <Icon name="bolt" size={16} />
           <span style={starterLabelStyle}>{t.stockSentimentTitle || "A-Share Sentiment"}</span>
         </span>
         <span style={starterHintStyle}>{t.stockSentimentDesc || "Pull live market data and render sentiment KPIs."}</span>
     </button>
   </div>

   <PanelLibrarySection />

{/* (3) Capability body: skills / MCP */}
      <div className="bento-grid">
       {skills.length > 0 && (
         <div className={halfCol(mcpServers.length > 0)}>
            <div style={cardTitleStyle}><span style={accentBar} />{t.skills}{skills.length > 6 && <span className="m-card-count">{skills.length}</span>}</div>
            <div className="m-card-list">
              {skills.map((s, i) => (
                <div key={i} style={rowStyle}>
                  <span style={rowNameStyle}>{s.name}</span>
                  <span style={rowDescStyle}>{s.description}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {mcpServers.length > 0 && (
          <div className={halfCol(skills.length > 0)}>
            <div style={cardTitleStyle}><span style={accentBar} />{t.mcp}{(() => { const toolTotal = mcpServers.reduce((n, s) => n + (s.tools?.length || 0), 0); return toolTotal > 0 ? <span className="m-card-count">{toolTotal}</span> : null; })()}</div>
            <div className="m-card-list">
              {mcpServers.map((srv, i) => {
                const tools = srv.tools || [];
                return (
                  <div key={i} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <div style={rowStyle}>
                      <span style={rowNameStyle}>{srv.name}</span>
                      <span style={rowDescStyle}>{srv.connected ? `${t.connected} \u00b7 ${tools.length} ${t.tools || ""}` : t.disconnected}</span>
                    </div>
                    {tools.map((tool, j) => {
                      const required = ((tool as McpToolLite).inputSchema?.required) ?? [];
                      const hasParams = required.length > 0;
                      return (
                        <button
                          key={j}
                          onClick={() => { void handleMcpToolClick(i, j); }}
                          className={`m-tool-btn${hasParams ? "" : " m-tool-btn-quick"}`}
                          title={hasParams ? `${tool.name} (params)` : `${tool.name}锛堜竴閿墽琛岋級`}
                          aria-label={tool.name}
                        >
                          <span style={{ display: "flex", alignItems: "center", gap: 5, fontWeight: 500 }}>
                            <Icon name="chevronRight" size={11} />
                            {tool.name}{hasParams ? ` \u00b7 ${t.toolParams || "鍙傛暟"}` : <Icon name="bolt" size={11} />}
                          </span>
                          <span style={rowDescStyle}>{tool.description}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* (4) Plugins + presets */}
      {(plugins.length > 0 || presets.length > 0) && (
        <div className="bento-grid">
         {plugins.length > 0 && (
           <div className={halfCol(presets.length > 0)}>
              <div style={cardTitleStyle}><span style={accentBar} />{t.plugins}{plugins.length > 6 && <span className="m-card-count">{plugins.length}</span>}</div>
              <div className="m-card-list">
                {plugins.map((p, i) => (
                  <div key={i} style={rowStyle}>
                    <span style={rowNameStyle}>{p.name}</span>
                    <span style={rowDescStyle}>{p.path}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {presets.length > 0 && (
            <div className={halfCol(plugins.length > 0)}>
              <div style={cardTitleStyle}><span style={accentBar} />{t.myPresets}</div>
              <div className="m-card-list">
                {presets.map((p) => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--air-borderLight)" }}>
                    <button onClick={() => insertPreset(p)} style={{ flex: 1, background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", justifyContent: "space-between", gap: 10, textAlign: "left" }}>
                      <span style={rowNameStyle}>{p.name}</span>
                      <span style={rowDescStyle}>{p.title || ""}</span>
                    </button>
                    <button onClick={() => deletePreset(p.id)} title={t.deletePreset} aria-label={t.deletePreset} style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-surface-muted)", color: "var(--color-danger)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="close" size={12} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* 鈹€鈹€ AIRUI Wiki: bento category grid 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ */

interface WikiEntry { name: string; demo: Component }
interface WikiCategory { key: string; labelKey: string; components: WikiEntry[] }

const WIKI_CATEGORIES: WikiCategory[] = [
  {
    key: "data", labelKey: "wikiCatData",
    components: [
      { name: "Table", demo: { type: "Table", props: { columns: [{ key: "name", label: "Name" }, { key: "age", label: "Age" }], data: [{ name: "Alice", age: 28 }, { name: "Bob", age: 34 }] } } },
      { name: "KPI", demo: { type: "KPI", props: { label: "Active Users", value: "12,345" } } },
      { name: "Chart", demo: { type: "Chart", props: { type: "bar", data: { labels: ["Mon", "Tue", "Wed", "Thu"], values: [3, 5, 2, 7] } } } },
      { name: "Progress", demo: { type: "Progress", props: { value: 65 } } },
      { name: "Badge", demo: { type: "Badge", props: { text: "New" } } },
    ],
  },
  {
    key: "form", labelKey: "wikiCatForm",
    components: [
      { name: "Input", demo: { type: "Input", props: { placeholder: "Enter text" } } },
      { name: "Select", demo: { type: "Select", props: { options: [{ value: "a", label: "Option A" }, { value: "b", label: "Option B" }] } } },
      { name: "Switch", demo: { type: "Switch", props: { checked: true } } },
      { name: "Slider", demo: { type: "Slider", props: { value: 40, min: 0, max: 100 } } },
      { name: "Checkbox", demo: { type: "Checkbox", props: { checked: true, label: "I agree" } } },
    ],
  },
  {
    key: "layout", labelKey: "wikiCatLayout",
    components: [
      { name: "Tabs", demo: { type: "Tabs", props: { tabs: [{ label: "Tab 1" }, { label: "Tab 2" }, { label: "Tab 3" }] } } },
      { name: "Card", demo: { type: "Widget", props: { title: "Card Title" }, children: [{ type: "Text", props: { value: "Card content" } }] } },
      { name: "Accordion", demo: { type: "Accordion", props: { items: [{ title: "Section 1", content: "Content 1" }, { title: "Section 2", content: "Content 2" }] } } },
      { name: "Divider", demo: { type: "Divider" } },
    ],
  },
  {
    key: "feedback", labelKey: "wikiCatFeedback",
    components: [
      { name: "Alert", demo: { type: "Alert", props: { variant: "info", text: "This is an info alert." } } },
      { name: "Progress", demo: { type: "Progress", props: { value: 30 } } },
      { name: "Tooltip", demo: { type: "Tooltip", props: { text: "Hover tooltip" } } },
      { name: "Loading", demo: { type: "Loading" } },
    ],
  },
  {
    key: "content", labelKey: "wikiCatContent",
    components: [
      { name: "Markdown", demo: { type: "Markdown", props: { content: "# Heading\n\n**Bold** and *italic*\n\n- Item one\n- Item two" } } },
      { name: "CodeBlock", demo: { type: "CodeBlock", props: { code: "const sum = (a, b) => a + b;", language: "ts" } } },
      { name: "Text", demo: { type: "Text", props: { value: "Body text (style: body)", style: "body" } } },
      { name: "Image", demo: { type: "Image", props: { src: "https://placehold.co/240x80", alt: "demo" } } },
    ],
  },
  {
    key: "nav", labelKey: "wikiCatNav",
    components: [
      { name: "Steps", demo: { type: "Steps", props: { current: 1, steps: [{ title: "Step 1" }, { title: "Step 2" }, { title: "Step 3" }] } } },
      { name: "Breadcrumb", demo: { type: "Breadcrumb", props: { items: [{ label: "Home" }, { label: "Category" }, { label: "Current" }] } } },
      { name: "Pagination", demo: { type: "Pagination", props: { total: 50, current: 1 } } },
      { name: "Timeline", demo: { type: "Timeline", props: { items: [{ title: "Event A", time: "09:00" }, { title: "Event B", time: "10:30" }] } } },
    ],
  },
];

export const WikiHome: FC = () => {
  const doc = useAirUIStore((s) => s.doc);
  const state = (doc?.state ?? {}) as Record<string, unknown>;
  const t = (state.t as Record<string, string>) || {};
  const category = (state.wikiCategory as string) || "";

  const setCategory = (c: string) => {
    const st = useAirUIStore.getState();
    if (st.doc) st.applyPatch([{ op: "update-state", stateDelta: { wikiCategory: c } }]);
  };

  if (!category) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={sectionTitleStyle}>{t.wikiTitle}</div>
          <div style={captionStyle}>{t.wikiSubtitle}</div>
        </div>
        <div className="bento-grid">
          {WIKI_CATEGORIES.map((cat) => (
            <div key={cat.key} className="bento-col-4 m-card m-card-hover" onClick={() => setCategory(cat.key)} style={{ cursor: "pointer" }}>
              <div style={cardTitleStyle}><span style={accentBar} />{t[cat.labelKey] || cat.key}</div>
              <div style={{ ...captionStyle, marginTop: 2 }}>{cat.components.length} {t.tools || "缁勪欢"}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  const cat = WIKI_CATEGORIES.find((c) => c.key === category);
  if (!cat) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => setCategory("")} style={pillGhostStyle}>鈫?{t.wikiBack}</button>
        <div style={sectionTitleStyle}>{t[cat.labelKey]}</div>
      </div>
      <div className="bento-grid">
        {cat.components.map((comp, i) => (
          <div key={i} className="bento-col-6 m-card m-card-hover">
            <div style={cardTitleStyle}><span style={accentBar} />{comp.name}</div>
            <div style={{ padding: "4px 0" }}><AirUIComponent comp={comp.demo} /></div>
          </div>
        ))}
      </div>
    </div>
  );
};

/* 鈹€鈹€ Card: preset card container reused by the gallery 鈹€鈹€ */

export const Card: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = ({ comp, resolvedProps }) => {
  const title = resolvedProps.title as string | undefined;
  const ref = resolvedProps.ref as string | undefined;
  const doc = useAirUIStore((s) => s.doc);
  const setDoc = useAirUIStore((s) => s.setDoc);
  const t = ((doc?.state as Record<string, unknown> | undefined)?.t as Record<string, string>) || {};
  const [saveOpen, setSaveOpen] = useState(false);
  const [pendingName, setPendingName] = useState("");

  const handleDelete = () => {
    if (!ref) return;
    const currentDoc = useAirUIStore.getState().doc;
    if (!currentDoc?.root) return;
    showToast(t.cardDeleted, "info");
    setDoc({ ...currentDoc, root: removeNodeByRef(currentDoc.root, ref) });
  };

  const handleSaveAsPreset = () => {
    setPendingName(title || ref || "card");
    setSaveOpen(true);
  };

  const confirmSavePreset = (name: string) => {
    setSaveOpen(false);
    showToast(t.presetSaved, "success");
    savePreset({ name, component: comp, title });
  };

  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", background: "var(--color-surface)", boxShadow: "var(--air-shadow)", display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", transition: "box-shadow .2s ease, transform .2s ease" }}>
      {title && (
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--air-borderLight)", fontWeight: 700, fontSize: 13, letterSpacing: "-0.01em", color: "var(--color-text)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--color-surface-muted)" }}>
          <span>{title}</span>
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={handleSaveAsPreset} title={t.saveAsPreset} aria-label={t.saveAsPreset} style={{ width: 22, height: 22, borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="save" size={11} /></button>
            <button onClick={handleDelete} title={t.delete || "鍒犻櫎"} aria-label={t.delete || "鍒犻櫎"} style={{ width: 22, height: 22, borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-danger)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="close" size={11} /></button>
          </div>
        </div>
      )}
      <div style={{ flex: 1, padding: 14 }}>
        {comp.children?.map((child, i) => <AirUIComponent key={child.ref ?? i} comp={child} />)}
      </div>
      <PromptModal
        open={saveOpen}
        title={t.saveAsPreset}
        label={t.savePresetName}
        defaultValue={pendingName}
        confirmText={t.save}
        cancelText={t.cancel}
        onConfirm={confirmSavePreset}
        onClose={() => setSaveOpen(false)}
      />
    </div>
  );
};
