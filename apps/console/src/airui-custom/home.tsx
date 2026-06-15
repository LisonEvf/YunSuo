import { type FC, type CSSProperties, useState, useEffect } from "react";
import type { Component } from "@air-ui/core";
import { AirUIComponent, useAirUIStore } from "@air-ui/renderer-react";
import { useStore, type ProviderInstance } from "../store";
import { sendChat } from "../chat";
import { type McpToolLite, type McpServerLite, type ArtifactPanel, addBtnStyle } from "./helpers";
import { removeNodeByRef, savePreset, listPresets, deletePreset, type UIPreset } from "./presets";
import Icon from "../components/Icon";
import { showToast } from "../components/Toast";

function grow(child: Component): Component {
  return { type: "Pane", props: { direction: "column", grow: true }, children: [child] };
}

function starterCard(refId: string, titleKey: string, captionKey: string): Component {
  return grow({
    type: "Card",
    props: { title: `{state.t.${titleKey}}` },
    children: [
      { type: "Text", props: { value: `{state.t.${captionKey}}`, style: "caption" } },
      { type: "Button", ref: refId, props: { label: "{state.t.run}", variant: "secondary" } },
    ],
  });
}

function capWidget(titleKey: string, inner: Component): Component {
  return grow({ type: "Card", props: { title: `{state.t.${titleKey}}` }, children: [inner] });
}

// Homepage: Hero / Quick Start / Capabilities / Live Status, all AIRUI presets.
// Starter refs (home:prompt-*) route through InteractionProvider -> sendChat.
export const homeLayout: Component = {
  type: "Pane",
  props: { className: "home-view", direction: "column", gap: "large" },
  children: [
    // (1) Hero with gradient backdrop
    {
      type: "Pane",
      props: { className: "home-hero-section", direction: "column", gap: "10px" },
      children: [
        { type: "Pane", props: { className: "home-hero-glow" } },
        { type: "Text", props: { value: "{state.t.homeWelcome}", style: "title" } },
        { type: "Text", props: { value: "{state.t.homeSubtitle}", style: "body" } },
        { type: "Button", ref: "home:start", props: { label: "{state.t.homeStart}", variant: "primary" } },
      ],
    },
    // (2) Quick Start
    {
      type: "Pane",
      props: { direction: "column", gap: "medium" },
      children: [
        { type: "Text", props: { value: "{state.t.homeQuickStart}", style: "subtitle" } },
        { type: "Text", props: { value: "{state.t.homeQuickStartCaption}", style: "caption" } },
        {
          type: "Pane",
          props: { direction: "row", gap: "medium" },
          children: [
            starterCard("home:prompt-dashboard", "homeDashboardTitle", "homeDashboardCaption"),
            starterCard("home:prompt-chart", "homeChartTitle", "homeChartCaption"),
          ],
        },
        {
          type: "Pane",
          props: { direction: "row", gap: "medium" },
          children: [
            starterCard("home:prompt-table", "homeTableTitle", "homeTableCaption"),
            starterCard("home:prompt-doc", "homeDocTitle", "homeDocCaption"),
          ],
        },
      ],
    },
    // (3) Capabilities (bound to real state)
    {
      type: "Pane",
      props: { direction: "column", gap: "medium" },
      children: [
        { type: "Text", props: { value: "{state.t.homeCapabilities}", style: "subtitle" } },
        {
          type: "Pane",
          props: { direction: "row", gap: "medium" },
          children: [
            capWidget("homeCapKpi", { type: "KPI", props: { label: "{state.t.trajectories}", value: "{state.runtime.trajectoriesText}" } }),
            capWidget("homeCapTable", {
              type: "Table",
              props: {
                columns: [{ key: "name", label: "Name" }, { key: "description", label: "Description" }],
                data: "@state.skills",
              },
            }),
            capWidget("homeCapChart", { type: "Chart", props: { type: "bar", data: "@state.runDist" } }),
          ],
        },
      ],
    },
    // (4) Live Status
    {
      type: "Pane",
      props: { direction: "column", gap: "medium" },
      children: [
        { type: "Text", props: { value: "{state.t.homeLiveStatus}", style: "subtitle" } },
        {
          type: "Pane",
          props: { direction: "row", gap: "medium" },
          children: [
            grow({ type: "KPI", props: { label: "{state.t.model}", value: "{state.runtime.modelText}" } }),
            grow({ type: "KPI", props: { label: "{state.t.activeSkills}", value: "{state.runtime.skillsCountText}" } }),
            grow({ type: "KPI", props: { label: "{state.t.memory}", value: "{state.runtime.memoryText}" } }),
            grow({ type: "KPI", props: { label: "{state.t.failures}", value: "{state.runtime.failedText}" } }),
          ],
        },
      ],
    },
  ],
};

// ── 自定义组�?────────────────────────────────────────────────────────


