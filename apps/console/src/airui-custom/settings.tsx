import { type FC, type CSSProperties, useState, useId } from "react";
import Icon, { type IconName } from "../components/Icon";
import type { Component } from "@air-ui/core";
import { getByPath, setByPath } from "@air-ui/core";
import { AirUIComponent, useAirUIStore } from "@air-ui/renderer-react";
import { fieldStyle, fieldLabelStyle, delBtnStyle, addBtnStyle, toggleBtnStyle } from "./helpers";
import type { HomeStarter } from "../store";
import type { HomeWidget } from "../store";
import { useStore, type DomainTemplate } from "../store";

export const Setting: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = ({ resolvedProps }) => {
  const doc = useAirUIStore((s) => s.doc);
  const setDoc = useAirUIStore((s) => s.setDoc);
  const rel = resolvedProps.path as string;
  const path = `draft.${rel}`;
  const value = doc ? getByPath(doc.state, path) : undefined;
 const kind = (resolvedProps.kind as string) ?? "text";
 const label = resolvedProps.label as string | undefined;
 const options = (resolvedProps.options as Array<{ value: string; label: string }>) ?? [];
  const placeholder = resolvedProps.placeholder as string | undefined;
 const fieldId = useId();

 const txt = (((doc?.state as Record<string, unknown> | undefined)?.t as Record<string, string> | undefined) ?? {});

 const update = (next: unknown) => {
   if (!doc) return;
   setDoc({ ...doc, state: setByPath(doc.state, path, next) });
 };

 const [showPassword, setShowPassword] = useState(kind === "password" ? false : undefined);

  // If the current value isn't among the select options, inject it so the
  // dropdown shows the actual value instead of silently defaulting.
  const selectOptions = kind === "select" && value != null && String(value) && !options.some((o) => o.value === String(value))
    ? [{ value: String(value), label: String(value) }, ...options]
    : options;

 return (
   <label htmlFor={fieldId} style={fieldLabelStyle}>
     {label}
     {kind === "switch" ? (
       <input id={fieldId} type="checkbox" checked={Boolean(value)} onChange={(e) => update(e.target.checked)} style={{ width: 16, height: 16 }} />
     ) : kind === "select" ? (
        <select id={fieldId} value={String(value ?? "")} onChange={(e) => update(e.target.value)} style={fieldStyle}>
          {selectOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
       </select>
     ) : kind === "textarea" ? (
       <textarea
         id={fieldId}
         value={String(value ?? "")}
         rows={(resolvedProps.rows as number) ?? 4}
         placeholder={placeholder}
         onChange={(e) => update(e.target.value)}
         style={{ ...fieldStyle, minHeight: 90, resize: "vertical", fontFamily: "inherit", lineHeight: 1.55 }}
       />
     ) : (
       <div style={{ position: "relative" }}>
         <input
           id={fieldId}
           type={kind === "password" && showPassword ? "text" : kind === "password" ? "password" : kind === "number" ? "number" : "text"}
           value={kind === "number" ? Number(value ?? 0) : String(value ?? "")}
           min={kind === "number" ? 1 : undefined}
            placeholder={placeholder}
           onChange={(e) => update(kind === "number" ? Number(e.target.value || 1) : e.target.value)}
           style={fieldStyle}
         />
         {kind === "password" && (
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              style={toggleBtnStyle}
              title={showPassword ? txt.hidePassword : txt.showPassword}
              aria-label={showPassword ? txt.hidePassword : txt.showPassword}
            >
              <Icon name={showPassword ? "eyeOff" : "eye"} size={14} />
            </button>
          )}
        </div>
      )}
    </label>
  );
};


export const SettingCard: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = ({ comp, resolvedProps }) => {
  const title = resolvedProps.title as string | undefined;
  const desc = resolvedProps.desc as string | undefined;
  const align = (resolvedProps.align as string) ?? "center";
  const maxWidth = (resolvedProps.maxWidth as string | number | undefined) ?? 640;
  const sectionStyle: CSSProperties = { border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", background: "var(--color-surface)", boxShadow: "var(--air-shadow)", overflow: "hidden", width: "100%", maxWidth };
  if (align === "left") { sectionStyle.marginLeft = 0; sectionStyle.marginRight = "auto"; }
  else if (align === "right") { sectionStyle.marginLeft = "auto"; sectionStyle.marginRight = 0; }
  else { sectionStyle.marginInline = "auto"; }
  return (
    <section style={sectionStyle}>
      {title && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface-muted)" }}>
          <span style={{ width: 3, height: 16, borderRadius: 2, background: "var(--color-primary)" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontWeight: 600, fontSize: 14, color: "var(--color-text)", letterSpacing: "-0.015em" }}>{title}</span>
            {desc && <span style={{ fontSize: 11, color: "var(--color-muted)" }}>{desc}</span>}
          </div>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 18 }}>
        {comp.children?.map((child, i) => <AirUIComponent key={child.ref ?? i} comp={child} />)}
      </div>
    </section>
  );
};

