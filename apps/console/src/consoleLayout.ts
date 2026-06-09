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
          // 滚动表单区（三联排卡片）
          {
            type: "Pane",
            props: { direction: "column", grow: true, scroll: true, padding: 20, gap: "14px", minWidth: 0 },
            children: [
              {
                type: "Pane",
                props: { direction: "row", gap: "14px", align: "start", minWidth: 0 },
                children: [
                  {
                    type: "SettingCard",
                    props: { title: "{state.t.appearance}", desc: "{state.t.settingsAppearanceDesc}" },
                    children: [
                      {
                        type: "Setting",
                        props: {
                          path: "ui.theme", kind: "select", label: "{state.t.theme}",
                          options: [
                            { value: "light", label: "{state.t.light}" },
                            { value: "dark", label: "{state.t.dark}" },
                            { value: "graphite", label: "{state.t.graphite}" },
                            { value: "neon", label: "{state.t.neon}" },
                            { value: "glass", label: "{state.t.glass}" },
                            { value: "system", label: "{state.t.system}" },
                          ],
                        },
                      },
                      {
                        type: "Setting",
                        props: {
                          path: "ui.language", kind: "select", label: "{state.t.language}",
                          options: [
                            { value: "zh-CN", label: "简体中文" },
                            { value: "en-US", label: "English" },
                          ],
                        },
                      },
                    ],
                  },
                  {
                    type: "SettingCard",
                    props: { title: "{state.t.llm}", desc: "{state.t.settingsLlmDesc}" },
                    children: [
                      { type: "LlmProviderPanel" },
                      { type: "Setting", props: { path: "model.display_name", kind: "text", label: "{state.t.displayName}" } },
                      { type: "Setting", props: { path: "model.provider", kind: "text", label: "{state.t.provider}" } },
                      { type: "Setting", props: { path: "model.name", kind: "text", label: "{state.t.modelName}" } },
                      { type: "Setting", props: { path: "model.base_url", kind: "text", label: "{state.t.baseUrl}" } },
                      { type: "Setting", props: { path: "model.api_key", kind: "password", label: "{state.t.apiKey}" } },
                      { type: "Setting", props: { path: "model.max_output_tokens", kind: "number", label: "{state.t.maxTokens}" } },
                    ],
                  },
                  {
                    type: "SettingCard",
                    props: { title: "{state.t.runtime}", desc: "{state.t.settingsRuntimeDesc}" },
                    children: [
                      { type: "Setting", props: { path: "runtime.max_iterations", kind: "number", label: "{state.t.maxIterations}" } },
                      { type: "Setting", props: { path: "runtime.context_window_tokens", kind: "number", label: "{state.t.contextWindow}" } },
                    ],
                  },
                ],
              },
              // ── Skills / MCP / Plugins ──────────────────────────────────
              {
                type: "Pane",
                props: { direction: "row", gap: "14px", align: "start", minWidth: 0 },
                children: [
                  {
                    type: "SettingCard",
                    props: { title: "{state.t.skills}", desc: "{state.t.settingsSkillsDesc}" },
                    children: [
                      { type: "Setting", props: { path: "skills.enabled", kind: "switch", label: "{state.t.enabled}" } },
                      { type: "ListEditor", props: { path: "skills.search_paths", placeholder: "packages/agent-skills" } },
                    ],
                  },
                  {
                    type: "SettingCard",
                    props: { title: "{state.t.mcp}", desc: "{state.t.settingsMcpDesc}" },
                    children: [
                      { type: "Setting", props: { path: "mcp.enabled", kind: "switch", label: "{state.t.enabled}" } },
                      { type: "McpServers" },
                    ],
                  },
                  {
                    type: "SettingCard",
                    props: { title: "{state.t.plugins}", desc: "{state.t.settingsPluginsDesc}" },
                    children: [
                      { type: "Setting", props: { path: "plugins.enabled", kind: "switch", label: "{state.t.enabled}" } },
                      { type: "ListEditor", props: { path: "plugins.search_paths", placeholder: "packages/plugins" } },
                    ],
                  },
                ],
              },
              { type: "Notice", props: { field: "settingsError" } },
            ],
          },
          // 底部操作栏
          {
            type: "Pane",
            props: { direction: "row", gap: "8px", justify: "end", align: "center", borderTop: true, padding: "12px 16px", background: "var(--color-surface)" },
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
