import { type FC, type CSSProperties, useState, useEffect } from "react";
import type { Component } from "@air-ui/core";
import { getByPath, setByPath } from "@air-ui/core";
import { AirUIComponent, useAirUIStore, registerComponent } from "@air-ui/renderer-react";
import { useStore, type ProviderInstance, type MarketplaceSource } from "./store";
import { colorForProvider } from "./providerPresets";

// ── gap / align helpers（与包内 layout.tsx 对齐）──────────────────────

const gapMap: Record<string, string> = { small: "8px", medium: "16px", large: "28px" };
function resolveGap(gap?: string | number): string | undefined {
  if (gap === undefined) return undefined;
  if (typeof gap === "number") return `${gap}px`;
  return gapMap[gap] ?? gap;
}
const alignMap: Record<string, CSSProperties["alignItems"]> = {
  start: "flex-start", center: "center", end: "flex-end", stretch: "stretch",
};
function resolveAlign(align?: string): CSSProperties["alignItems"] | undefined {
  return align ? (alignMap[align] ?? (align as CSSProperties["alignItems"])) : undefined;
}
const justifyMap: Record<string, CSSProperties["justifyContent"]> = {
  start: "flex-start", center: "center", end: "flex-end", between: "space-between", around: "space-around",
};

// ── 组件类型 / 字段归一化（LLM 容错）从�?ConsoleView 迁出 ──────────

const componentAliases: Record<string, string> = {
  card: "Widget", panel: "Widget", container: "Column", stack: "Column", vstack: "Column", hstack: "Row",
  paragraph: "Text", heading: "Text", title: "Text", markdown: "Markdown", code: "CodeBlock", codeblock: "CodeBlock",
  datatable: "Table", dataTable: "Table", datagrid: "DataGrid", "data-grid": "DataGrid", table: "Table",
  metric: "KPI", stat: "KPI", kpi: "KPI",
  "video-player": "Video", videoplayer: "Video", "audio-player": "Audio", audioplayer: "Audio",
  pdf: "PDFViewer", pdfviewer: "PDFViewer", "pdf-viewer": "PDFViewer",
  empty: "EmptyState", "empty-state": "EmptyState",
  command: "CommandPalette", commandpalette: "CommandPalette", "command-palette": "CommandPalette",
  "context-menu": "ContextMenu", contextmenu: "ContextMenu",
  "top-nav": "TopNav", topnav: "TopNav", "app-shell": "AppShell", appshell: "AppShell",
  "split-pane": "SplitPane", splitpane: "SplitPane", "scroll-area": "ScrollArea", scrollarea: "ScrollArea",
  number: "NumberInput", numberinput: "NumberInput", "number-input": "NumberInput",
  textarea: "Textarea", date: "DatePicker", "date-picker": "DatePicker", time: "TimePicker", "time-picker": "TimePicker",
  "date-range": "DateRangePicker", "date-range-picker": "DateRangePicker", daterange: "DateRangePicker",
  multiselect: "MultiSelect", "multi-select": "MultiSelect",
  upload: "FileUpload", "file-upload": "FileUpload", fileupload: "FileUpload",
  "rich-text": "RichText", richtext: "RichText", network: "NetworkGraph", "network-graph": "NetworkGraph", networkgraph: "NetworkGraph",
};

const builtinComponents = new Set([
  "Column","Row","Divider","Text","Button","Input","Select","Switch","Checkbox","Radio","Slider","Image","Dropdown",
  "Form","Textarea","DatePicker","TimePicker","DateRangePicker","NumberInput","Autocomplete","MultiSelect","FileUpload",
  "Video","Audio","ImageGallery","Carousel","Lightbox","PDFViewer",
  "KPI","PlateCard","Gauge","Progress","Tag","Badge","Avatar","Skeleton",
  "Table","Pagination","DataGrid","EmptyState","Chart",
  "Tabs","Breadcrumb","Steps","Modal","Drawer","DropdownMenu",
  "Alert","Loading","ErrorFallback","Tooltip","Toast","Notification","Popconfirm","ContextMenu","CommandPalette",
  "Dashboard","Widget","Accordion","Timeline","Tree",
  "AppShell","Sidebar","TopNav","Toolbar","SplitPane","ScrollArea",
  "Markdown","CodeBlock","RichText","Icon","Calendar","Kanban","Map","NetworkGraph","Heatmap",
]);
const canonicalComponentTypes = new Map(
  Array.from(builtinComponents, (name) => [name.replace(/[\s_-]/g, "").toLowerCase(), name]),
);

export function normalizeComponentType(typeValue: unknown, props: Record<string, unknown>): string {
  const rawType = typeof typeValue === "string" ? typeValue.trim() : "";
  if (!rawType) {
    if (props.columns && (props.data || props.rows)) return "Table";
    if (props.value !== undefined || props.count !== undefined) return "KPI";
    return "Text";
  }
  if (builtinComponents.has(rawType)) return rawType;
  const compact = rawType.replace(/[\s_-]/g, "");
  const lower = compact.toLowerCase();
  const alias = componentAliases[rawType] || componentAliases[compact] || componentAliases[lower];
  if (alias) return alias;
  const canonical = canonicalComponentTypes.get(lower);
  if (canonical) return canonical;
  const pascal = lower.charAt(0).toUpperCase() + lower.slice(1);
  if (builtinComponents.has(pascal)) return pascal;
  return "Text";
}

export function normalizeAirUIComponent(raw: unknown): Component {
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
    return { type: "Text", props: { value: String(raw) } };
  }
  if (!raw || typeof raw !== "object") {
    return { type: "Text", props: { value: "" } };
  }
  const node = raw as Record<string, unknown>;
  const rawProps = (node.props as Record<string, unknown> | undefined) ?? {};
  const props = { ...rawProps };
  const type = normalizeComponentType(node.type, props);
  if (type === "Table" && props.data === undefined && props.rows !== undefined) {
    props.data = props.rows; delete props.rows;
  }
  if (type === "Text" && props.value === undefined) {
    props.value = props.text ?? props.content ?? props.label ?? "";
    delete props.text; delete props.content;
  }
  if (type === "KPI" && props.value === undefined && props.count !== undefined) {
    props.value = props.count; delete props.count;
  }
  const children = Array.isArray(node.children)
    ? node.children.map((child) => normalizeAirUIComponent(child))
    : undefined;
  return { ...(node as unknown as Component), type, props, ...(children ? { children } : {}) };
}

export interface ArtifactPanel {
  ref: string;
  title: string;
  component: Component;
}

// -- Homepage preset skeleton (rendered when artifacts is empty) --