// ListEditor: 编辑 draft 上的 string[]（如 search_paths），每行一项 + 增删
export const ListEditor: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = ({ resolvedProps }) => {
  const doc = useAirUIStore((s) => s.doc);
  const setDoc = useAirUIStore((s) => s.setDoc);
  const path = `draft.${resolvedProps.path as string}`;
  const raw = doc ? getByPath(doc.state, path) : [];
  const items: string[] = Array.isArray(raw) ? raw.map((x) => String(x)) : [];
  const placeholder = (resolvedProps.placeholder as string) || "";
  const quickPaths = (resolvedProps.quickPaths as string[] | undefined) ?? [];
  const t = ((doc?.state as Record<string, unknown> | undefined)?.t as Record<string, string> | undefined) ?? {};
  const txt = (k: string) => t[k] ?? k;
  const listId = useId();
  const listLabel = txt((resolvedProps.labelKey as string) ?? "") || placeholder || txt("addItem");
  const quickChipStyle = (used: boolean): CSSProperties => ({ height: 28, padding: "0 12px", borderRadius: "var(--radius-input)", border: `1px solid ${used ? "var(--color-border)" : "var(--color-border-strong)"}`, background: "transparent", color: used ? "var(--color-muted)" : "var(--color-text)", cursor: used ? "default" : "pointer", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 });

  const update = (next: string[]) => {
    if (!doc) return;
    setDoc({ ...doc, state: setByPath(doc.state, path, next) });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span id={listId} className="sr-only">{listLabel}</span>
      {items.map((item, i) => (
        <div key={i} style={{ display: "flex", gap: 6 }}>
          <input
            value={item}
            placeholder={placeholder}
            aria-label={listLabel}
            onChange={(e) => update(items.map((x, j) => (j === i ? e.target.value : x)))}
            style={fieldStyle}
          />
          <button onClick={() => update(items.filter((_, j) => j !== i))} style={delBtnStyle}>×</button>
        </div>
      ))}
      <button onClick={() => update([...items, ""])} style={addBtnStyle}>+ {txt("addItem")}</button>
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

// WidgetsEditor: 编辑 draft.home.widgets — 自定义起始页的「实时数据卡片」
// 每个卡片直连一个 MCP 工具（不经 LLM），后端把返回数据归一为 Table/KPI/Text 渲染。
export const WidgetsEditor: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = () => {
  const doc = useAirUIStore((s) => s.doc);
  const setDoc = useAirUIStore((s) => s.setDoc);
  const path = "draft.home.widgets";
  const raw = doc ? getByPath(doc.state, path) : [];
  const items: HomeWidget[] = Array.isArray(raw) ? (raw as HomeWidget[]) : [];
  const t = ((doc?.state as Record<string, unknown> | undefined)?.t as Record<string, string> | undefined) ?? {};
  const txt = (k: string) => t[k] ?? k;

  const update = (next: HomeWidget[]) => {
    if (!doc) return;
    setDoc({ ...doc, state: setByPath(doc.state, path, next) });
  };

  const rowStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, padding: "10px 10px 10px 12px", border: "1px solid var(--color-border)", borderRadius: "var(--radius-input)", background: "var(--color-surface-muted)" };
  const fieldRow: CSSProperties = { display: "flex", gap: 6, alignItems: "center" };
  const mini: CSSProperties = { ...fieldStyle, padding: "7px 10px", fontSize: 12 };
  const label: CSSProperties = { fontSize: 10, fontWeight: 700, color: "var(--color-muted)", letterSpacing: "0.04em", textTransform: "uppercase", width: 64, flexShrink: 0 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.length > 0 && (
        <div style={{ fontSize: 11, color: "var(--color-muted)", lineHeight: 1.5 }}>
          {txt("widgetsHint")}
        </div>
      )}
      {items.map((item, i) => (
        <WidgetRow
          key={i}
          widget={item}
          txt={txt}
          styles={{ rowStyle, fieldRow, mini, label }}
          onChange={(patch) => update(items.map((x, j) => (j === i ? { ...x, ...patch } : x)))}
          onDelete={() => update(items.filter((_, j) => j !== i))}
        />
      ))}
      <button
        onClick={() => update([...items, { ref: "widget-" + Date.now(), title: "", tool: "", kind: "auto", colSpan: 6 }])}
        style={addBtnStyle}
      >
        + {txt("widgetsAdd")}
      </button>
    </div>
  );
};

