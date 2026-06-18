import { type FC, type CSSProperties, useState, useEffect } from "react";
import type { Component } from "@air-ui/core";
import { getByPath, setByPath } from "@air-ui/core";
import { useAirUIStore } from "@air-ui/renderer-react";
import { useStore, type MarketplaceSource } from "../store";
import { delBtnStyle, fieldStyle, addBtnStyle, activateBtnStyle, rosterEmptyStyle } from "./helpers";

export const MarketplaceSources: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = () => {
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
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text)" }}>{txt("marketplaceSources")}</span>
        <div style={{ fontSize: 11, color: "var(--color-muted)", marginTop: 2 }}>{txt("marketplaceHint")}</div>
      </div>
      {sources.map((src, i) => (
        <div key={src.id} style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", padding: 10, display: "flex", flexDirection: "column", gap: 8, background: "var(--color-surface-muted)" }}>
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
const mpCardStyle = (installed: boolean): CSSProperties => ({ display: "flex", flexDirection: "column", gap: 8, padding: 14, borderRadius: "var(--radius-md)", boxShadow: "var(--air-shadow)", border: `1px solid ${installed ? "var(--color-success)" : "var(--color-border)"}`, background: "var(--color-surface)" });
const mpIconStyle = (color: string): CSSProperties => ({ width: 34, height: 34, borderRadius: "var(--radius-sm)", background: color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 14, letterSpacing: "-0.01em", flexShrink: 0 });

// MarketplaceBrowser: 拉取清单 → 网格展示 → 安装(git clone)/卸载，安装后同步刷新已发现清单
export const MarketplaceBrowser: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = () => {
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
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text)" }}>{txt("marketplace")} · {data.plugins.length}</span>
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
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
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

// ModelFetcher: 调 /api/models 列出可用模型，点击选用写入 draft.model.name
