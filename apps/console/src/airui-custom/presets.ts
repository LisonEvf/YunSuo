import type { Component } from "@air-ui/core";

export interface UIPreset {
  id: string;
  name: string;
  component: Component;
  title?: string;
  createdAt: number;
}

const KEY = "yunsuo_ui_presets";

export function listPresets(): UIPreset[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as UIPreset[]) : [];
  } catch {
    return [];
  }
}

function notifyChange() {
  window.dispatchEvent(new CustomEvent("presets-changed"));
}

export function savePreset(preset: Omit<UIPreset, "id" | "createdAt">): UIPreset {
  const full: UIPreset = { ...preset, id: crypto.randomUUID(), createdAt: Date.now() };
  const all = listPresets();
  all.push(full);
  localStorage.setItem(KEY, JSON.stringify(all));
  notifyChange();
  return full;
}

export function deletePreset(id: string): void {
  const all = listPresets().filter((p) => p.id !== id);
  localStorage.setItem(KEY, JSON.stringify(all));
  notifyChange();
}

export function removeNodeByRef(root: Component, ref: string): Component {
  if (!root.children) return root;
  const next = root.children.filter((c) => c.ref !== ref).map((c) => removeNodeByRef(c, ref));
  return { ...root, children: next };
}
