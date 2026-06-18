import type { AirUIDocument } from "@air-ui/core";

/**
 * Console 页面预设骨架。整个页面由这份 JSON 驱动渲染，动态数据通过
 * `update-state` / `set` 注入 `state`，文本走 `{state.t.xxx}` 模板。
 *
 * 自定义组件（type）：Pane / ArtifactGallery / InspectorSkills / RunTimeline / Setting / ConnStatus / Notice
 * 内置组件：Text / Button / KPI / Drawer
 */
export const consoleLayout: AirUIDocument = {
  schema: "air-ui@1",
  viewport: { width: 1280, height: 800 },
  state: {
    t: {},
    connected: false,
    connText: "",
    activeToolsText: "",
    chatLoading: false,
    settingsOpen: false,
    mainVisible: true,
    settingsSaving: false,
    settingsError: "",
    saveLabel: "",
    settingsSection: "llm",
    draft: {
      ui: { theme: "light", language: "zh-CN" },
      model: { provider: "", name: "", base_url: "", api_key: "", max_output_tokens: 4096, display_name: "" },
      providers: [],
      active_provider_id: null as string | null,
      runtime: { max_iterations: 12, context_window_tokens: 65536 },
    },
    artifacts: [],
    homePinned: false,
    wikiOpen: false,
    wikiCategory: "",
    mcpServers: [],
    plugins: [],
    skills: [],
    activeSkills: [],
    runEvents: [],
    runDist: { labels: [], values: [] },
    runtime: { modelText: "", memoryText: "", trajectoriesText: "", failedText: "", skillsCountText: "" },
  },
  root: {
    type: "Pane",
    props: { className: "console-view", direction: "row", grow: true, minWidth: 0 },
    children: [
      // ── 主区 ──────────────────────────────────────────────
      {
        type: "Pane",
        props: { className: "console-content", direction: "column", grow: true, minWidth: 0, scroll: true, padding: 18, visible: "@state.mainVisible" },
        children: [
          {
            type: "Pane",
            props: { className: "console-header", direction: "row", justify: "between", align: "center", marginBottom: "14px" },
            children: [
              {
                type: "Pane",
                props: { direction: "column" },
                children: [
                  { type: "Text", props: { value: "{state.t.operationsConsole}", style: "title" } },
                  { type: "Text", props: { value: "{state.t.operationsSubtitle}", style: "caption" } },
                ],
              },
              {
                type: "Pane",
                props: { direction: "row", gap: "8px", align: "center" },
                children: [
                  { type: "Button", ref: "console:home", props: { label: "{state.t.backHome}", variant: "secondary" } },
                  { type: "Button", ref: "console:wiki", props: { label: "{state.t.airuiWiki}", variant: "secondary" } },
                  { type: "Button", ref: "console:settings", props: { label: "{state.t.settings}", variant: "secondary" } },
                  { type: "ConnStatus" },
                  { type: "Text", props: { value: "{state.activeToolsText}", style: "caption" } },
                ],
              },
            ],
          },
          { type: "ArtifactGallery", ref: "row-artifacts", props: { emptyText: "{state.t.renderedArtifacts}" } },
        ],
      },
      // ── 设置面板（铺满右栏，视觉同构 ChatPanel）──────────────
      {
        type: "Pane",
        ref: "console:settings-panel",
        props: { className: "settings-panel", direction: "column", grow: true, minWidth: 0, visible: "@state.settingsOpen", background: "var(--color-surface-muted)" },
        children: [
          // 标题栏
          {
            type: "Pane",
            props: { direction: "column", padding: "14px 16px", borderBottom: true, background: "var(--color-surface)" },
            children: [
              { type: "Text", props: { value: "{state.t.settings}", style: "title" } },
              { type: "Text", props: { value: "{state.t.settingsSubtitle}", style: "caption" } },
            ],
          },
         // 主体：左菜单 + 右内容（设置分类由 state.settingsSection 控制）
         {
         type: "Pane",
         props: { direction: "row", grow: true, minWidth: 0, minHeight: 0 },
         children: [
           { type: "SettingsNav" },
           { type: "SettingsContent" },
          ],
          },
          { type: "Notice", props: { field: "settingsError" } },
          // 底部操作栏
          {
            type: "Pane",
            props: { direction: "row", gap: "12px", justify: "end", align: "center", borderTop: true, padding: "16px 20px", background: "var(--color-surface)" },
            children: [
              { type: "Button", ref: "console:cancel", props: { label: "{state.t.cancel}", variant: "secondary" } },
              { type: "Button", ref: "console:save", props: { label: "{state.saveLabel}", variant: "primary", disabled: "@state.settingsSaving" } },
            ],
          },
        ],
      },
    ],
  },
};