const WidgetRow: FC<{
  widget: HomeWidget;
  txt: (k: string) => string;
  styles: { rowStyle: CSSProperties; fieldRow: CSSProperties; mini: CSSProperties; label: CSSProperties };
  onChange: (patch: Partial<HomeWidget>) => void;
  onDelete: () => void;
}> = ({ widget, txt, styles, onChange, onDelete }) => {
  const [argsText, setArgsText] = useState(() => widget.args ? JSON.stringify(widget.args) : "");
  const [colsText, setColsText] = useState(() => (widget.columns ?? []).join(", "));
  const [actionsText, setActionsText] = useState(
    () => (widget.actions ?? []).map((a) => a.label + " | " + a.prompt + (a.variant === "primary" ? " | primary" : "")).join("\n")
  );
  const { rowStyle, fieldRow, mini, label } = styles;

  return (
    <div style={rowStyle}>
      <div style={fieldRow}>
        <input
          value={widget.title ?? ""}
          placeholder={txt("widgetsTitlePh")}
          onChange={(e) => onChange({ title: e.target.value })}
          style={{ ...mini, flex: "1 1 auto" }}
        />
        <button onClick={onDelete} style={{ ...delBtnStyle, marginLeft: "auto" }} title={txt("delete")} aria-label={txt("delete")}>×</button>
      </div>
      <div style={fieldRow}>
        <span style={label}>tool</span>
        <input
          value={widget.tool ?? ""}
          placeholder={txt("widgetsToolPh")}
          onChange={(e) => onChange({ tool: e.target.value })}
          style={mini}
        />
      </div>
      <div style={fieldRow}>
        <span style={label}>{txt("widgetsKind")}</span>
        <select value={widget.kind ?? "auto"} onChange={(e) => onChange({ kind: e.target.value as HomeWidget["kind"] })} style={{ ...mini, flex: "0 0 96px" }}>
          <option value="auto">auto</option>
          <option value="table">table</option>
          <option value="kpi">kpi</option>
          <option value="text">text</option>
        </select>
        <span style={label}>{txt("widgetsSpan")}</span>
        <select value={String(widget.colSpan ?? 6)} onChange={(e) => onChange({ colSpan: Number(e.target.value) })} style={{ ...mini, flex: "0 0 64px" }}>
          {[3, 4, 6, 8, 12].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <div style={fieldRow}>
        <span style={label}>path</span>
        <input value={widget.path ?? ""} placeholder={txt("widgetsPathPh")} onChange={(e) => onChange({ path: e.target.value || undefined })} style={mini} />
        <span style={label}>{txt("widgetsValue")}</span>
        <input value={widget.valueKey ?? ""} placeholder={txt("widgetsValuePh")} onChange={(e) => onChange({ valueKey: e.target.value || undefined })} style={mini} />
      </div>
      <div style={fieldRow}>
        <span style={label}>{txt("widgetsCols")}</span>
        <input
          value={colsText}
          placeholder={txt("widgetsColsPh")}
          onChange={(e) => {
            setColsText(e.target.value);
            const cols = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
            onChange({ columns: cols.length ? cols : undefined });
          }}
          style={mini}
        />
      </div>
      <div style={fieldRow}>
        <span style={label}>args</span>
        <input
          value={argsText}
          placeholder={txt("widgetsArgsPh")}
          onChange={(e) => {
            setArgsText(e.target.value);
 try {
              const parsed = e.target.value.trim() ? JSON.parse(e.target.value) : {};
              if (parsed && typeof parsed === "object") onChange({ args: parsed });
 } catch { /* allow free typing until valid JSON */ }
          }}
          style={mini}
        />
      </div>
      <div style={fieldRow}>
        <span style={label}>{txt("widgetsActions")}</span>
        <input
          value={actionsText}
          placeholder={txt("widgetsActionsPh")}
          onChange={(e) => {
            setActionsText(e.target.value);
            const acts = e.target.value.split("\n").map((line) => {
              const parts = line.split("|").map((s) => s.trim());
              if (parts.length < 2 || !parts[0]) return null;
              const a: { label: string; prompt: string; variant?: "primary" | "secondary" } = { label: parts[0], prompt: parts[1] };
              if (parts[2] === "primary") a.variant = "primary";
              return a;
            }).filter(Boolean) as { label: string; prompt: string; variant?: "primary" | "secondary" }[];
            onChange({ actions: acts.length ? (acts as HomeWidget["actions"]) : undefined });
          }}
          style={mini}
        />
      </div>
    </div>
  );
};

// McpServers: 编辑 draft.mcp.servers，每 server 一卡片（name/enabled/transport/命令或 url）
// StartersEditor: 编辑 draft.home.starters — 自定义起始页的一键入口（UI 循环起点）
export const StartersEditor: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = () => {
  const doc = useAirUIStore((s) => s.doc);
  const setDoc = useAirUIStore((s) => s.setDoc);
  const path = "draft.home.starters";
  const raw = doc ? getByPath(doc.state, path) : [];
  const items: HomeStarter[] = Array.isArray(raw) ? (raw as HomeStarter[]) : [];
  const t = ((doc?.state as Record<string, unknown> | undefined)?.t as Record<string, string> | undefined) ?? {};
  const txt = (k: string) => t[k] ?? k;

  const update = (next: HomeStarter[]) => {
    if (!doc) return;
    setDoc({ ...doc, state: setByPath(doc.state, path, next) });
  };

  const starterRow: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, padding: "10px 10px 10px 12px", border: "1px solid var(--color-border)", borderRadius: "var(--radius-input)", background: "var(--color-surface-muted)" };
  const starterFieldRow: CSSProperties = { display: "flex", gap: 6, alignItems: "center" };
  const miniInput: CSSProperties = { ...fieldStyle, padding: "7px 10px", fontSize: 12 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((item, i) => (
        <div key={i} style={starterRow}>
          <div style={starterFieldRow}>
            <input
              value={item.label ?? ""}
              placeholder={txt("homeStarterLabelPh")}
              onChange={(e) => update(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
              style={{ ...miniInput, flex: "0 0 120px" }}
            />
            <select
              value={item.variant ?? "secondary"}
              onChange={(e) => update(items.map((x, j) => (j === i ? { ...x, variant: e.target.value as HomeStarter["variant"] } : x)))}
              style={{ ...miniInput, flex: "0 0 96px" }}
            >
              <option value="primary">{txt("homeStarterPrimary")}</option>
              <option value="secondary">{txt("homeStarterSecondary")}</option>
            </select>
            <button onClick={() => update(items.filter((_, j) => j !== i))} style={{ ...delBtnStyle, marginLeft: "auto" }} title={txt("delete")} aria-label={txt("delete")}>×</button>
          </div>
          <input
            value={item.prompt ?? ""}
            placeholder={txt("homeStarterPromptPh")}
            onChange={(e) => update(items.map((x, j) => (j === i ? { ...x, prompt: e.target.value } : x)))}
            style={miniInput}
          />
        </div>
      ))}
      <button onClick={() => update([...items, { label: "", prompt: "", variant: items.length === 0 ? "primary" : "secondary" }])} style={addBtnStyle}>+ {txt("homeStarterAdd")}</button>
    </div>
  );
};

// McpServers: 配置 + 运行时状态合并。读 draft.mcp.servers（配置）与 state.mcpServers
// （/api/mcp/status 反馈），按 name 匹配，每个 server 卡片显示连接徽章 + 可展开工具清单 + 重连入口

interface SettingsSectionDef {
  key: string;
  labelKey: string;
  card: Component;
}

const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  {
    key: "domain",
    labelKey: "domainSection",
    card: {
      type: "SettingCard",
      props: { title: "{state.t.domainSection}", desc: "{state.t.settingsDomainDesc}" },
      children: [
        { type: "DomainTemplates" },
        { type: "Setting", props: { path: "system_prompt", kind: "textarea", label: "{state.t.systemPrompt}", placeholder: "{state.t.systemPromptPh}", rows: 10 } },
      ],
    },
  },
  {
    key: "home",
    labelKey: "homeSection",
    card: {
      type: "SettingCard",
      props: { title: "{state.t.homeSection}", desc: "{state.t.settingsHomeDesc}" },
      children: [
        { type: "Setting", props: { path: "home.title", kind: "text", label: "{state.t.homeSectionTitle}", placeholder: "{state.t.homeSectionTitlePh}" } },
        { type: "Setting", props: { path: "home.subtitle", kind: "text", label: "{state.t.homeSectionSubtitle}", placeholder: "{state.t.homeSectionSubtitlePh}" } },
       { type: "Setting", props: { path: "home.enabled", kind: "switch", label: "{state.t.homeSectionEnabled}" } },
       { type: "StartersEditor" },
       { type: "WidgetsEditor" },
     ],
    },
  },
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
        { type: "Setting", props: { path: "model.provider", kind: "select", label: "{state.t.provider}", options: [
          { value: "openai", label: "OpenAI 兼容" },
          { value: "llamacpp", label: "llama.cpp (本地)" },
          { value: "ollama", label: "Ollama (本地)" },
          { value: "anthropic", label: "Anthropic" },
        ] } },
        { type: "Setting", props: { path: "model.base_url", kind: "text", label: "{state.t.baseUrl}", placeholder: "https://api.openai.com/v1" } },
        { type: "Setting", props: { path: "model.api_key", kind: "password", label: "{state.t.apiKey}" } },
        { type: "ModelFetcher" },
        { type: "Setting", props: { path: "model.name", kind: "text", label: "{state.t.modelName}", placeholder: "gpt-4o" } },
        { type: "Setting", props: { path: "model.display_name", kind: "text", label: "{state.t.displayName}", placeholder: "{state.t.providerNamePlaceholder}" } },
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

const navItemBase: CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: "var(--radius-input)", cursor: "pointer", fontSize: 13, textAlign: "left", border: "none", width: "100%", transition: "background .15s, color .15s" };
const navItemActive: CSSProperties = { ...navItemBase, background: "var(--color-surface-muted)", color: "var(--color-primary)", fontWeight: 600, boxShadow: "inset 2px 0 0 var(--color-primary)" };
const navItemIdle: CSSProperties = { ...navItemBase, background: "transparent", color: "var(--color-text)", fontWeight: 500 };

