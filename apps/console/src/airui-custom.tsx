import { type FC, type CSSProperties } from "react";
import type { Component } from "@air-ui/core";
import { getByPath, setByPath } from "@air-ui/core";
import { AirUIComponent, useAirUIStore, registerComponent } from "@air-ui/renderer-react";
import type { ProviderInstance } from "./store";
import { providerPresets } from "./providerPresets";

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
  const maxWidth = (resolvedProps.maxWidth as number | undefined) ?? 640;
  const sectionStyle: CSSProperties = { border: "1px solid var(--color-border)", borderRadius: 12, background: "var(--color-surface)", boxShadow: "var(--air-shadow)", overflow: "hidden", width: "100%", maxWidth };
  if (align === "left") { sectionStyle.marginLeft = 0; sectionStyle.marginRight = "auto"; }
  else if (align === "right") { sectionStyle.marginLeft = "auto"; sectionStyle.marginRight = 0; }
  else { sectionStyle.marginInline = "auto"; }
  return (
    <section style={sectionStyle}>
      {title && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface-muted)" }}>
          <span style={{ width: 3, height: 16, borderRadius: 2, background: "var(--color-primary)" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: "var(--color-text)" }}>{title}</span>
            {desc && <span style={{ fontSize: 11, color: "var(--color-muted)" }}>{desc}</span>}
          </div>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16 }}>
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
    </div>
  );
};

// McpServers: 编辑 draft.mcp.servers，每 server 一卡片（name/enabled/transport/命令或 url）
const McpServers: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = () => {
  const doc = useAirUIStore((s) => s.doc);
  const setDoc = useAirUIStore((s) => s.setDoc);
  const path = "draft.mcp.servers";
  const raw = doc ? getByPath(doc.state, path) : [];
  const servers: Array<Record<string, unknown>> = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];

  const update = (next: Array<Record<string, unknown>>) => {
    if (!doc) return;
    setDoc({ ...doc, state: setByPath(doc.state, path, next) });
  };
  const patch = (i: number, delta: Record<string, unknown>) =>
    update(servers.map((s, j) => (j === i ? { ...s, ...delta } : s)));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {servers.map((srv, i) => {
        const isStdio = Boolean(srv.command);
        const mode = isStdio ? "stdio" : ((srv.transport as string) || "http");
        return (
          <div key={i} style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 8, background: "var(--color-surface-muted)" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                value={String(srv.name || "")}
                placeholder="name"
                onChange={(e) => patch(i, { name: e.target.value })}
                style={{ ...fieldStyle, flex: 1 }}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--color-text)", whiteSpace: "nowrap" }}>
                <input type="checkbox" checked={srv.enabled !== false} onChange={(e) => patch(i, { enabled: e.target.checked })} />
                on
              </label>
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

// LlmProviderPanel: 预设一键回填 + 已保存 provider 列表（切换/删除/保存为 provider）
// 直接读写 draft.model / draft.providers / draft.active_provider_id，与 McpServers 风格一致
const actBtnStyle: CSSProperties = { flexShrink: 0, height: 28, padding: "0 10px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface-muted)", color: "var(--color-text)", cursor: "pointer", fontSize: 11 };
const providerRowActive: CSSProperties = { display: "flex", gap: 6, alignItems: "center", border: "1px solid var(--color-primary)", borderRadius: 8, padding: "6px 10px", background: "var(--color-surface-muted)" };
const providerRowIdle: CSSProperties = { display: "flex", gap: 6, alignItems: "center", border: "1px solid var(--color-border)", borderRadius: 8, padding: "6px 10px", background: "var(--color-surface)" };

const LlmProviderPanel: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = () => {
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
    const preset = providerPresets.find((p) => p.key === key);
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <label style={fieldLabelStyle}>
        {txt("providerPresets")}
        <select defaultValue="" onChange={(e) => { const v = e.target.value; if (v) applyPreset(v); e.target.value = ""; }} style={fieldStyle}>
          <option value="">{txt("providerPresetsHint")}</option>
          {providerPresets.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
        </select>
      </label>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text)" }}>{txt("savedProviders")}</div>
        {providers.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--color-muted)" }}>{txt("noSavedProviders")}</div>
        ) : providers.map((p) => {
          const active = p.id === activeId;
          return (
            <div key={p.id} style={active ? providerRowActive : providerRowIdle}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.name || p.model_name || "(unnamed)"}{" "}
                  {active && <span style={{ fontSize: 10, color: "var(--color-primary)" }}>[{txt("currentProvider")}]</span>}
                </span>
                <span style={{ fontSize: 10, color: "var(--color-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.model_name} · {p.base_url}</span>
              </div>
              {!active && <button onClick={() => activate(p.id)} style={actBtnStyle}>{txt("activateProvider")}</button>}
              <button onClick={() => remove(p.id)} style={delBtnStyle}>×</button>
            </div>
          );
        })}
        <button onClick={saveAsProvider} style={addBtnStyle}>+ {txt("saveAsProvider")}</button>
      </div>
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
}
