import type { CSSProperties } from "react";
import type { Component } from "@air-ui/core";

// ── 组件类型 / 字段归一化（LLM 容错）从 ConsoleView 迁出 ──────────

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


// ── 共享表单 style（Setting / ListEditor / McpServers / LlmProviderPanel / MarketplaceSources 共用）──

export const fieldStyle: CSSProperties = { width: "100%", height: 34, borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-text)", padding: "0 10px", outline: "none", fontSize: 13 };
export const fieldLabelStyle: CSSProperties = { display: "grid", gap: 6, fontSize: 12, fontWeight: 700, color: "var(--color-text)" };
export const delBtnStyle: CSSProperties = { flexShrink: 0, width: 34, height: 34, borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface-muted)", color: "var(--color-danger)", cursor: "pointer", fontSize: 16, lineHeight: 1 };
export const addBtnStyle: CSSProperties = { alignSelf: "flex-start", height: 30, padding: "0 12px", borderRadius: 8, border: "1px dashed var(--color-border-strong)", background: "transparent", color: "var(--color-text)", cursor: "pointer", fontSize: 12 };
export const toggleBtnStyle: CSSProperties = { position: "absolute", right: 10, top: 10, width: 24, height: 24, borderRadius: 6, border: "none", background: "var(--color-surface-muted)", color: "var(--color-text)", cursor: "pointer", fontSize: 12 };

// ── MCP 类型（home.tsx CapabilityHome + llm.tsx McpServers 共用）──
export type McpToolLite = { name?: string; description?: string; inputSchema?: { properties?: Record<string, { type?: string; description?: string }>; required?: string[] } };
export type McpServerLite = { name?: string; connected?: boolean; tools?: McpToolLite[] };

// ── 跨文件共享 style（llm + roster + marketplace）──
export const activateBtnStyle: CSSProperties = { flexShrink: 0, height: 30, padding: "0 14px", borderRadius: 8, border: "1px solid var(--color-primary)", background: "var(--color-primary)", color: "#fff", cursor: "pointer", fontSize: 11, fontWeight: 700 };
export const rosterEmptyStyle: CSSProperties = { fontSize: 11, color: "var(--color-muted)", padding: "10px 12px", borderRadius: 8, border: "1px dashed var(--color-border)", background: "var(--color-surface-muted)" };