// SettingsNav: 左侧分类菜单，active 项主题色左边框 + 浅背景；点击写 state.settingsSection
export const SettingsNav: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = () => {
  const doc = useAirUIStore((s) => s.doc);
  const setDoc = useAirUIStore((s) => s.setDoc);
  const state = (doc?.state ?? {}) as Record<string, unknown>;
  const t = (state.t as Record<string, string> | undefined) ?? {};
  const current = (state.settingsSection as string) ?? "domain";
  const txt = (k: string) => t[k] ?? k;

  const select = (key: string) => {
    if (!doc) return;
    setDoc({ ...doc, state: setByPath(doc.state, "settingsSection", key) });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "10px 8px", width: 160, flexShrink: 0, borderRight: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
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
export const SettingsContent: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = () => {
  const doc = useAirUIStore((s) => s.doc);
  const state = (doc?.state ?? {}) as Record<string, unknown>;
  const current = (state.settingsSection as string) ?? "domain";
  const section = SETTINGS_SECTIONS.find((sec) => sec.key === current) ?? SETTINGS_SECTIONS[0];
  // maxWidth: "none" 让 SettingCard 占满右侧，不再居中受限
  const card: Component = { ...section.card, props: { ...section.card.props, maxWidth: "none" } };
  return (
    <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 16, background: "var(--color-surface-muted)" }}>
      <AirUIComponent comp={card} />
    </div>
  );
};

