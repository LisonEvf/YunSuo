import { type FC, type CSSProperties, useState, useEffect } from "react";
import type { Component } from "@air-ui/core";
import { AirUIComponent, useAirUIStore } from "@air-ui/renderer-react";
import { useStore } from "../store";
import { sendChat } from "../chat";
import { type McpToolLite, type McpServerLite, type ArtifactPanel } from "./helpers";
import { removeNodeByRef, savePreset, listPresets, deletePreset, type UIPreset } from "./presets";
import Icon from "../components/Icon";
import { showToast } from "../components/Toast";
import PromptModal from "../components/PromptModal";

/* Legacy AIRUI preset skeleton — superseded by CapabilityHome, kept for import stability. */
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
    void sendChat(`请调用工具 ${prefixedName}`);
  } else {
    useStore.getState().setMcpToolForm({
      prefixedName,
      toolName: tool.name,
      properties: tool.inputSchema?.properties ?? {},
      required,
    });
  }
}

/* ── Capability-aware home: Bento Grid layout ─────────────────────── */

export const CapabilityHome: FC = () => {
  const doc = useAirUIStore((s) => s.doc);
  const setDoc = useAirUIStore((s) => s.setDoc);
  const state = (doc?.state ?? {}) as Record<string, unknown>;
  const t = (state.t as Record<string, string>) || {};
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
      {/* (1) Hero — full-width lavender glow */}
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

      {/* (2) Live Status — four KPI bento tiles */}
      <div className="bento-grid">
        <div className="bento-col-3 m-card">
          <span className="m-stat-label">{t.model}</span>
          <span className="m-stat-num">{runtime.modelText || "—"}</span>
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
                      <span style={rowDescStyle}>{srv.connected ? `${t.connected} 路 ${tools.length} ${t.tools || ""}` : t.disconnected}</span>
                    </div>
                    {tools.map((tool, j) => {
                      const required = ((tool as McpToolLite).inputSchema?.required) ?? [];
                      const hasParams = required.length > 0;
                      return (
                        <button
                          key={j}
                          onClick={() => { void handleMcpToolClick(i, j); }}
                          className={`m-tool-btn${hasParams ? "" : " m-tool-btn-quick"}`}
                          title={hasParams ? `${tool.name}（需参数）` : `${tool.name}（一键执行）`}
                          aria-label={tool.name}
                        >
                          <span style={{ display: "flex", alignItems: "center", gap: 5, fontWeight: 500 }}>
                            <Icon name="chevronRight" size={11} />
                            {tool.name}{hasParams ? ` 路 ${t.toolParams || "参数"}` : <Icon name="bolt" size={11} />}
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

/* ── AIRUI Wiki: bento category grid ──────────────────────────────── */

interface WikiEntry { name: string; demo: Component }
interface WikiCategory { key: string; labelKey: string; components: WikiEntry[] }

const WIKI_CATEGORIES: WikiCategory[] = [
  {
    key: "data", labelKey: "wikiCatData",
    components: [
      { name: "Table", demo: { type: "Table", props: { columns: [{ key: "name", label: "名称" }, { key: "age", label: "年龄" }], data: [{ name: "张三", age: 28 }, { name: "李四", age: 34 }] } } },
      { name: "KPI", demo: { type: "KPI", props: { label: "活跃用户", value: "12,345" } } },
      { name: "Chart", demo: { type: "Chart", props: { type: "bar", data: { labels: ["周一", "周二", "周三", "周四"], values: [3, 5, 2, 7] } } } },
      { name: "Progress", demo: { type: "Progress", props: { value: 65 } } },
      { name: "Badge", demo: { type: "Badge", props: { text: "New" } } },
    ],
  },
  {
    key: "form", labelKey: "wikiCatForm",
    components: [
      { name: "Input", demo: { type: "Input", props: { placeholder: "输入文本" } } },
      { name: "Select", demo: { type: "Select", props: { options: [{ value: "a", label: "选项 A" }, { value: "b", label: "选项 B" }] } } },
      { name: "Switch", demo: { type: "Switch", props: { checked: true } } },
      { name: "Slider", demo: { type: "Slider", props: { value: 40, min: 0, max: 100 } } },
      { name: "Checkbox", demo: { type: "Checkbox", props: { checked: true, label: "同意条款" } } },
    ],
  },
  {
    key: "layout", labelKey: "wikiCatLayout",
    components: [
      { name: "Tabs", demo: { type: "Tabs", props: { tabs: [{ label: "Tab 1" }, { label: "Tab 2" }, { label: "Tab 3" }] } } },
      { name: "Card", demo: { type: "Widget", props: { title: "卡片标题" }, children: [{ type: "Text", props: { value: "卡片内容" } }] } },
      { name: "Accordion", demo: { type: "Accordion", props: { items: [{ title: "第一项", content: "内容 1" }, { title: "第二项", content: "内容 2" }] } } },
      { name: "Divider", demo: { type: "Divider" } },
    ],
  },
  {
    key: "feedback", labelKey: "wikiCatFeedback",
    components: [
      { name: "Alert", demo: { type: "Alert", props: { variant: "info", text: "这是一条提示信息" } } },
      { name: "Progress", demo: { type: "Progress", props: { value: 30 } } },
      { name: "Tboltip", demo: { type: "Tboltip", props: { text: "提示文字" } } },
      { name: "Loading", demo: { type: "Loading" } },
    ],
  },
  {
    key: "content", labelKey: "wikiCatContent",
    components: [
      { name: "Markdown", demo: { type: "Markdown", props: { content: "# 标题\n\n**粗体** 与 *斜体*\n\n- 列表项一\n- 列表项二" } } },
      { name: "CodeBlock", demo: { type: "CodeBlock", props: { code: "const sum = (a, b) => a + b;", language: "ts" } } },
      { name: "Text", demo: { type: "Text", props: { value: "普通正文文本（style: body）", style: "body" } } },
      { name: "Image", demo: { type: "Image", props: { src: "https://placehold.co/240x80", alt: "demo" } } },
    ],
  },
  {
    key: "nav", labelKey: "wikiCatNav",
    components: [
      { name: "Steps", demo: { type: "Steps", props: { current: 1, steps: [{ title: "第一步" }, { title: "第二步" }, { title: "第三步" }] } } },
      { name: "Breadcrumb", demo: { type: "Breadcrumb", props: { items: [{ label: "首页" }, { label: "分类" }, { label: "当前" }] } } },
      { name: "Pagination", demo: { type: "Pagination", props: { total: 50, current: 1 } } },
      { name: "Timeline", demo: { type: "Timeline", props: { items: [{ title: "事件 A", time: "09:00" }, { title: "事件 B", time: "10:30" }] } } },
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
              <div style={{ ...captionStyle, marginTop: 2 }}>{cat.components.length} {t.tools || "组件"}</div>
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
        <button onClick={() => setCategory("")} style={pillGhostStyle}>← {t.wikiBack}</button>
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

/* ── Card: preset card container reused by the gallery ── */

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
            <button onClick={handleDelete} title={t.delete || "删除"} aria-label={t.delete || "删除"} style={{ width: 22, height: 22, borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-danger)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="close" size={11} /></button>
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
