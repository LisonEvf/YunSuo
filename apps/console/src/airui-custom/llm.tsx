import { type FC, type CSSProperties, useState, useEffect } from "react";
import type { Component } from "@air-ui/core";
import { getByPath, setByPath } from "@air-ui/core";
import { AirUIComponent, useAirUIStore } from "@air-ui/renderer-react";
import { useStore, type ProviderInstance, type MarketplaceSource } from "../store";
import { colorForProvider } from "../providerPresets";
import { sendChat } from "../chat";
import { fieldStyle, delBtnStyle, addBtnStyle, activateBtnStyle, type McpToolLite, type McpServerLite } from "./helpers";

// ── ConnStatus / Notice ──

export const ConnStatus: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = () => {
  const doc = useAirUIStore((s) => s.doc);
  const state = (doc?.state ?? {}) as Record<string, unknown>;
  const connected = state.connected === true;
  return <span style={{ color: connected ? "var(--color-success)" : "var(--color-danger)", fontWeight: 600, fontSize: 12 }}>{String(state.connText ?? "")}</span>;
};

export const Notice: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = ({ resolvedProps }) => {
  const doc = useAirUIStore((s) => s.doc);
  const state = (doc?.state ?? {}) as Record<string, unknown>;
  const field = (resolvedProps.field as string) ?? "settingsError";
  const message = String(state[field] ?? "");
  if (!message) return null;
  return <div style={{ color: "var(--color-danger)", fontSize: 12, fontWeight: 600 }}>{message}</div>;
};

// Card: like Widget but reads resolvedProps (Widget is engine-special-cased to raw comp.props,
// so {state.t.xxx} in its title would render literally). Used by the homepage preset.

const mcpBadgeStyle = (connected: boolean): CSSProperties => ({ flexShrink: 0, fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 8, background: connected ? "var(--color-success)" : "var(--color-surface-muted)", color: connected ? "#fff" : "var(--color-muted)", border: connected ? "none" : "1px solid var(--color-border)" });
const mcpExpandBtnStyle: CSSProperties = { flexShrink: 0, width: 28, height: 28, borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface-muted)", color: "var(--color-text)", cursor: "pointer", fontSize: 11, transition: "background .15s, border-color .15s" };
const mcpToolItemStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 1, padding: "6px 10px", borderRadius: 8, background: "var(--color-surface-muted)", fontSize: 11, border: "1px solid var(--color-border)" };

export const McpServers: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = () => {
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
                    <span style={{ fontWeight: 600, color: "var(--color-text)" }}>{tool.name}</span>
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
      >+ {txt("addServer")}</button>
     </div>
  );
};

// LlmProviderPanel: 预设网格一键回填 + 已保存 provider 卡片列表（切换/删除/保存为 provider）
// 设计借鉴 cc-switch ProviderCard（圆角卡片 + 品牌色块图标 + 激活态强调），
// 渲染层用 AIRUI 设计 token（CSS 变量）+ inline style，与 McpServers/Card 风格一致
const presetBtnStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 10, border: "1px solid var(--color-border)", background: "var(--color-surface)", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--color-text)", textAlign: "left", letterSpacing: "-0.005em", transition: "border-color .15s, background .15s" };
const iconBlockStyle = (color: string): CSSProperties => ({ flexShrink: 0, width: 34, height: 34, borderRadius: 8, background: color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 15, letterSpacing: "-0.01em" });
const cardBase: CSSProperties = { display: "flex", alignItems: "center", gap: 12, borderRadius: 10, padding: "12px 14px", transition: "border-color .15s" };
const modelFetchBtnStyle: CSSProperties = { height: 32, padding: "0 12px", borderRadius: 10, border: "1px solid var(--color-border)", background: "var(--color-surface-muted)", color: "var(--color-text)", cursor: "pointer", fontSize: 11 };

const initialOf = (name?: string) => {
  const s = (name || "").trim();
  return s ? s.charAt(0).toUpperCase() : "?";
};

export const LlmProviderPanel: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = () => {
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
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text)" }}>{txt("providerPresets")}</span>
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
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text)" }}>{txt("savedProviders")}</span>
          <button onClick={saveAsProvider} style={addBtnStyle}>+ {txt("saveAsProvider")}</button>
        </div>
        {providers.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "18px 14px", borderRadius: 10, border: "1px dashed var(--color-border)", background: "var(--color-surface-muted)", textAlign: "center" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text)" }}>{txt("noSavedProvidersTitle")}</span>
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
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name || p.model_name || "(unnamed)"}</span>
                  {active && <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 600, padding: "1px 7px", borderRadius: 8, background: color, color: "#fff" }}>{txt("currentProvider")}</span>}
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

// ── ModelFetcher ──

export const ModelFetcher: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = () => {
  const doc = useAirUIStore((s) => s.doc);
  const setDoc = useAirUIStore((s) => s.setDoc);
  const state = (doc?.state ?? {}) as Record<string, unknown>;
  const draft = (state.draft ?? {}) as Record<string, unknown>;
  const model = (draft.model ?? {}) as Record<string, unknown>;
  const t = (state.t as Record<string, string> | undefined) ?? {};
  const txt = (k: string) => t[k] ?? k;

  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelFetchError, setModelFetchError] = useState("");

  const setModelName = (name: string) => {
    if (!doc) return;
    setDoc({
      ...doc,
      state: { ...state, draft: { ...draft, model: { ...model, name } } },
    });
  };

 const fetchAvailableModels = async () => {
    if (!model.base_url || !model.api_key) {
      setModelFetchError(txt("modelFetchHint"));
      return;
    }
    setFetchingModels(true);
    setModelFetchError("");
    try {
      const response = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_url: model.base_url,
          api_key: model.api_key,
          provider: model.provider || "openai",
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setAvailableModels(data.models || []);
    } catch {
      setModelFetchError(txt("modelFetchFailed"));
    } finally {
      setFetchingModels(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <button
        onClick={fetchAvailableModels}
        disabled={fetchingModels}
        style={modelFetchBtnStyle}
      >
        {fetchingModels ? txt("fetchingModels") : txt("fetchModels")}
      </button>

      {modelFetchError && (
        <div style={{ fontSize: 11, color: "var(--color-danger)" }}>{modelFetchError}</div>
      )}

      {availableModels.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text)" }}>{txt("availableModels")}</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {availableModels.map((m) => {
              const active = m === model.name;
              return (
                <button
                  key={m}
                  onClick={() => setModelName(m)}
                  style={{
                    fontSize: 11,
                    padding: "4px 8px",
                    borderRadius: 8,
                    background: active ? "var(--color-primary)" : "var(--color-surface-muted)",
                    border: `1px solid ${active ? "var(--color-primary)" : "var(--color-border)"}`,
                    color: active ? "#fff" : "var(--color-text)",
                    cursor: "pointer",
                  }}
                >
                  {m}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

let registered = false;
/** 注册 console 专用自定义组件（幂等）�?*/