// grow wrapper: make a card share row width evenly
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
    // (1) Hero
    {
      type: "Pane",
      props: { direction: "column", gap: "8px" },
      children: [
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

const Pane: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = ({ comp, resolvedProps }) => {
  if (resolvedProps.visible === false) return null;
  const direction = (resolvedProps.direction as string) ?? "column";
  const grow = resolvedProps.grow === true;
  const justify = resolvedProps.justify as string | undefined;
  const style: CSSProperties = {
    display: "flex",
    flexDirection: direction as CSSProperties["flexDirection"],
    gap: resolveGap(resolvedProps.gap as string | number),
    padding: resolvedProps.padding as string | undefined,
    flexGrow: grow ? 1 : (resolvedProps.flex as number | undefined),
    flexBasis: grow ? 0 : undefined,
    minWidth: resolvedProps.minWidth as string | number | undefined,
    width: resolvedProps.width as string | number | undefined,
    maxWidth: resolvedProps.maxWidth as string | number | undefined,
    minHeight: resolvedProps.minHeight as string | number | undefined,
    height: resolvedProps.height as string | number | undefined,
    overflow: resolvedProps.scroll ? "auto" : undefined,
    alignItems: resolveAlign(resolvedProps.align as string),
    justifyContent: justify ? (justifyMap[justify] ?? (justify as CSSProperties["justifyContent"])) : undefined,
    marginTop: resolvedProps.marginTop as string | undefined,
    marginBottom: resolvedProps.marginBottom as string | undefined,
    paddingTop: resolvedProps.paddingTop as string | undefined,
    paddingBottom: resolvedProps.paddingBottom as string | undefined,
    borderBottom: resolvedProps.borderBottom ? "1px solid var(--color-border)" : undefined,
    borderLeft: resolvedProps.borderLeft ? "1px solid var(--color-border)" : undefined,
    borderTop: resolvedProps.borderTop ? "1px solid var(--color-border)" : undefined,
    background: resolvedProps.background as string | undefined,
  };
  return (
    <div className={resolvedProps.className as string | undefined} style={style}>
      {comp.children?.map((child, i) => <AirUIComponent key={child.ref ?? i} comp={child} />)}
    </div>
  );
};

// ── 能力感知首页 / AIRUI Wiki ────────────────────────────────────────
const capCardStyle: CSSProperties = { border: "1px solid var(--color-border)", borderRadius: 12, background: "var(--color-surface)", padding: 14, display: "flex", flexDirection: "column", gap: 6 };
const capLabelStyle: CSSProperties = { fontSize: 13, fontWeight: 700, color: "var(--color-text)", marginBottom: 4 };
const capRowStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", borderBottom: "1px solid var(--color-border)", fontSize: 12 };
const capNameStyle: CSSProperties = { fontWeight: 600, color: "var(--color-text)" };
const capDescStyle: CSSProperties = { color: "var(--color-muted)", fontSize: 11, textAlign: "right" as const };

// CapabilityHome：根据 skills/mcp/plugins 实际加载状态展示能力清单；全无则引导去设置
const CapabilityHome: FC = () => {
  const doc = useAirUIStore((s) => s.doc);
  const state = (doc?.state ?? {}) as Record<string, unknown>;
  const t = (state.t as Record<string, string>) || {};
  const skills = (state.skills as Array<{ name?: string; description?: string }>) ?? [];
  const mcpServers = (state.mcpServers as Array<{ name?: string; connected?: boolean; tools?: Array<{ name?: string; description?: string }> }>) ?? [];
  const plugins = (state.plugins as Array<{ name?: string; path?: string }>) ?? [];
  const hasAny = skills.length > 0 || mcpServers.length > 0 || plugins.length > 0;

  if (!hasAny) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "center", justifyContent: "center", padding: "56px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 40 }}>🧩</div>
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
              {(srv.tools || []).map((tool, j) => (
                <div key={j} style={{ ...capRowStyle, borderBottom: "none", paddingLeft: 16 }}>
                  <span style={{ ...capNameStyle, fontWeight: 400 }}>↳ {tool.name}</span>
                  <span style={capDescStyle}>{tool.description}</span>
                </div>
              ))}
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

const WikiHome: FC = () => {
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
            <div key={cat.key} onClick={() => setCategory(cat.key)} style={{ border: "1px solid var(--color-border)", borderRadius: 12, padding: 16, background: "var(--color-surface)", cursor: "pointer" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text)" }}>{t[cat.labelKey] || cat.key}</div>
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

const ArtifactGallery: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = ({ resolvedProps }) => {
  const doc = useAirUIStore((s) => s.doc);
  const state = (doc?.state ?? {}) as Record<string, unknown>;
  if (state.wikiOpen === true) {
    return <WikiHome />;
  }
  const artifacts = ((state.artifacts as ArtifactPanel[]) ?? []);
  const homePinned = state.homePinned === true;
  if (!artifacts.length || homePinned) {
    return <CapabilityHome />;
  }
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {artifacts.map((artifact) => (
        <div key={artifact.ref} style={{ border: "1px solid var(--color-border)", borderRadius: 8, background: "var(--color-surface)", overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 12px", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface-muted)", fontSize: 13, fontWeight: 700, color: "var(--color-text)" }}>
            <span>{artifact.title}</span>
            <span style={{ fontSize: 12, color: "var(--color-muted)", fontWeight: 500 }}>{artifact.ref}</span>
          </div>
          <div className="airui-gallery-card" style={{ padding: 12 }}>
            <AirUIComponent comp={artifact.component} />
          </div>
        </div>
      ))}
    </div>
  );
};

const InspectorSkills: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = ({ resolvedProps }) => {
  const doc = useAirUIStore((s) => s.doc);
  const state = (doc?.state ?? {}) as Record<string, unknown>;
  const skills = (state.skills as Array<{ slug: string; name: string; description?: string }>) ?? [];
  const activeSkills = (state.activeSkills as Array<{ slug: string }>) ?? [];
  const running = state.chatLoading === true;
  const active = new Set(activeSkills.map((s) => s.slug));
  if (!skills.length) return <div style={{ fontSize: 12, color: "var(--color-muted)" }}>{String(resolvedProps.emptyText ?? "")}</div>;
  return (
    <div style={{ display: "grid", gap: 8, maxHeight: 260, overflowY: "auto", paddingRight: 2 }}>
      {skills.map((skill) => {
        const on = active.has(skill.slug);
        return (
          <div key={skill.slug} className={running && on ? "skill-card skill-card-active" : "skill-card"} style={{ padding: 9, borderRadius: 8, background: on ? "var(--color-primary-soft)" : "var(--color-surface-muted)", border: on ? "1px solid var(--color-primary-border)" : "1px solid transparent" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)" }}>{skill.name}</div>
              {on && <span style={{ fontSize: 10, color: "var(--color-primary-strong)", fontWeight: 800, textTransform: "uppercase" }}>{String(resolvedProps.usingText ?? "")}</span>}
            </div>
            <div style={{ fontSize: 12, color: "var(--color-muted)", marginTop: 3 }}>{skill.description}</div>
          </div>
        );
      })}
    </div>
  );
};

const RunTimeline: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = ({ resolvedProps }) => {
  const doc = useAirUIStore((s) => s.doc);
  const state = (doc?.state ?? {}) as Record<string, unknown>;
  const events = (state.runEvents as Array<{ id: string; label: string; detail: string; state: string; time: string }>) ?? [];
  const eventsLabel = String(resolvedProps.eventsLabel ?? "");
  const colorOf = (s: string) => s === "running" ? "var(--color-info)" : s === "done" ? "var(--color-success)" : s === "error" ? "var(--color-danger)" : "var(--color-muted)";
  return (
    <section className="timeline-dock" style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", padding: "7px 9px", borderBottom: "1px solid var(--color-border)" }}>
        <span style={{ fontSize: 12, color: "var(--color-muted)" }}>{events.length} {eventsLabel}</span>
      </div>
      <div style={{ display: "grid", gap: 6, maxHeight: 168, overflowY: "auto", padding: 9 }}>
        {events.slice().reverse().map((event) => (
          <div key={event.id} style={{ display: "grid", gridTemplateColumns: "56px 1fr", gap: 8, padding: "7px 8px", borderRadius: 6, background: "var(--color-surface-muted)", border: "1px solid var(--color-border)" }}>
            <span style={{ fontSize: 11, color: "var(--color-muted)" }}>{event.time}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <strong style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--color-text)" }}>{event.label}</strong>
                <span style={{ fontSize: 10, color: colorOf(event.state), textTransform: "uppercase" }}>{event.state}</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--color-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{event.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

const fieldStyle: CSSProperties = { width: "100%", height: 34, borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-text)", padding: "0 10px", outline: "none", fontSize: 13 };
const fieldLabelStyle: CSSProperties = { display: "grid", gap: 6, fontSize: 12, fontWeight: 700, color: "var(--color-text)" };
const delBtnStyle: CSSProperties = { flexShrink: 0, width: 34, height: 34, borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface-muted)", color: "var(--color-danger)", cursor: "pointer", fontSize: 16, lineHeight: 1 };
const addBtnStyle: CSSProperties = { alignSelf: "flex-start", height: 30, padding: "0 12px", borderRadius: 8, border: "1px dashed var(--color-border-strong)", background: "transparent", color: "var(--color-text)", cursor: "pointer", fontSize: 12 };

const Setting: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = ({ resolvedProps }) => {
  const doc = useAirUIStore((s) => s.doc);
  const setDoc = useAirUIStore((s) => s.setDoc);
  const rel = resolvedProps.path as string;
  const path = `draft.${rel}`;
  const value = doc ? getByPath(doc.state, path) : undefined;
  const kind = (resolvedProps.kind as string) ?? "text";
  const label = resolvedProps.label as string | undefined;
  const options = (resolvedProps.options as Array<{ value: string; label: string }>) ?? [];

  const update = (next: unknown) => {
    if (!doc) return;
    setDoc({ ...doc, state: setByPath(doc.state, path, next) });
  };

  return (
    <label style={fieldLabelStyle}>
      {label}
      {kind === "switch" ? (
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => update(e.target.checked)} style={{ width: 16, height: 16 }} />
      ) : kind === "select" ? (
        <select value={String(value ?? "")} onChange={(e) => update(e.target.value)} style={fieldStyle}>
          {options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
      ) : (
        <input
          type={kind === "password" ? "password" : kind === "number" ? "number" : "text"}
          value={kind === "number" ? Number(value ?? 0) : String(value ?? "")}
          min={kind === "number" ? 1 : undefined}
          onChange={(e) => update(kind === "number" ? Number(e.target.value || 1) : e.target.value)}
          style={fieldStyle}
        />
      )}
    </label>
  );
};

const ConnStatus: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = () => {
  const doc = useAirUIStore((s) => s.doc);
  const state = (doc?.state ?? {}) as Record<string, unknown>;
  const connected = state.connected === true;
  return <span style={{ color: connected ? "var(--color-success)" : "var(--color-danger)", fontWeight: 700, fontSize: 12 }}>{String(state.connText ?? "")}</span>;
};

const Notice: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = ({ resolvedProps }) => {
  const doc = useAirUIStore((s) => s.doc);
  const state = (doc?.state ?? {}) as Record<string, unknown>;
  const field = (resolvedProps.field as string) ?? "settingsError";
  const message = String(state[field] ?? "");
  if (!message) return null;
  return <div style={{ color: "var(--color-danger)", fontSize: 12, fontWeight: 700 }}>{message}</div>;
};

// Card: like Widget but reads resolvedProps (Widget is engine-special-cased to raw comp.props,
// so {state.t.xxx} in its title would render literally). Used by the homepage preset.
const Card: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = ({ comp, resolvedProps }) => {
  const title = resolvedProps.title as string | undefined;
  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: 14, background: "var(--color-surface)", boxShadow: "var(--air-shadow)", display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {title && <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--color-border)", fontWeight: 700, fontSize: 13, color: "var(--color-text)" }}>{title}</div>}
      <div style={{ flex: 1, padding: 12 }}>{comp.children?.map((child, i) => <AirUIComponent key={child.ref ?? i} comp={child} />)}</div>
    </div>
  );
};

// SettingCard: 设置分组的模块卡片（圆角 + 边框 + 标题栏带强调色竖条 + 描述）
const SettingCard: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = ({ comp, resolvedProps }) => {
  const title = resolvedProps.title as string | undefined;
  const desc = resolvedProps.desc as string | undefined;
  const align = (resolvedProps.align as string) ?? "center";
  const maxWidth = (resolvedProps.maxWidth as string | number | undefined) ?? 640;
  const sectionStyle: CSSProperties = { border: "1px solid var(--color-border)", borderRadius: 14, background: "var(--color-surface)", boxShadow: "var(--air-shadow)", overflow: "hidden", width: "100%", maxWidth };
  if (align === "left") { sectionStyle.marginLeft = 0; sectionStyle.marginRight = "auto"; }
  else if (align === "right") { sectionStyle.marginLeft = "auto"; sectionStyle.marginRight = 0; }
  else { sectionStyle.marginInline = "auto"; }
  return (
    <section style={sectionStyle}>
      {title && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "15px 20px", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface-muted)" }}>
          <span style={{ width: 3, height: 18, borderRadius: 2, background: "var(--color-primary)" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: "var(--color-text)" }}>{title}</span>
            {desc && <span style={{ fontSize: 11, color: "var(--color-muted)" }}>{desc}</span>}
          </div>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 20 }}>
        {comp.children?.map((child, i) => <AirUIComponent key={child.ref ?? i} comp={child} />)}
      </div>
    </section>
  );
};

// ListEditor: 编辑 draft 上的 string[]（如 search_paths），每行一项 + 增删
const ListEditor: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = ({ resolvedProps }) => {
  const doc = useAirUIStore((s) => s.doc);
  const setDoc = useAirUIStore((s) => s.setDoc);
  const path = `draft.${resolvedProps.path as string}`;
  const raw = doc ? getByPath(doc.state, path) : [];
  const items: string[] = Array.isArray(raw) ? raw.map((x) => String(x)) : [];
  const placeholder = (resolvedProps.placeholder as string) || "";
  const quickPaths = (resolvedProps.quickPaths as string[] | undefined) ?? [];
  const t = ((doc?.state as Record<string, unknown> | undefined)?.t as Record<string, string> | undefined) ?? {};
  const txt = (k: string) => t[k] ?? k;
  const quickChipStyle = (used: boolean): CSSProperties => ({ height: 26, padding: "0 10px", borderRadius: 8, border: `1px solid ${used ? "var(--color-border)" : "var(--color-border-strong)"}`, background: "transparent", color: used ? "var(--color-muted)" : "var(--color-text)", cursor: used ? "default" : "pointer", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 });

  const update = (next: string[]) => {
    if (!doc) return;
    setDoc({ ...doc, state: setByPath(doc.state, path, next) });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((item, i) => (
        <div key={i} style={{ display: "flex", gap: 6 }}>
          <input
            value={item}
            placeholder={placeholder}
            onChange={(e) => update(items.map((x, j) => (j === i ? e.target.value : x)))}
            style={fieldStyle}
          />
          <button onClick={() => update(items.filter((_, j) => j !== i))} style={delBtnStyle}>×</button>
        </div>
      ))}
      <button onClick={() => update([...items, ""])} style={addBtnStyle}>+ 添加</button>
      {quickPaths.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
          <span style={{ fontSize: 11, color: "var(--color-muted)" }}>{txt("quickPaths")}</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {quickPaths.map((p) => {
              const used = items.includes(p);
              return (
                <button key={p} disabled={used} onClick={() => update([...items, p])} style={quickChipStyle(used)}>
                  + {p}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// McpServers: 编辑 draft.mcp.servers，每 server 一卡片（name/enabled/transport/命令或 url）
// McpServers: 配置 + 运行时状态合并。读 draft.mcp.servers（配置）与 state.mcpServers
// （/api/mcp/status 反馈），按 name 匹配，每个 server 卡片显示连接徽章 + 可展开工具清单 + 重连入口
const mcpBadgeStyle = (connected: boolean): CSSProperties => ({ flexShrink: 0, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: connected ? "var(--color-success)" : "var(--color-surface-muted)", color: connected ? "#fff" : "var(--color-muted)", border: connected ? "none" : "1px solid var(--color-border)" });
const mcpExpandBtnStyle: CSSProperties = { flexShrink: 0, width: 28, height: 28, borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-surface-muted)", color: "var(--color-text)", cursor: "pointer", fontSize: 11 };
const mcpToolItemStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 1, padding: "6px 10px", borderRadius: 6, background: "var(--color-surface-muted)", fontSize: 11, border: "1px solid var(--color-border)" };

const McpServers: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = () => {
  const doc = useAirUIStore((s) => s.doc);
  const setDoc = useAirUIStore((s) => s.setDoc);
  const state = (doc?.state ?? {}) as Record<string, unknown>;
  const t = (state.t as Record<string, string> | undefined) ?? {};
  const txt = (k: string) => t[k] ?? k;
  const path = "draft.mcp.servers";
  const raw = doc ? getByPath(doc.state, path) : [];
  const servers: Array<Record<string, unknown>> = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
  const statusByName = new Map<string, { connected: boolean; tools: Array<{ name: string; description?: string }> }>();
  for (const s of (Array.isArray(state.mcpServers) ? state.mcpServers : []) as Array<{ name?: string; connected?: boolean; tools?: Array<{ name: string; description?: string }> }>) {
    if (s.name) statusByName.set(s.name, { connected: Boolean(s.connected), tools: s.tools || [] });
  }
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState("");

  const toggleExpand = (i: number) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  const update = (next: Array<Record<string, unknown>>) => {
    if (!doc) return;
    setDoc({ ...doc, state: setByPath(doc.state, path, next) });
  };
  const patch = (i: number, delta: Record<string, unknown>) =>
    update(servers.map((s, j) => (j === i ? { ...s, ...delta } : s)));

  // 重连：用已保存的 config 重新连接所有 enabled server（改配置需先点底部"保存"）
  const reconnect = async () => {
    setReconnecting(true);
    setError("");
    try {
      const res = await fetch("/api/mcp/reconnect", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (doc) setDoc({ ...doc, state: setByPath(doc.state, "mcpServers", data.servers || []) });
    } catch {
      setError(txt("reconnectFailed"));
    } finally {
      setReconnecting(false);
    }
  };

  const enabledCount = servers.filter((s) => s.enabled !== false).length;
  const connectedCount = servers.filter((s) => s.enabled !== false && statusByName.get(String(s.name || ""))?.connected).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, color: "var(--color-muted)" }}>{connectedCount}/{enabledCount} {txt("connected")}</span>
        <button onClick={reconnect} disabled={reconnecting} style={{ ...activateBtnStyle, opacity: reconnecting ? 0.6 : 1 }}>
          {reconnecting ? txt("reconnecting") : txt("reconnect")}
        </button>
      </div>
      {error && <div style={{ fontSize: 11, color: "var(--color-danger)" }}>{error}</div>}
      {servers.map((srv, i) => {
        const isStdio = Boolean(srv.command);
        const mode = isStdio ? "stdio" : ((srv.transport as string) || "http");
        const enabled = srv.enabled !== false;
        const st = enabled ? statusByName.get(String(srv.name || "")) : undefined;
        const connected = Boolean(st?.connected);
        const tools = st?.tools || [];
        const isOpen = expanded.has(i);
        return (
          <div key={i} style={{ border: `1px solid ${connected ? "var(--color-success)" : "var(--color-border)"}`, borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 8, background: "var(--color-surface-muted)" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                value={String(srv.name || "")}
                placeholder="name"
                onChange={(e) => patch(i, { name: e.target.value })}
                style={{ ...fieldStyle, flex: 1 }}
              />
              {enabled && (
                <span style={mcpBadgeStyle(connected)}>
                  {connected ? `${txt("connected")} · ${tools.length} ${txt("tools")}` : txt("disconnected")}
                </span>
              )}
              <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--color-text)", whiteSpace: "nowrap" }}>
                <input type="checkbox" checked={enabled} onChange={(e) => patch(i, { enabled: e.target.checked })} />
                on
              </label>
              {connected && tools.length > 0 && (
                <button onClick={() => toggleExpand(i)} style={mcpExpandBtnStyle}>{isOpen ? "▲" : `▼ ${tools.length}`}</button>
              )}
              <button onClick={() => update(servers.filter((_, j) => j !== i))} style={delBtnStyle}>×</button>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <select
                value={mode}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "stdio") patch(i, { command: String(srv.command || ""), url: undefined, transport: undefined });
                  else patch(i, { url: String(srv.url || ""), command: undefined, args: undefined, transport: v === "sse" ? "sse" : undefined });
                }}
                style={{ ...fieldStyle, width: 90, flex: "none" }}
              >
                <option value="stdio">stdio</option>
                <option value="http">http</option>
                <option value="sse">sse</option>
              </select>
              {isStdio ? (
                <>
                  <input
                    value={String(srv.command || "")}
                    placeholder="command"
                    onChange={(e) => patch(i, { command: e.target.value })}
                    style={{ ...fieldStyle, flex: 1 }}
                  />
                  <input
                    value={Array.isArray(srv.args) ? (srv.args as string[]).join(" ") : ""}
                    placeholder="args (空格分隔)"
                    onChange={(e) => patch(i, { args: e.target.value.split(/\s+/).filter(Boolean) })}
                    style={{ ...fieldStyle, flex: 1 }}
                  />
                </>
              ) : (
                <input
                  value={String(srv.url || "")}
                  placeholder="https://host/mcp"
                  onChange={(e) => patch(i, { url: e.target.value })}
                  style={{ ...fieldStyle, flex: 1 }}
                />
              )}
            </div>
            {isOpen && connected && tools.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: 2 }}>
                {tools.map((tool, ti) => (
                  <div key={ti} style={mcpToolItemStyle}>
                    <span style={{ fontWeight: 700, color: "var(--color-text)" }}>{tool.name}</span>
                    {tool.description && <span style={{ color: "var(--color-muted)" }}>{tool.description}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <button
        onClick={() => update([...servers, { name: "", enabled: true, command: "", args: [] }])}
        style={addBtnStyle}
      >+ 添加 server</button>
    </div>
  );
};

// LlmProviderPanel: 预设网格一键回填 + 已保存 provider 卡片列表（切换/删除/保存为 provider）
// 设计借鉴 cc-switch ProviderCard（圆角卡片 + 品牌色块图标 + 激活态强调），
// 渲染层用 AIRUI 设计 token（CSS 变量）+ inline style，与 McpServers/Card 风格一致
const presetBtnStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 10, border: "1px solid var(--color-border)", background: "var(--color-surface)", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--color-text)", textAlign: "left", transition: "border-color .15s, background .15s" };
const iconBlockStyle = (color: string): CSSProperties => ({ flexShrink: 0, width: 36, height: 36, borderRadius: 10, background: color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 15, letterSpacing: 0 });
const cardBase: CSSProperties = { display: "flex", alignItems: "center", gap: 12, borderRadius: 12, padding: "12px 14px", transition: "border-color .15s" };
const activateBtnStyle: CSSProperties = { flexShrink: 0, height: 30, padding: "0 14px", borderRadius: 8, border: "1px solid var(--color-primary)", background: "var(--color-primary)", color: "#fff", cursor: "pointer", fontSize: 11, fontWeight: 700 };

const initialOf = (name?: string) => {
  const s = (name || "").trim();
  return s ? s.charAt(0).toUpperCase() : "?";
};

const LlmProviderPanel: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = () => {
  const appConfig = useStore((s) => s.appConfig);
  const setAppConfig = useStore((s) => s.setAppConfig);
  const presets = appConfig.provider_presets ?? [];
  const doc = useAirUIStore((s) => s.doc);
  const setDoc = useAirUIStore((s) => s.setDoc);
  const state = (doc?.state ?? {}) as Record<string, unknown>;
  const t = (state.t as Record<string, string> | undefined) ?? {};
  const draft = (state.draft ?? {}) as Record<string, unknown>;
  const model = (draft.model ?? {}) as Record<string, unknown>;
  const providers = (Array.isArray(draft.providers) ? draft.providers : []) as ProviderInstance[];
  const activeId = (draft.active_provider_id as string | null) ?? null;
  const txt = (k: string) => t[k] ?? k;

  const patchDraft = (delta: Record<string, unknown>) => {
    if (!doc) return;
    setDoc({ ...doc, state: setByPath(doc.state, "draft", { ...draft, ...delta }) });
  };

  const applyPreset = (key: string) => {
    const preset = presets.find((p) => p.key === key);
    if (!preset) return;
    patchDraft({
      model: {
        ...model,
        display_name: preset.name,
        provider: preset.provider,
        base_url: preset.base_url,
        name: preset.defaultModel,
        max_output_tokens: preset.maxOutputTokens,
      },
    });
  };

  const saveAsProvider = () => {
    const id = `p-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`;
    const inst: ProviderInstance = {
      id,
      name: String(model.display_name || ""),
      provider: String(model.provider || "openai"),
      base_url: String(model.base_url || ""),
      api_key: String(model.api_key || ""),
      model_name: String(model.name || ""),
      max_output_tokens: Number(model.max_output_tokens || 4096),
    };
    patchDraft({ providers: [...providers, inst], active_provider_id: id });
  };

  const activate = (id: string) => {
    const inst = providers.find((p) => p.id === id);
    if (!inst) return;
    patchDraft({
      active_provider_id: id,
      model: {
        ...model,
        display_name: inst.name,
        provider: inst.provider,
        name: inst.model_name,
        base_url: inst.base_url,
        api_key: inst.api_key,
        max_output_tokens: inst.max_output_tokens,
      },
    });
  };

  const remove = (id: string) => {
    const next = providers.filter((p) => p.id !== id);
    if (id === activeId && next.length > 0) {
      const first = next[0];
      patchDraft({
        providers: next,
        active_provider_id: first.id,
        model: {
          ...model,
          display_name: first.name,
          provider: first.provider,
          name: first.model_name,
          base_url: first.base_url,
          api_key: first.api_key,
          max_output_tokens: first.max_output_tokens,
        },
      });
    } else {
      patchDraft({ providers: next, active_provider_id: id === activeId ? null : activeId });
    }
  };

  const hoverBorder = (e: React.MouseEvent<HTMLElement>, color: string) => { e.currentTarget.style.borderColor = color; };

  const restoreDefaultPresets = async () => {
    const next = { ...appConfig, provider_presets: [] };
    const res = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: next }),
    });
    if (res.ok) {
      const payload = await res.json();
      setAppConfig(payload?.config ?? next);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* 预设网格 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text)" }}>{txt("providerPresets")}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, color: "var(--color-muted)" }}>{txt("providerPresetsHint")}</span>
            <button onClick={restoreDefaultPresets} style={{ fontSize: 11, color: "var(--color-primary)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>{txt("restoreDefault")}</button>
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
          {presets.map((p) => (
            <button
              key={p.key}
              onClick={() => applyPreset(p.key)}
              style={presetBtnStyle}
              onMouseEnter={(e) => hoverBorder(e, "var(--color-primary)")}
              onMouseLeave={(e) => hoverBorder(e, "var(--color-border)")}
            >
              <span style={iconBlockStyle(p.color || "#8B8F98")}>{initialOf(p.name)}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 已保存 provider 卡片列表 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text)" }}>{txt("savedProviders")}</span>
          <button onClick={saveAsProvider} style={addBtnStyle}>+ {txt("saveAsProvider")}</button>
        </div>
        {providers.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "18px 14px", borderRadius: 12, border: "1px dashed var(--color-border)", background: "var(--color-surface-muted)", textAlign: "center" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text)" }}>{txt("noSavedProvidersTitle")}</span>
            <span style={{ fontSize: 11, color: "var(--color-muted)" }}>{txt("noSavedProviders")}</span>
          </div>
        ) : providers.map((p) => {
          const color = colorForProvider(p);
          const active = p.id === activeId;
          const cardStyle: CSSProperties = active
            ? { ...cardBase, border: `1px solid ${color}`, background: `${color}14`, boxShadow: `0 0 0 1px ${color}22 inset` }
            : { ...cardBase, border: "1px solid var(--color-border)", background: "var(--color-surface)" };
          return (
            <div
              key={p.id}
              style={cardStyle}
              onMouseEnter={(e) => { if (!active) hoverBorder(e, "var(--color-border-strong)"); }}
              onMouseLeave={(e) => { if (!active) hoverBorder(e, "var(--color-border)"); }}
            >
              <span style={iconBlockStyle(color)}>{initialOf(p.name || p.model_name)}</span>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name || p.model_name || "(unnamed)"}</span>
                  {active && <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 6, background: color, color: "#fff" }}>{txt("currentProvider")}</span>}
                </div>
                <span style={{ fontSize: 11, color: "var(--color-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.model_name || "—"} · {p.base_url || "—"}</span>
              </div>
              {!active && <button onClick={() => activate(p.id)} style={activateBtnStyle}>{txt("activateProvider")}</button>}
              <button onClick={() => remove(p.id)} style={delBtnStyle}>×</button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── 设置页：左侧菜单 + 右侧分区内容 ──────────────────────────────
// SETTINGS_SECTIONS 集中定义 6 个分类的菜单元数据 + SettingCard 声明式定义，
// 供 SettingsNav（左菜单）与 SettingsContent（右内容）复用。卡片 props 里的
// {state.t.xxx} 由 AIRUI 引擎在 AirUIComponent 渲染时解析。
interface SettingsSectionDef {
  key: string;
  labelKey: string;
  card: Component;
}

const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  {
    key: "appearance",
    labelKey: "appearance",
    card: {
      type: "SettingCard",
      props: { title: "{state.t.appearance}", desc: "{state.t.settingsAppearanceDesc}" },
      children: [
        { type: "Setting", props: { path: "ui.theme", kind: "select", label: "{state.t.theme}", options: [
          { value: "light", label: "{state.t.light}" }, { value: "dark", label: "{state.t.dark}" },
          { value: "graphite", label: "{state.t.graphite}" }, { value: "neon", label: "{state.t.neon}" },
          { value: "glass", label: "{state.t.glass}" }, { value: "system", label: "{state.t.system}" },
        ] } },
        { type: "Setting", props: { path: "ui.language", kind: "select", label: "{state.t.language}", options: [
          { value: "zh-CN", label: "简体中文" }, { value: "en-US", label: "English" },
        ] } },
      ],
    },
  },
  {
    key: "llm",
    labelKey: "llm",
    card: {
      type: "SettingCard",
      props: { title: "{state.t.llm}", desc: "{state.t.settingsLlmDesc}" },
      children: [
        { type: "LlmProviderPanel" },
        { type: "Setting", props: { path: "model.display_name", kind: "text", label: "{state.t.displayName}" } },
        { type: "Setting", props: { path: "model.provider", kind: "text", label: "{state.t.provider}" } },
        { type: "Setting", props: { path: "model.name", kind: "text", label: "{state.t.modelName}" } },
        { type: "Setting", props: { path: "model.base_url", kind: "text", label: "{state.t.baseUrl}" } },
        { type: "Setting", props: { path: "model.api_key", kind: "password", label: "{state.t.apiKey}" } },
        { type: "Setting", props: { path: "model.max_output_tokens", kind: "number", label: "{state.t.maxTokens}" } },
      ],
    },
  },
  {
    key: "runtime",
    labelKey: "runtime",
    card: {
      type: "SettingCard",
      props: { title: "{state.t.runtime}", desc: "{state.t.settingsRuntimeDesc}" },
      children: [
        { type: "Setting", props: { path: "runtime.max_iterations", kind: "number", label: "{state.t.maxIterations}" } },
        { type: "Setting", props: { path: "runtime.context_window_tokens", kind: "number", label: "{state.t.contextWindow}" } },
      ],
    },
  },
  {
    key: "skills",
    labelKey: "skills",
    card: {
      type: "SettingCard",
      props: { title: "{state.t.skills}", desc: "{state.t.settingsSkillsDesc}" },
      children: [
        { type: "Setting", props: { path: "skills.enabled", kind: "switch", label: "{state.t.enabled}" } },
        { type: "ListEditor", props: { path: "skills.search_paths", placeholder: "packages/agent-skills", quickPaths: ["packages/agent-skills"] } },
        { type: "SkillsRoster" },
      ],
    },
  },
  {
    key: "mcp",
    labelKey: "mcp",
    card: {
      type: "SettingCard",
      props: { title: "{state.t.mcp}", desc: "{state.t.settingsMcpDesc}" },
      children: [
        { type: "Setting", props: { path: "mcp.enabled", kind: "switch", label: "{state.t.enabled}" } },
        { type: "McpServers" },
      ],
    },
  },
  {
    key: "plugins",
    labelKey: "plugins",
    card: {
      type: "SettingCard",
      props: { title: "{state.t.plugins}", desc: "{state.t.settingsPluginsDesc}" },
      children: [
        { type: "Setting", props: { path: "plugins.enabled", kind: "switch", label: "{state.t.enabled}" } },
        { type: "ListEditor", props: { path: "plugins.search_paths", placeholder: "packages/plugins", quickPaths: ["packages/plugins"] } },
        { type: "PluginsRoster" },
        { type: "MarketplaceSources" },
        { type: "MarketplaceBrowser" },
      ],
    },
  },
];

const navItemBase: CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 8, cursor: "pointer", fontSize: 13, textAlign: "left", border: "none", width: "100%", transition: "background .15s, color .15s" };
const navItemActive: CSSProperties = { ...navItemBase, background: "var(--color-surface-muted)", color: "var(--color-primary)", fontWeight: 700, boxShadow: "inset 2px 0 0 var(--color-primary)" };
const navItemIdle: CSSProperties = { ...navItemBase, background: "transparent", color: "var(--color-text)", fontWeight: 500 };

// SettingsNav: 左侧分类菜单，active 项主题色左边框 + 浅背景；点击写 state.settingsSection
const SettingsNav: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = () => {
  const doc = useAirUIStore((s) => s.doc);
  const setDoc = useAirUIStore((s) => s.setDoc);
  const state = (doc?.state ?? {}) as Record<string, unknown>;
  const t = (state.t as Record<string, string> | undefined) ?? {};
  const current = (state.settingsSection as string) ?? "llm";
  const txt = (k: string) => t[k] ?? k;

  const select = (key: string) => {
    if (!doc) return;
    setDoc({ ...doc, state: setByPath(doc.state, "settingsSection", key) });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "12px 10px", width: 168, flexShrink: 0, borderRight: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
      {SETTINGS_SECTIONS.map((s) => {
        const active = s.key === current;
        return (
          <button
            key={s.key}
            onClick={() => select(s.key)}
            style={active ? navItemActive : navItemIdle}
            onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--color-surface-muted)"; }}
            onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
          >
            {txt(s.labelKey)}
          </button>
        );
      })}
    </div>
  );
};

// SettingsContent: 右侧内容区，读 state.settingsSection 渲染对应分类的 SettingCard
const SettingsContent: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = () => {
  const doc = useAirUIStore((s) => s.doc);
  const state = (doc?.state ?? {}) as Record<string, unknown>;
  const current = (state.settingsSection as string) ?? "llm";
  const section = SETTINGS_SECTIONS.find((s) => s.key === current) ?? SETTINGS_SECTIONS[1];
  // maxWidth: "none" 让 SettingCard 占满右侧，不再居中受限
  const card: Component = { ...section.card, props: { ...section.card.props, maxWidth: "none" } };
  return (
    <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 18, background: "var(--color-surface-muted)" }}>
      <AirUIComponent comp={card} />
    </div>
  );
};

// ── 能力 Roster：展示后端已发现的 skills / plugins（把配置从盲写变有反馈）────
const rosterLabelStyle: CSSProperties = { fontSize: 12, fontWeight: 700, color: "var(--color-text)" };
const rosterEmptyStyle: CSSProperties = { fontSize: 11, color: "var(--color-muted)", padding: "10px 12px", borderRadius: 8, border: "1px dashed var(--color-border)", background: "var(--color-surface-muted)" };
const rosterItemStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 2, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface)" };

// SkillsRoster: 读 state.skills（来自 /api/skills），展示已扫描到的技能清单
const SkillsRoster: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = () => {
  const doc = useAirUIStore((s) => s.doc);
  const state = (doc?.state ?? {}) as Record<string, unknown>;
  const t = (state.t as Record<string, string> | undefined) ?? {};
  const txt = (k: string) => t[k] ?? k;
  const skills = (Array.isArray(state.skills) ? state.skills : []) as Array<{ slug?: string; name?: string; description?: string }>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={rosterLabelStyle}>{txt("discoveredSkills")} · {skills.length}</span>
      {skills.length === 0 ? (
        <div style={rosterEmptyStyle}>{txt("noSkillsFound")}</div>
      ) : skills.map((s, i) => (
        <div key={s.slug || i} style={rosterItemStyle}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text)" }}>{s.name || s.slug}</span>
          {s.description && <span style={{ fontSize: 11, color: "var(--color-muted)" }}>{s.description}</span>}
        </div>
      ))}
    </div>
  );
};

// PluginsRoster: 读 state.plugins（来自 /api/plugins），展示已发现插件目录 + 诚实标注执行系统未实现
const PluginsRoster: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = () => {
  const doc = useAirUIStore((s) => s.doc);
  const state = (doc?.state ?? {}) as Record<string, unknown>;
  const t = (state.t as Record<string, string> | undefined) ?? {};
  const txt = (k: string) => t[k] ?? k;
  const plugins = (Array.isArray(state.plugins) ? state.plugins : []) as Array<{ name?: string; path?: string }>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={rosterLabelStyle}>{txt("discoveredPlugins")} · {plugins.length}</span>
        <span style={{ fontSize: 10, color: "var(--color-muted)", padding: "1px 7px", borderRadius: 6, border: "1px solid var(--color-border)" }}>{txt("pluginOnlyDiscovery")}</span>
      </div>
      {plugins.length === 0 ? (
        <div style={rosterEmptyStyle}>{txt("noPluginsFound")}</div>
      ) : plugins.map((p, i) => (
        <div key={p.name || i} style={rosterItemStyle}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text)" }}>{p.name}</span>
          {p.path && <span style={{ fontSize: 11, color: "var(--color-muted)" }}>{p.path}</span>}
        </div>
      ))}
    </div>
  );
};

// ── Plugin Marketplace：源管理 + 浏览/安装（git clone 到 search_paths[0]）─────
// MarketplaceSources: 编辑 draft.plugins.marketplaces（用户配置的清单 JSON URL）
const MarketplaceSources: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = () => {
  const doc = useAirUIStore((s) => s.doc);
  const setDoc = useAirUIStore((s) => s.setDoc);
  const state = (doc?.state ?? {}) as Record<string, unknown>;
  const t = (state.t as Record<string, string> | undefined) ?? {};
  const txt = (k: string) => t[k] ?? k;
  const path = "draft.plugins.marketplaces";
  const raw = doc ? getByPath(doc.state, path) : [];
  const sources: MarketplaceSource[] = Array.isArray(raw) ? (raw as MarketplaceSource[]) : [];

  const update = (next: MarketplaceSource[]) => {
    if (!doc) return;
    setDoc({ ...doc, state: setByPath(doc.state, path, next) });
  };
  const patch = (i: number, delta: Partial<MarketplaceSource>) =>
    update(sources.map((s, j) => (j === i ? { ...s, ...delta } : s)));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text)" }}>{txt("marketplaceSources")}</span>
        <div style={{ fontSize: 11, color: "var(--color-muted)", marginTop: 2 }}>{txt("marketplaceHint")}</div>
      </div>
      {sources.map((src, i) => (
        <div key={src.id} style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 8, background: "var(--color-surface-muted)" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input value={src.name} placeholder={txt("sourceNamePh")} onChange={(e) => patch(i, { name: e.target.value })} style={{ ...fieldStyle, flex: 1 }} />
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--color-text)", whiteSpace: "nowrap" }}>
              <input type="checkbox" checked={src.enabled} onChange={(e) => patch(i, { enabled: e.target.checked })} />
              on
            </label>
            <button onClick={() => update(sources.filter((_, j) => j !== i))} style={delBtnStyle}>×</button>
          </div>
          <input value={src.url} placeholder={txt("sourceUrlPh")} onChange={(e) => patch(i, { url: e.target.value })} style={fieldStyle} />
        </div>
      ))}
      <button
        onClick={() => update([...sources, { id: `m-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`, name: "", url: "", enabled: true }])}
        style={addBtnStyle}
      >{txt("addSource")}</button>
    </div>
  );
};

interface MarketPlugin {
  name: string;
  description: string;
  author: string;
  version: string;
  category: string;
  source: string;
  iconColor: string;
  installed: boolean;
}
interface MarketData {
  marketplaces: Array<{ id: string; name: string; url: string; ok: boolean; error?: string }>;
  plugins: MarketPlugin[];
}
const mpCardStyle = (installed: boolean): CSSProperties => ({ display: "flex", flexDirection: "column", gap: 8, padding: 14, borderRadius: 12, border: `1px solid ${installed ? "var(--color-success)" : "var(--color-border)"}`, background: "var(--color-surface)" });
const mpIconStyle = (color: string): CSSProperties => ({ width: 34, height: 34, borderRadius: 9, background: color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, flexShrink: 0 });

// MarketplaceBrowser: 拉取清单 → 网格展示 → 安装(git clone)/卸载，安装后同步刷新已发现清单
const MarketplaceBrowser: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = () => {
  const doc = useAirUIStore((s) => s.doc);
  const setDoc = useAirUIStore((s) => s.setDoc);
  const state = (doc?.state ?? {}) as Record<string, unknown>;
  const t = (state.t as Record<string, string> | undefined) ?? {};
  const txt = (k: string) => t[k] ?? k;
  const [data, setData] = useState<MarketData>({ marketplaces: [], plugins: [] });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/plugins/marketplace");
      setData(await res.json());
    } catch {
      setError(`${txt("refresh")} failed`);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void refresh(); }, []);

  // 安装/卸载后同步 state.plugins，让 PluginsRoster 立即反映
  const refreshInstalled = async () => {
    try {
      const res = await fetch("/api/plugins");
      const d = await res.json();
      if (doc) setDoc({ ...doc, state: setByPath(doc.state, "plugins", d.plugins || []) });
    } catch {
      /* 静默 */
    }
  };
  const setInstalled = (name: string, installed: boolean) =>
    setData((prev) => ({ ...prev, plugins: prev.plugins.map((p) => (p.name === name ? { ...p, installed } : p)) }));

  const install = async (p: MarketPlugin) => {
    setBusy(p.name);
    setError("");
    try {
      const res = await fetch("/api/plugins/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: p.source, name: p.name }) });
      const d = await res.json();
      if (d.ok) {
        setInstalled(p.name, true);
        await refreshInstalled();
      } else {
        setError(d.error || "install failed");
      }
    } finally {
      setBusy("");
    }
  };
  const uninstall = async (p: MarketPlugin) => {
    setBusy(p.name);
    setError("");
    try {
      const res = await fetch(`/api/plugins/${encodeURIComponent(p.name)}`, { method: "DELETE" });
      const d = await res.json();
      if (d.ok) {
        setInstalled(p.name, false);
        await refreshInstalled();
      } else {
        setError(d.error || "uninstall failed");
      }
    } finally {
      setBusy("");
    }
  };

  const failedCount = data.marketplaces.filter((s) => !s.ok).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text)" }}>{txt("marketplace")} · {data.plugins.length}</span>
        <button onClick={() => void refresh()} disabled={loading} style={{ ...activateBtnStyle, opacity: loading ? 0.6 : 1 }}>{loading ? txt("loading") : txt("refresh")}</button>
      </div>
      {failedCount > 0 && <div style={{ fontSize: 11, color: "var(--color-danger)" }}>{failedCount} {txt("sourceFailed")}</div>}
      {error && <div style={{ fontSize: 11, color: "var(--color-danger)" }}>{error}</div>}
      {data.plugins.length === 0 ? (
        <div style={rosterEmptyStyle}>{txt("marketplaceEmpty")}</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
          {data.plugins.map((p) => (
            <div key={p.name} style={mpCardStyle(p.installed)}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span style={mpIconStyle(p.iconColor || "#8B8F98")}>{(p.name || "?").charAt(0).toUpperCase()}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                  <div style={{ fontSize: 10, color: "var(--color-muted)" }}>{[p.author, p.version].filter(Boolean).join(" · ")}</div>
                </div>
              </div>
              {p.description && <div style={{ fontSize: 11, color: "var(--color-muted)", lineHeight: 1.4 }}>{p.description}</div>}
              <div>
                {p.installed ? (
                  <button onClick={() => void uninstall(p)} disabled={busy === p.name} style={{ ...addBtnStyle, color: "var(--color-danger)" }}>{busy === p.name ? txt("installing") : txt("uninstall")}</button>
                ) : (
                  <button onClick={() => void install(p)} disabled={busy === p.name || !p.source} style={activateBtnStyle}>{busy === p.name ? txt("installing") : (p.source ? txt("install") : "—")}</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

let registered = false;
/** 注册 console 专用自定义组件（幂等）�?*/
export function registerConsoleComponents() {
  if (registered) return;
  registered = true;
  registerComponent("Pane", Pane);
  registerComponent("ArtifactGallery", ArtifactGallery);
  registerComponent("InspectorSkills", InspectorSkills);
  registerComponent("RunTimeline", RunTimeline);
  registerComponent("Setting", Setting);
  registerComponent("ConnStatus", ConnStatus);
  registerComponent("Notice", Notice);
  registerComponent("Card", Card);
  registerComponent("SettingCard", SettingCard);
  registerComponent("ListEditor", ListEditor);
  registerComponent("McpServers", McpServers);
  registerComponent("LlmProviderPanel", LlmProviderPanel);
  registerComponent("SkillsRoster", SkillsRoster);
  registerComponent("PluginsRoster", PluginsRoster);
  registerComponent("MarketplaceSources", MarketplaceSources);
  registerComponent("MarketplaceBrowser", MarketplaceBrowser);
  registerComponent("SettingsNav", SettingsNav);
  registerComponent("SettingsContent", SettingsContent);
}
