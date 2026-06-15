import { type FC, useState } from "react";
import type { Component } from "@air-ui/core";
import { AirUIComponent, useAirUIStore } from "@air-ui/renderer-react";
import type { ArtifactPanel } from "./helpers";
import { CapabilityHome, WikiHome } from "./home";
import { savePreset } from "./presets";

export const ArtifactGallery: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = ({ resolvedProps }) => {
  const doc = useAirUIStore((s) => s.doc);
  const setDoc = useAirUIStore((s) => s.setDoc);
  const state = (doc?.state ?? {}) as Record<string, unknown>;

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
    <div style={{ display: "grid", gap: 12 }}>
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
            borderRadius: 10,
            background: "var(--color-surface)",
            overflow: "hidden",
            cursor: "move",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06)",
            position: "relative"
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              padding: "10px 12px",
              borderBottom: "1px solid var(--color-border)",
              background: "var(--color-surface-muted)",
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: "var(--color-text)"
            }}
          >
            <span>{artifact.title}</span>
            <div style={{ display: "flex", gap: 4 }}>
              <button
                onClick={() => handleSaveAsPreset(artifact.ref)}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-surface-muted)",
                  color: "var(--color-text)",
                  cursor: "pointer",
                  fontSize: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}
                title="保存为预设"
              >
                📦
              </button>
              <span style={{ fontSize: 12, color: "var(--color-muted)", fontWeight: 500 }}>{artifact.ref}</span>
            </div>
          </div>
          <div className="airui-gallery-card" style={{ padding: 12 }}>
            <AirUIComponent comp={artifact.component} />
          </div>
        </div>
      ))}
    </div>
  );
};

