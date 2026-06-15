import { type FC, type CSSProperties } from "react";
import type { Component } from "@air-ui/core";
import { useAirUIStore } from "@air-ui/renderer-react";
import { useStore } from "../store";
import { rosterEmptyStyle } from "./helpers";

const rosterLabelStyle: CSSProperties = { fontSize: 12, fontWeight: 600, color: "var(--color-text)" };
const rosterItemStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 2, padding: "8px 12px", borderRadius: 10, border: "1px solid var(--color-border)", background: "var(--color-surface)" };

// SkillsRoster: 读 state.skills（来自 /api/skills），展示已扫描到的技能清单
export const SkillsRoster: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = () => {
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
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text)" }}>{s.name || s.slug}</span>
          {s.description && <span style={{ fontSize: 11, color: "var(--color-muted)" }}>{s.description}</span>}
        </div>
      ))}
    </div>
  );
};

// PluginsRoster: 读 state.plugins（来自 /api/plugins），展示已发现插件目录 + 诚实标注执行系统未实现
export const PluginsRoster: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = () => {
  const doc = useAirUIStore((s) => s.doc);
  const state = (doc?.state ?? {}) as Record<string, unknown>;
  const t = (state.t as Record<string, string> | undefined) ?? {};
  const txt = (k: string) => t[k] ?? k;
  const plugins = (Array.isArray(state.plugins) ? state.plugins : []) as Array<{ name?: string; path?: string }>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={rosterLabelStyle}>{txt("discoveredPlugins")} · {plugins.length}</span>
        <span style={{ fontSize: 10, color: "var(--color-muted)", padding: "1px 7px", borderRadius: 8, border: "1px solid var(--color-border)" }}>{txt("pluginOnlyDiscovery")}</span>
      </div>
      {plugins.length === 0 ? (
        <div style={rosterEmptyStyle}>{txt("noPluginsFound")}</div>
      ) : plugins.map((p, i) => (
        <div key={p.name || i} style={rosterItemStyle}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text)" }}>{p.name}</span>
          {p.path && <span style={{ fontSize: 11, color: "var(--color-muted)" }}>{p.path}</span>}
        </div>
      ))}
    </div>
  );
};

// ── Plugin Marketplace：源管理 + 浏览/安装（git clone 到 search_paths[0]）─────
// MarketplaceSources: 编辑 draft.plugins.marketplaces（用户配置的清单 JSON URL）
