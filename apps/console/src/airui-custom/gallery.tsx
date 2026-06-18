import { type FC, useState } from "react";
import type { Component } from "@air-ui/core";
import { AirUIComponent, useAirUIStore } from "@air-ui/renderer-react";
import type { ArtifactPanel } from "./helpers";
import { CapabilityHome, WikiHome } from "./home";
import { savePreset } from "./presets";
import { sendChat } from "../chat";
import { useStore } from "../store";

export const ArtifactGallery: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = ({ resolvedProps }) => {
  const doc = useAirUIStore((s) => s.doc);
  const setDoc = useAirUIStore((s) => s.setDoc);
  const state = (doc?.state ?? {}) as Record<string, unknown>;
  const loading = useStore((s) => s.chatLoading);

  // Hooks 必须在条件 return 之前
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [dragOverItem, setDragOverItem] = useState<string | null>(null);

  if (state.wikiOpen === true) {
    return <WikiHome />;
  }
  const artifacts = ((state.artifacts as ArtifactPanel[]) ?? []);
  const homePinned = state.homePinned === true;
  if (!artifacts.length || homePinned) {
    return <CapabilityHome />;
  }

  const handleDragStart = (e: React.DragEvent, ref: string) => {
    e.dataTransfer.setData('text/plain', ref);
    setDraggedItem(ref);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, ref: string) => {
    e.preventDefault();
    if (ref !== draggedItem) {
      setDragOverItem(ref);
    }
  };

  const handleDragLeave = () => {
    setDragOverItem(null);
  };

  const handleDrop = (e: React.DragEvent, targetRef: string) => {
    e.preventDefault();
    const draggedRef = e.dataTransfer.getData('text/plain');
    if (draggedRef && draggedRef !== targetRef && doc) {
      const fromIdx = artifacts.findIndex(a => a.ref === draggedRef);
      const toIdx = artifacts.findIndex(a => a.ref === targetRef);
      if (fromIdx >= 0 && toIdx >= 0) {
        const next = [...artifacts];
        const [moved] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, moved);
        setDoc({ ...doc, state: { ...state, artifacts: next } });
      }
    }
    setDraggedItem(null);
    setDragOverItem(null);
  };

  const handleSaveAsPreset = (artifactRef: string) => {
    const artifact = artifacts.find(a => a.ref === artifactRef);
    if (!artifact) return;
    const name = window.prompt("预设名称", artifact.title || artifactRef);
    if (!name) return;
    savePreset({ name, component: artifact.component, title: artifact.title });
  };

  return (
    <div className="artifact-gallery-grid">
      {artifacts.map((artifact) => (
        <div
          key={artifact.ref}
          draggable
          onDragStart={(e) => handleDragStart(e, artifact.ref)}
          onDragOver={(e) => handleDragOver(e, artifact.ref)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, artifact.ref)}
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-card)",
            background: "var(--color-surface)",
            overflow: "hidden",
            cursor: "move",
            boxShadow: "var(--air-shadow)",
            position: "relative"
          }}
          data-col-span={artifact.colSpan ?? ""}
          data-row-span={artifact.rowSpan ?? ""}
        >
          {/* Headless card: no title bar. Save-as-preset floats top-right,
              faint by default and strengthens on hover, so the artifact
              content stays the visual focus. */}
          <button
            onClick={() => handleSaveAsPreset(artifact.ref)}
            className="gallery-save-btn"
            title="保存为预设"
            aria-label="保存为预设"
          >
            📦
          </button>
          <span className="gallery-ref-tag">{artifact.ref}</span>
          <div className="airui-gallery-card" style={{ padding: 12 }}>
            <AirUIComponent comp={artifact.component} />
          </div>
          {artifact.actions && artifact.actions.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "0 12px 12px", borderTop: "1px solid var(--color-border)", paddingTop: 10 }}>
              {artifact.actions.map((action, i) => {
                const primary = action.variant === "primary";
                return (
                  <button
                    key={i}
                    onClick={() => { if (!loading) void sendChat(action.prompt); }}
                    disabled={loading}
                    style={{
                      padding: "6px 12px", borderRadius: "var(--radius-pill)", cursor: loading ? "default" : "pointer",
                      fontSize: 12, fontWeight: 600, letterSpacing: "-0.005em",
                      border: `1px solid ${primary ? "var(--color-primary)" : "var(--color-border)"}`,
                      background: primary ? "var(--color-primary)" : "var(--color-surface)",
                      color: primary ? "#fff" : "var(--color-text)",
                      opacity: loading ? 0.6 : 1,
                    }}
                  >
                    {action.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