// ── 能力 Roster：展示后端已发现的 skills / plugins（把配置从盲写变有反馈）────

// ── DomainTemplates: one-click domain template switcher ──
// Lists built-in + user templates from appConfig.domain_templates. Clicking a
// template writes home (overwrite) + system_prompt (overwrite) + mcp.servers
// (append) into the active draft, so the user tailors the console into a
// specialized SaaS in one action. Mirrors how Setting writes draft via setByPath.
export const DomainTemplates: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = () => {
  const doc = useAirUIStore((s) => s.doc);
  const setDoc = useAirUIStore((s) => s.setDoc);
  const templates = useStore((s) => s.appConfig.domain_templates) ?? [];
  const txt = (((doc?.state as Record<string, unknown> | undefined)?.t as Record<string, string> | undefined) ?? {});

  const apply = (tpl: DomainTemplate) => {
    if (!doc) return;
    let next = { ...doc.state } as Record<string, unknown>;
    const draft = { ...((next.draft as Record<string, unknown>) ?? {}) } as Record<string, unknown>;
    // system_prompt: overwrite (a domain switch replaces persona entirely)
    if (tpl.system_prompt !== undefined) draft.system_prompt = tpl.system_prompt;
    // home: overwrite title/subtitle/starters (a domain switch replaces the entry page)
    if (tpl.home) {
      const curHome = { ...((draft.home as Record<string, unknown>) ?? {}) };
      if (tpl.home.title !== undefined) curHome.title = tpl.home.title;
      if (tpl.home.subtitle !== undefined) curHome.subtitle = tpl.home.subtitle;
      if (tpl.home.starters !== undefined) curHome.starters = tpl.home.starters.map((s) => ({ ...s }));
      if (tpl.home.enabled !== undefined) curHome.enabled = tpl.home.enabled;
      draft.home = curHome;
    }
    // mcp.servers: append (data sources are infrastructure; never clobber)
    if (tpl.mcp?.servers?.length) {
      const curMcp = { ...((draft.mcp as Record<string, unknown>) ?? {}) };
      const curServers = (curMcp.servers as Array<Record<string, unknown>>) ?? [];
      curMcp.servers = [...curServers, ...tpl.mcp.servers.map((s) => ({ ...s }))];
      draft.mcp = curMcp;
    }
    next.draft = draft;
    setDoc({ ...doc, state: next });
  };

  if (!templates.length) return null;

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)", marginBottom: 4 }}>{txt.domainTemplates}</div>
      <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 12, lineHeight: 1.5 }}>{txt.domainTemplatesDesc}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
        {templates.map((tpl) => {
          const iconColor = "var(--color-primary)";
          return (
            <div key={tpl.key} style={{
              background: "var(--color-surface)", border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-card)", padding: 14, display: "flex", flexDirection: "column", gap: 8,
              boxShadow: "var(--shadow-panel)", minWidth: 0,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span style={{ width: 30, height: 30, borderRadius: 9, background: "var(--color-primary-soft, rgba(139,126,200,0.12))", color: iconColor, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon name={((tpl.icon as IconName) ?? "sparkles")} size={16} />
                </span>
                <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{tpl.name}</span>
              </div>
              {tpl.description ? (
                <div style={{ fontSize: 12, color: "var(--color-text-muted)", lineHeight: 1.5, flex: 1, minHeight: 0 }}>{tpl.description}</div>
              ) : null}
              <button
                type="button"
                onClick={() => apply(tpl)}
                style={{
                  alignSelf: "flex-start", padding: "6px 16px", borderRadius: "var(--radius-pill)",
                  border: "1px solid var(--color-primary)", background: "var(--color-primary)", color: "#fff",
                  fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "opacity 0.15s",
                }}
              >
                {txt.applyTemplate}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
