import { type FC, type CSSProperties, useState } from "react";
import Icon from "../components/Icon";
import type { Component } from "@air-ui/core";
import { getByPath, setByPath } from "@air-ui/core";
import { AirUIComponent, useAirUIStore } from "@air-ui/renderer-react";
import { fieldStyle, fieldLabelStyle, delBtnStyle, addBtnStyle, toggleBtnStyle } from "./helpers";

export const Setting: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = ({ resolvedProps }) => {
  const doc = useAirUIStore((s) => s.doc);
  const setDoc = useAirUIStore((s) => s.setDoc);
  const rel = resolvedProps.path as string;
  const path = `draft.${rel}`;
  const value = doc ? getByPath(doc.state, path) : undefined;
  const kind = (resolvedProps.kind as string) ?? "text";
  const label = resolvedProps.label as string | undefined;
  const options = (resolvedProps.options as Array<{ value: string; label: string }>) ?? [];

  const txt = (((doc?.state as Record<string, unknown> | undefined)?.t as Record<string, string> | undefined) ?? {});

  const update = (next: unknown) => {
    if (!doc) return;
    setDoc({ ...doc, state: setByPath(doc.state, path, next) });
  };

  const [showPassword, setShowPassword] = useState(kind === "password" ? false : undefined);

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
        <div style={{ position: "relative" }}>
          <input
            type={kind === "password" && showPassword ? "text" : kind === "password" ? "password" : kind === "number" ? "number" : "text"}
            value={kind === "number" ? Number(value ?? 0) : String(value ?? "")}
            min={kind === "number" ? 1 : undefined}
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
  const sectionStyle: CSSProperties = { border: "1px solid var(--color-border)", borderRadius: 12, background: "var(--color-surface)", boxShadow: "var(--air-shadow)", overflow: "hidden", width: "100%", maxWidth };
  if (align === "left") { sectionStyle.marginLeft = 0; sectionStyle.marginRight = "auto"; }
  else if (align === "right") { sectionStyle.marginLeft = "auto"; sectionStyle.marginRight = 0; }
  else { sectionStyle.marginInline = "auto"; }
  return (
    <section style={sectionStyle}>
      {title && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface-muted)" }}>
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
  const quickChipStyle = (used: boolean): CSSProperties => ({ height: 28, padding: "0 10px", borderRadius: 10, border: `1px solid ${used ? "var(--color-border)" : "var(--color-border-strong)"}`, background: "transparent", color: used ? "var(--color-muted)" : "var(--color-text)", cursor: used ? "default" : "pointer", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 });

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

// McpServers: 编辑 draft.mcp.servers，每 server 一卡片（name/enabled/transport/命令或 url）
// McpServers: 配置 + 运行时状态合并。读 draft.mcp.servers（配置）与 state.mcpServers
// （/api/mcp/status 反馈），按 name 匹配，每个 server 卡片显示连接徽章 + 可展开工具清单 + 重连入口

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
        { type: "ModelFetcher" },
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

const navItemBase: CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, cursor: "pointer", fontSize: 13, textAlign: "left", border: "none", width: "100%", transition: "background .15s, color .15s" };
const navItemActive: CSSProperties = { ...navItemBase, background: "var(--color-surface-muted)", color: "var(--color-primary)", fontWeight: 600, boxShadow: "inset 2px 0 0 var(--color-primary)" };
const navItemIdle: CSSProperties = { ...navItemBase, background: "transparent", color: "var(--color-text)", fontWeight: 500 };

// SettingsNav: 左侧分类菜单，active 项主题色左边框 + 浅背景；点击写 state.settingsSection
export const SettingsNav: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = () => {
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
  const current = (state.settingsSection as string) ?? "llm";
  const section = SETTINGS_SECTIONS.find((s) => s.key === current) ?? SETTINGS_SECTIONS[1];
  // maxWidth: "none" 让 SettingCard 占满右侧，不再居中受限
  const card: Component = { ...section.card, props: { ...section.card.props, maxWidth: "none" } };
  return (
    <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 16, background: "var(--color-surface-muted)" }}>
      <AirUIComponent comp={card} />
    </div>
  );
};

// ── 能力 Roster：展示后端已发现的 skills / plugins（把配置从盲写变有反馈）────