const capCardStyle: CSSProperties = { border: "1px solid var(--color-border)", borderRadius: 10, background: "var(--color-surface)", padding: 14, display: "flex", flexDirection: "column", gap: 6 };
const capLabelStyle: CSSProperties = { fontSize: 13, fontWeight: 600, color: "var(--color-text)", marginBottom: 4 };
const capRowStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", borderBottom: "1px solid var(--color-border)", fontSize: 12 };
const capNameStyle: CSSProperties = { fontWeight: 600, color: "var(--color-text)" };
const capDescStyle: CSSProperties = { color: "var(--color-muted)", fontSize: 11, textAlign: "right" as const };


/** MCP 工具点击：无 required 参数直接发 chat 调用；有 required 弹参数表单。 */
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

export const CapabilityHome: FC = () => {
  const doc = useAirUIStore((s) => s.doc);
  const setDoc = useAirUIStore((s) => s.setDoc);
  const state = (doc?.state ?? {}) as Record<string, unknown>;
  const t = (state.t as Record<string, string>) || {};
  const skills = (state.skills as Array<{ name?: string; description?: string }>) ?? [];
  const mcpServers = (state.mcpServers as Array<{ name?: string; connected?: boolean; tools?: Array<{ name?: string; description?: string }> }>) ?? [];
  const plugins = (state.plugins as Array<{ name?: string; path?: string }>) ?? [];
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
      <div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "center", justifyContent: "center", padding: "56px 24px", textAlign: "center" }}>
        <Icon name="puzzle" size={40} className="home-empty-icon" />
        <AirUIComponent comp={{ type: "Text", props: { value: "{state.t.noCapabilityTitle}", style: "title" } }} />
        <AirUIComponent comp={{ type: "Text", props: { value: "{state.t.noCapabilityDesc}", style: "body" } }} />
        <AirUIComponent comp={{ type: "Button", ref: "console:settings", props: { label: "{state.t.openSettings}", variant: "primary" } }} />
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <AirUIComponent comp={{ type: "Text", props: { value: "{state.t.capabilityTitle}", style: "title" } }} />
      {skills.length > 0 && (
        <div style={capCardStyle}>
          <div style={capLabelStyle}>{t.skills}</div>
          {skills.map((s, i) => (
            <div key={i} style={capRowStyle}>
              <span style={capNameStyle}>{s.name}</span>
              <span style={capDescStyle}>{s.description}</span>
            </div>
          ))}
        </div>
      )}
      {mcpServers.length > 0 && (
        <div style={capCardStyle}>
          <div style={capLabelStyle}>{t.mcp}</div>
          {mcpServers.map((srv, i) => (
            <div key={i} style={{ borderBottom: "1px solid var(--color-border)", padding: "6px 0" }}>
              <div style={capRowStyle}>
                <span style={capNameStyle}>{srv.name}</span>
                <span style={capDescStyle}>{srv.connected ? `connected · ${(srv.tools || []).length} tools` : "disconnected"}</span>
              </div>
              {(srv.tools || []).map((tool, j) => {
                const required = ((tool as McpToolLite).inputSchema?.required) ?? [];
                const hasParams = required.length > 0;
                return (
                  <button
                    key={j}
                    onClick={() => { void handleMcpToolClick(i, j); }}
                    style={{
                      ...capRowStyle, borderBottom: "none", paddingLeft: 16, marginBottom: 4,
                      cursor: "pointer", textAlign: "left", width: "100%",
                      background: hasParams ? "var(--color-surface-muted)" : "var(--color-primary-soft)",
                      border: hasParams ? "1px solid var(--color-border)" : "1px solid var(--color-primary)",
                      borderRadius: 6,
                    }}
                   title={hasParams ? `${tool.name}（需参数）` : `${tool.name}（一键执行）`}
                   aria-label={tool.name}
                  >
                    <span style={{ ...capNameStyle, fontWeight: 400, display: "flex", alignItems: "center", gap: 4 }}>
                      <Icon name="chevronRight" size={11} />
                      {tool.name}{hasParams ? ` · ${t.toolParams || "参数"}` : <Icon name="bolt" size={11} />}
                    </span>
                    <span style={capDescStyle}>{tool.description}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {plugins.length > 0 && (
        <div style={capCardStyle}>
          <div style={capLabelStyle}>{t.plugins}</div>
          {plugins.map((p, i) => (
            <div key={i} style={capRowStyle}>
              <span style={capNameStyle}>{p.name}</span>
              <span style={capDescStyle}>{p.path}</span>
            </div>
          ))}
        </div>
      )}
     {presets.length > 0 && (
        <div style={capCardStyle}>
          <div style={capLabelStyle}>{t.myPresets}</div>
          {presets.map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--color-border)" }}>
              <button onClick={() => insertPreset(p)} style={{ ...capRowStyle, flex: 1, borderBottom: "none", cursor: "pointer", padding: 0 }}>
                <span style={capNameStyle}>{p.name}</span>
                <span style={capDescStyle}>{p.title || ""}</span>
              </button>
              <button onClick={() => deletePreset(p.id)} title={t.deletePreset} aria-label={t.deletePreset} style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-surface-muted)", color: "var(--color-danger)", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="close" size={12} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// WikiHome：AIRUI 组件能力展示。顶层分类卡片，点击展开该类组件 demo

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
      { name: "Checkbox", demo: { type: "Checkbox", props: { checked: true, label: "同意条款" } } },
    ],
  },
  {
    key: "layout", labelKey: "wikiCatLayout",
    components: [
      { name: "Tabs", demo: { type: "Tabs", props: { tabs: [{ label: "Tab 1" }, { label: "Tab 2" }, { label: "Tab 3" }] } } },
      { name: "Card", demo: { type: "Widget", props: { title: "卡片标题" }, children: [{ type: "Text", props: { value: "卡片内容" } }] } },
      { name: "Accordion", demo: { type: "Accordion", props: { items: [{ title: "第一项", content: "内容 1" }, { title: "第二项", content: "内容 2" }] } } },
      { name: "Divider", demo: { type: "Divider" } },
    ],
  },
  {
    key: "feedback", labelKey: "wikiCatFeedback",
    components: [
      { name: "Alert", demo: { type: "Alert", props: { variant: "info", text: "这是一条提示信息" } } },
      { name: "Progress", demo: { type: "Progress", props: { value: 30 } } },
      { name: "Tooltip", demo: { type: "Tooltip", props: { text: "提示文字" } } },
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
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <AirUIComponent comp={{ type: "Text", props: { value: "{state.t.wikiTitle}", style: "title" } }} />
        <AirUIComponent comp={{ type: "Text", props: { value: "{state.t.wikiSubtitle}", style: "caption" } }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
          {WIKI_CATEGORIES.map((cat) => (
            <div key={cat.key} onClick={() => setCategory(cat.key)} style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: 16, background: "var(--color-surface)", cursor: "pointer" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text)", letterSpacing: "-0.005em" }}>{t[cat.labelKey] || cat.key}</div>
              <div style={{ fontSize: 11, color: "var(--color-muted)", marginTop: 4 }}>{cat.components.length} 个组件</div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  const cat = WIKI_CATEGORIES.find((c) => c.key === category);
  if (!cat) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => setCategory("")} style={addBtnStyle}>← {t.wikiBack}</button>
        <AirUIComponent comp={{ type: "Text", props: { value: `{state.t.${cat.labelKey}}`, style: "title" } }} />
      </div>
      {cat.components.map((comp, i) => (
        <div key={i} style={capCardStyle}>
          <div style={capLabelStyle}>{comp.name}</div>
          <AirUIComponent comp={comp.demo} />
        </div>
      ))}
    </div>
  );
};


// ── Card: 首页预设用的卡片容器 ──

export const Card: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = ({ comp, resolvedProps }) => {
  const title = resolvedProps.title as string | undefined;
  const ref = resolvedProps.ref as string | undefined;
  const doc = useAirUIStore((s) => s.doc);
  const setDoc = useAirUIStore((s) => s.setDoc);
  const t = ((doc?.state as Record<string, unknown> | undefined)?.t as Record<string, string>) || {};

  const handleDelete = () => {
    if (!ref) return;
    const currentDoc = useAirUIStore.getState().doc;
    if (!currentDoc?.root) return;
    showToast(t.cardDeleted, "info");
    setDoc({ ...currentDoc, root: removeNodeByRef(currentDoc.root, ref) });
  };

  const handleSaveAsPreset = () => {
    const name = window.prompt(t.savePresetName, title || ref || "card");
    if (!name) return;
    showToast(t.presetSaved, "success");
    savePreset({ name, component: comp, title });
  };

  return (
    <div style={{
      border: "1px solid var(--color-border)",
      borderRadius: 12,
      background: "var(--color-surface)",
      boxShadow: "var(--air-shadow)",
      display: "flex",
      flexDirection: "column",
      height: "100%",
      overflow: "hidden",
    }}>
      {title && (
        <div style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--color-border)",
          fontWeight: 600,
          fontSize: 13,
          letterSpacing: "-0.005em",
          color: "var(--color-text)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        }}>
          <span>{title}</span>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              onClick={handleSaveAsPreset}
              title={t.saveAsPreset}
              aria-label={t.saveAsPreset}
              style={{
                width: 20, height: 20, borderRadius: 4,
                border: "1px solid var(--color-border)",
                background: "var(--color-surface-muted)",
                color: "var(--color-text)",
                cursor: "pointer", fontSize: 11,
                display: "flex", alignItems: "center", justifyContent: "center"
              }}
            ><Icon name="save" size={11} /></button>
            <button
              onClick={handleDelete}
              title={t.delete || "删除"}
              aria-label={t.delete || "删除"}
              style={{
                width: 20, height: 20, borderRadius: 4,
                border: "1px solid var(--color-border)",
                background: "var(--color-surface-muted)",
                color: "var(--color-danger)",
                cursor: "pointer", fontSize: 12,
                display: "flex", alignItems: "center", justifyContent: "center"
              }}
            ><Icon name="close" size={11} /></button>
          </div>
        </div>
      )}
      <div style={{ flex: 1, padding: 12 }}>
        {comp.children?.map((child, i) => <AirUIComponent key={child.ref ?? i} comp={child} />)}
      </div>
    </div>
  );
};
