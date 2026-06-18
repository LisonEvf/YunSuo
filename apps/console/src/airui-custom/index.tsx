import { type FC, type CSSProperties } from "react";
import type { Component } from "@air-ui/core";
import { AirUIComponent, useAirUIStore, registerComponent } from "@air-ui/renderer-react";
import { sendChat } from "../chat";

import { Card } from "./home";
import { ArtifactGallery } from "./gallery";
import { InspectorSkills, RunTimeline } from "./inspector";
import { MarkdownCard, CodeBlockCard } from "./markdown";
import { Setting, SettingCard, ListEditor, SettingsNav, SettingsContent } from "./settings";
import { ConnStatus, Notice, McpServers, LlmProviderPanel, ModelFetcher } from "./llm";
import { SkillsRoster, PluginsRoster } from "./roster";
import { MarketplaceSources, MarketplaceBrowser } from "./marketplace";

// 向后兼容：ConsoleView.tsx 仍从 "../airui-custom" import 这些
export { normalizeComponentType, normalizeAirUIComponent } from "./helpers";
export type { ArtifactPanel } from "./helpers";
export { homeLayout } from "./home";

// ── gap / align helpers（Pane 用）──
const gapMap: Record<string, string> = { small: "8px", medium: "16px", large: "28px" };
function resolveGap(gap?: string | number): string | undefined {
  if (gap === undefined) return undefined;
  if (typeof gap === "number") return `${gap}px`;
  return gapMap[gap] ?? gap;
}
const alignMap: Record<string, CSSProperties["alignItems"]> = {
  start: "flex-start", center: "center", end: "flex-end", stretch: "stretch",
};
function resolveAlign(align?: string): CSSProperties["alignItems"] | undefined {
  return align ? (alignMap[align] ?? (align as CSSProperties["alignItems"])) : undefined;
}
const justifyMap: Record<string, CSSProperties["justifyContent"]> = {
  start: "flex-start", center: "center", end: "flex-end", between: "space-between", around: "space-around",
};

// ── Pane：通用容器（布局解析 gap/align/justify/direction + Starter 卡片点击触发 sendChat）──

const Pane: FC<{ comp: Component; resolvedProps: Record<string, unknown> }> = ({ comp, resolvedProps }) => {
  if (resolvedProps.visible === false) return null;
  const direction = (resolvedProps.direction as string) ?? "column";
  const grow = resolvedProps.grow === true;
  const justify = resolvedProps.justify as string | undefined;
  const style: CSSProperties = {
    display: "flex",
    flexDirection: direction as CSSProperties["flexDirection"],
    gap: resolveGap(resolvedProps.gap as string | number),
    padding: resolvedProps.padding as string | undefined,
    flexGrow: grow ? 1 : (resolvedProps.flex as number | undefined),
    flexBasis: grow ? 0 : undefined,
    minWidth: resolvedProps.minWidth as string | number | undefined,
    width: resolvedProps.width as string | number | undefined,
    maxWidth: resolvedProps.maxWidth as string | number | undefined,
    minHeight: resolvedProps.minHeight as string | number | undefined,
    height: resolvedProps.height as string | number | undefined,
    overflow: resolvedProps.scroll ? "auto" : undefined,
    alignItems: resolveAlign(resolvedProps.align as string),
    justifyContent: justify ? (justifyMap[justify] ?? (justify as CSSProperties["justifyContent"])) : undefined,
    marginTop: resolvedProps.marginTop as string | undefined,
    marginBottom: resolvedProps.marginBottom as string | undefined,
    paddingTop: resolvedProps.paddingTop as string | undefined,
    paddingBottom: resolvedProps.paddingBottom as string | undefined,
    borderBottom: resolvedProps.borderBottom ? "1px solid var(--color-border)" : undefined,
    borderLeft: resolvedProps.borderLeft ? "1px solid var(--color-border)" : undefined,
    borderTop: resolvedProps.borderTop ? "1px solid var(--color-border)" : undefined,
    background: resolvedProps.background as string | undefined,
  };
  return (
    <div className={resolvedProps.className as string | undefined} style={style}>
      {comp.children?.map((child, i) => <AirUIComponent key={child.ref ?? i} comp={child} />)}
    </div>
  );
};

// ── 能力感知首页 / AIRUI Wiki ────────────────────────────────────────

let registered = false;
/** 注册 console 专用自定义组件（幂等） */
export function registerConsoleComponents() {
  if (registered) return;
  registered = true;
  registerComponent("Pane", Pane);
  registerComponent("ArtifactGallery", ArtifactGallery);
  registerComponent("InspectorSkills", InspectorSkills);
  registerComponent("RunTimeline", RunTimeline);
  registerComponent("Setting", Setting);
  registerComponent("ConnStatus", ConnStatus);
  registerComponent("Notice", Notice);
  registerComponent("Card", Card);
  registerComponent("SettingCard", SettingCard);
  registerComponent("ListEditor", ListEditor);
  registerComponent("McpServers", McpServers);
  registerComponent("LlmProviderPanel", LlmProviderPanel);
  registerComponent("SkillsRoster", SkillsRoster);
  registerComponent("PluginsRoster", PluginsRoster);
  registerComponent("MarketplaceSources", MarketplaceSources);
  registerComponent("MarketplaceBrowser", MarketplaceBrowser);
  registerComponent("ModelFetcher", ModelFetcher);
  registerComponent("SettingsNav", SettingsNav);
  registerComponent("SettingsContent", SettingsContent);
  // Rich markdown inside AIRUI cards: overrides the primitive built-in
  // Markdown/CodeBlock renderers with the shared MarkdownView (GFM + Morandi).
  registerComponent("Markdown", MarkdownCard);
  registerComponent("CodeBlock", CodeBlockCard);
}
