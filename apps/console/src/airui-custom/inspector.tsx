import { type FC } from "react";
import type { Component } from "@air-ui/core";
import { useAirUIStore } from "@air-ui/renderer-react";
import { useStore } from "../store";

export const InspectorSkills: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = ({ resolvedProps }) => {
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

export const RunTimeline: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = ({ resolvedProps }) => {
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

