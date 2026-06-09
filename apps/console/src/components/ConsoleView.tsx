import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { Component } from "@air-ui/core";
import { AirUIComponent, InteractionProvider, useAirUIStore } from "@air-ui/renderer-react";
import { t } from "../i18n";
import {
  defaultAgentConfig,
  useStore,
  type ActiveSkill,
  type AgentConfig,
  type LanguageCode,
  type RunEvent,
  type ThemeMode,
} from "../store";
import { sendInteraction } from "../ws-client";

interface InspectorState {
  skills: Array<{ slug: string; name: string; description: string }>;
  memory: { total?: number };
  trajectories: { total?: number; failed?: number; completed?: number };
  model: string;
}

interface ArtifactPanel {
  ref: string;
  title: string;
  component: Component;
}

const componentAliases: Record<string, string> = {
  card: "Widget",
  panel: "Widget",
  container: "Column",
  stack: "Column",
  hstack: "Row",
  vstack: "Column",
  paragraph: "Text",
  heading: "Text",
  title: "Text",
  markdown: "Markdown",
  code: "CodeBlock",
  codeblock: "CodeBlock",
  datatable: "Table",
  dataTable: "Table",
  datagrid: "DataGrid",
  "data-grid": "DataGrid",
  table: "Table",
  metric: "KPI",
  stat: "KPI",
  kpi: "KPI",
  "video-player": "Video",
  videoplayer: "Video",
  "audio-player": "Audio",
  audioplayer: "Audio",
  pdf: "PDFViewer",
  pdfviewer: "PDFViewer",
  "pdf-viewer": "PDFViewer",
  empty: "EmptyState",
  "empty-state": "EmptyState",
  command: "CommandPalette",
  commandpalette: "CommandPalette",
  "command-palette": "CommandPalette",
  "context-menu": "ContextMenu",
  contextmenu: "ContextMenu",
  "top-nav": "TopNav",
  topnav: "TopNav",
  "app-shell": "AppShell",
  appshell: "AppShell",
  "split-pane": "SplitPane",
  splitpane: "SplitPane",
  "scroll-area": "ScrollArea",
  scrollarea: "ScrollArea",
  number: "NumberInput",
  numberinput: "NumberInput",
  "number-input": "NumberInput",
  textarea: "Textarea",
  date: "DatePicker",
  "date-picker": "DatePicker",
  time: "TimePicker",
  "time-picker": "TimePicker",
  "date-range": "DateRangePicker",
  "date-range-picker": "DateRangePicker",
  daterange: "DateRangePicker",
  multiselect: "MultiSelect",
  "multi-select": "MultiSelect",
  upload: "FileUpload",
  "file-upload": "FileUpload",
  fileupload: "FileUpload",
  "rich-text": "RichText",
  richtext: "RichText",
  network: "NetworkGraph",
  "network-graph": "NetworkGraph",
  networkgraph: "NetworkGraph",
};

const builtinComponents = new Set([
  "Column",
  "Row",
  "Divider",
  "Text",
  "Button",
  "Input",
  "Select",
  "Switch",
  "Checkbox",
  "Radio",
  "Slider",
  "Image",
  "Dropdown",
  "Form",
  "Textarea",
  "DatePicker",
  "TimePicker",
  "DateRangePicker",
  "NumberInput",
  "Autocomplete",
  "MultiSelect",
  "FileUpload",
  "Video",
  "Audio",
  "ImageGallery",
  "Carousel",
  "Lightbox",
  "PDFViewer",
  "KPI",
  "PlateCard",
  "Gauge",
  "Progress",
  "Tag",
  "Badge",
  "Avatar",
  "Skeleton",
  "Table",
  "Pagination",
  "DataGrid",
  "EmptyState",
  "Chart",
  "Tabs",
  "Breadcrumb",
  "Steps",
  "Modal",
  "Drawer",
  "DropdownMenu",
  "Alert",
  "Loading",
  "ErrorFallback",
  "Tooltip",
  "Toast",
  "Notification",
  "Popconfirm",
  "ContextMenu",
  "CommandPalette",
  "Dashboard",
  "Widget",
  "Accordion",
  "Timeline",
  "Tree",
  "AppShell",
  "Sidebar",
  "TopNav",
  "Toolbar",
  "SplitPane",
  "ScrollArea",
  "Markdown",
  "CodeBlock",
  "RichText",
  "Icon",
  "Calendar",
  "Kanban",
  "Map",
  "NetworkGraph",
  "Heatmap",
]);
const canonicalComponentTypes = new Map(
  Array.from(builtinComponents, (name) => [name.replace(/[\s_-]/g, "").toLowerCase(), name])
);

function interactionHandler(widgetRef: string, interaction: string, payload: Record<string, unknown>) {
  sendInteraction(widgetRef, interaction, payload);
}

function stateColor(state: RunEvent["state"]) {
  if (state === "running") return "var(--color-info)";
  if (state === "done") return "var(--color-success)";
  if (state === "error") return "var(--color-danger)";
  return "var(--color-muted)";
}

function collectArtifactPanels(root: Component | undefined): ArtifactPanel[] {
  if (!root || !("children" in root)) return [];
  const children = (root as any).children || [];
  const row = children.find((child: any) => child?.ref === "row-artifacts");
  const widgets = row?.children || [];
  return widgets
    .map((widget: any, index: number) => {
      const ref = String(widget?.ref || `artifact-${index}`);
      if (ref === "artifact-empty") return null;
      const inner = widget?.type === "Widget" ? widget?.children?.[0] : widget;
      if (!inner) return null;
      return {
        ref,
        title: String(widget?.props?.title || ref),
        component: normalizeAirUIComponent(inner),
      };
    })
    .filter(Boolean) as ArtifactPanel[];
}

function normalizeAirUIComponent(raw: unknown): Component {
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
    return { type: "Text", props: { value: String(raw) } };
  }
  if (!raw || typeof raw !== "object") {
    return { type: "Text", props: { value: "" } };
  }

  const node = raw as any;
  const props = { ...(node.props || {}) };
  let type = normalizeComponentType(node.type, props);

  if (type === "Table" && props.data === undefined && props.rows !== undefined) {
    props.data = props.rows;
    delete props.rows;
  }

  if (type === "Text" && props.value === undefined) {
    props.value = props.text ?? props.content ?? props.label ?? "";
    delete props.text;
    delete props.content;
  }

  if (type === "KPI" && props.value === undefined && props.count !== undefined) {
    props.value = props.count;
    delete props.count;
  }

  const children = Array.isArray(node.children)
    ? node.children.map((child: unknown) => normalizeAirUIComponent(child))
    : undefined;

  return {
    ...node,
    type,
    props,
    ...(children ? { children } : {}),
  } as Component;
}

function normalizeComponentType(typeValue: unknown, props: Record<string, unknown>): string {
  const rawType = typeof typeValue === "string" ? typeValue.trim() : "";
  if (!rawType) {
    if (props.columns && (props.data || props.rows)) return "Table";
    if (props.value !== undefined || props.count !== undefined) return "KPI";
    return "Text";
  }

  if (builtinComponents.has(rawType)) return rawType;
  const compact = rawType.replace(/[\s_-]/g, "");
  const lower = compact.toLowerCase();
  const alias = componentAliases[rawType] || componentAliases[compact] || componentAliases[lower];
  if (alias) return alias;

  const canonical = canonicalComponentTypes.get(lower);
  if (canonical) return canonical;

  const pascal = lower.charAt(0).toUpperCase() + lower.slice(1);
  if (builtinComponents.has(pascal)) return pascal;

  return "Text";
}

function TimelineDock({ events, language }: { events: RunEvent[]; language: LanguageCode }) {
  return (
    <section
      className="timeline-dock"
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          padding: "7px 9px",
          borderBottom: "1px solid var(--color-border)",
          color: "var(--color-text)",
        }}
      >
        <span style={mutedTextStyle}>{events.length} {t(language, "events")}</span>
      </div>
      <div style={{ display: "grid", gap: 6, maxHeight: 168, overflowY: "auto", padding: 9 }}>
        {events.slice().reverse().map((event) => (
          <div
            key={event.id}
            style={{
              display: "grid",
              gridTemplateColumns: "56px 1fr",
              gap: 8,
              padding: "7px 8px",
              borderRadius: 6,
              background: "var(--color-surface-muted)",
              border: "1px solid var(--color-border)",
            }}
          >
            <span style={{ fontSize: 11, color: "var(--color-muted)" }}>{event.time}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <strong style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {event.label}
                </strong>
                <span style={{ fontSize: 10, color: stateColor(event.state), textTransform: "uppercase" }}>
                  {event.state}
                </span>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--color-muted)",
                  marginTop: 2,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {event.detail}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Artifacts({ artifacts, language }: { artifacts: ArtifactPanel[]; language: LanguageCode }) {
  return (
    <section style={{ ...panelStyle, minHeight: 260 }}>
      <div style={panelHeaderStyle}>
        <strong>{t(language, "artifacts")}</strong>
        <span style={mutedTextStyle}>AIRUI</span>
      </div>
      {artifacts.length === 0 ? (
        <div
          style={{
            minHeight: 180,
            border: "1px dashed var(--color-border-strong)",
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--color-muted)",
            fontSize: 13,
            background: "var(--color-surface-muted)",
          }}
        >
          {t(language, "renderedArtifacts")}
        </div>
      ) : (
        <InteractionProvider value={interactionHandler}>
          <div style={{ display: "grid", gap: 12 }}>
            {artifacts.map((artifact) => (
              <div
                key={artifact.ref}
                style={{
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  background: "var(--color-surface)",
                  overflow: "hidden",
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
                    fontWeight: 700,
                  }}
                >
                  <span>{artifact.title}</span>
                  <span style={{ ...mutedTextStyle, fontWeight: 500 }}>{artifact.ref}</span>
                </div>
                <div style={{ padding: 12 }}>
                  <AirUIComponent comp={artifact.component} />
                </div>
              </div>
            ))}
          </div>
        </InteractionProvider>
      )}
    </section>
  );
}

function Inspector({
  data,
  events,
  running,
  activeSkills,
  language,
}: {
  data: InspectorState;
  events: RunEvent[];
  running: boolean;
  activeSkills: ActiveSkill[];
  language: LanguageCode;
}) {
  const activeSkillSlugs = new Set(activeSkills.map((skill) => skill.slug));

  return (
    <aside
      className="inspector-panel"
      style={{
        width: 320,
        minWidth: 320,
        borderLeft: "1px solid var(--color-border)",
        background: "var(--color-surface)",
        overflow: "auto",
      }}
    >
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{t(language, "inspector")}</div>
        <div style={{ fontSize: 12, color: "var(--color-muted)", marginTop: 2 }}>
          {t(language, "inspectorSubtitle")}
        </div>
      </div>

      <InspectorBlock title="Runtime">
        <InfoRow label={t(language, "model")} value={data.model || t(language, "notLoaded")} />
        <InfoRow label={t(language, "memory")} value={`${data.memory.total || 0} ${t(language, "entries")}`} />
        <InfoRow label={t(language, "trajectories")} value={`${data.trajectories.total || 0} ${t(language, "samples")}`} />
        <InfoRow label={t(language, "failures")} value={`${data.trajectories.failed || 0}`} />
      </InspectorBlock>

      <InspectorBlock title={t(language, "activeSkills")}>
        <div style={{ display: "grid", gap: 8, maxHeight: 260, overflowY: "auto", paddingRight: 2 }}>
          {data.skills.map((skill) => {
            const active = activeSkillSlugs.has(skill.slug);
            return (
            <div
              key={skill.slug}
              className={running && active ? "skill-card skill-card-active" : "skill-card"}
              style={{
                padding: 9,
                borderRadius: 8,
                background: active ? "var(--color-primary-soft)" : "var(--color-surface-muted)",
                border: active ? "1px solid var(--color-primary-border)" : "1px solid transparent",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{skill.name}</div>
                {active && (
                  <span style={{ fontSize: 10, color: "var(--color-primary-strong)", fontWeight: 800, textTransform: "uppercase" }}>
                    {t(language, "using")}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: "var(--color-muted)", marginTop: 3 }}>{skill.description}</div>
            </div>
          )})}
          {!data.skills.length && <div style={mutedTextStyle}>{t(language, "noSkills")}</div>}
        </div>
      </InspectorBlock>

      <InspectorBlock title={t(language, "runTimeline")}>
        <TimelineDock events={events} language={language} />
      </InspectorBlock>
    </aside>
  );
}

function InspectorBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ padding: 16, borderBottom: "1px solid var(--color-border)" }}>
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>{title}</div>
      {children}
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12, marginBottom: 8 }}>
      <span style={{ color: "var(--color-muted)", flex: "0 0 auto" }}>{label}</span>
      <span
        style={{
          color: "var(--color-text)",
          fontWeight: 600,
          minWidth: 0,
          overflowWrap: "anywhere",
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
}

const panelStyle: CSSProperties = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  padding: 14,
  boxShadow: "var(--shadow-panel)",
};

const panelHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 12,
  color: "var(--color-text)",
};

const mutedTextStyle: CSSProperties = { fontSize: 12, color: "var(--color-muted)" };

const fieldStyle: CSSProperties = {
  width: "100%",
  height: 34,
  borderRadius: 8,
  border: "1px solid var(--color-border-strong)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
  padding: "0 10px",
  outline: "none",
  fontSize: 13,
};

const labelStyle: CSSProperties = {
  display: "grid",
  gap: 6,
  fontSize: 12,
  fontWeight: 700,
  color: "var(--color-text)",
};

const secondaryButtonStyle: CSSProperties = {
  height: 34,
  borderRadius: 8,
  border: "1px solid var(--color-border-strong)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
  padding: "0 12px",
  fontWeight: 700,
  cursor: "pointer",
};

const primaryButtonStyle: CSSProperties = {
  height: 34,
  borderRadius: 8,
  border: "none",
  background: "var(--color-primary)",
  color: "var(--color-primary-text)",
  padding: "0 12px",
  fontWeight: 800,
  cursor: "pointer",
};

function SettingsDrawer({
  open,
  config,
  saving,
  error,
  language,
  onClose,
  onSave,
}: {
  open: boolean;
  config: AgentConfig;
  saving: boolean;
  error: string;
  language: LanguageCode;
  onClose: () => void;
  onSave: (config: AgentConfig) => void;
}) {
  const [draft, setDraft] = useState<AgentConfig>(config);

  useEffect(() => {
    if (open) setDraft(config);
  }, [config, open]);

  if (!open) return null;

  const updateUi = (patch: Partial<AgentConfig["ui"]>) =>
    setDraft((current) => ({ ...current, ui: { ...current.ui, ...patch } }));
  const updateModel = (patch: Partial<AgentConfig["model"]>) =>
    setDraft((current) => ({ ...current, model: { ...current.model, ...patch } }));
  const updateRuntime = (patch: Partial<AgentConfig["runtime"]>) =>
    setDraft((current) => ({ ...current, runtime: { ...current.runtime, ...patch } }));

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 20,
        background: "rgba(0, 0, 0, 0.24)",
        display: "flex",
        justifyContent: "flex-end",
      }}
      onClick={onClose}
    >
      <aside
        style={{
          width: "min(420px, 100vw)",
          height: "100%",
          background: "var(--color-surface)",
          color: "var(--color-text)",
          borderLeft: "1px solid var(--color-border)",
          boxShadow: "0 18px 40px rgba(0, 0, 0, 0.24)",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <header
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--color-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 15 }}>{t(language, "settings")}</div>
          <button type="button" onClick={onClose} style={secondaryButtonStyle}>
            {t(language, "cancel")}
          </button>
        </header>

        <div style={{ flex: 1, overflow: "auto", padding: 16, display: "grid", gap: 18 }}>
          <SettingsSection title={t(language, "appearance")}>
            <label style={labelStyle}>
              {t(language, "theme")}
              <select
                value={draft.ui.theme}
                onChange={(event) => updateUi({ theme: event.target.value as ThemeMode })}
                style={fieldStyle}
              >
                <option value="light">{t(language, "light")}</option>
                <option value="dark">{t(language, "dark")}</option>
                <option value="graphite">{t(language, "graphite")}</option>
                <option value="neon">{t(language, "neon")}</option>
                <option value="glass">{t(language, "glass")}</option>
                <option value="system">{t(language, "system")}</option>
              </select>
            </label>
            <label style={labelStyle}>
              {t(language, "language")}
              <select
                value={draft.ui.language}
                onChange={(event) => updateUi({ language: event.target.value as LanguageCode })}
                style={fieldStyle}
              >
                <option value="zh-CN">简体中文</option>
                <option value="en-US">English</option>
              </select>
            </label>
          </SettingsSection>

          <SettingsSection title={t(language, "llm")}>
            <label style={labelStyle}>
              {t(language, "provider")}
              <input
                value={draft.model.provider}
                onChange={(event) => updateModel({ provider: event.target.value })}
                style={fieldStyle}
              />
            </label>
            <label style={labelStyle}>
              {t(language, "modelName")}
              <input
                value={draft.model.name}
                onChange={(event) => updateModel({ name: event.target.value })}
                style={fieldStyle}
              />
            </label>
            <label style={labelStyle}>
              {t(language, "baseUrl")}
              <input
                value={draft.model.base_url}
                onChange={(event) => updateModel({ base_url: event.target.value })}
                style={fieldStyle}
              />
            </label>
            <label style={labelStyle}>
              {t(language, "apiKey")}
              <input
                type="password"
                value={draft.model.api_key}
                onChange={(event) => updateModel({ api_key: event.target.value })}
                style={fieldStyle}
              />
            </label>
            <label style={labelStyle}>
              {t(language, "maxTokens")}
              <input
                type="number"
                min={1}
                value={draft.model.max_output_tokens}
                onChange={(event) => updateModel({ max_output_tokens: Number(event.target.value || 1) })}
                style={fieldStyle}
              />
            </label>
          </SettingsSection>

          <SettingsSection title="Runtime">
            <label style={labelStyle}>
              {t(language, "maxIterations")}
              <input
                type="number"
                min={1}
                value={draft.runtime.max_iterations}
                onChange={(event) => updateRuntime({ max_iterations: Number(event.target.value || 1) })}
                style={fieldStyle}
              />
            </label>
            <label style={labelStyle}>
              {t(language, "contextWindow")}
              <input
                type="number"
                min={1024}
                value={draft.runtime.context_window_tokens}
                onChange={(event) => updateRuntime({ context_window_tokens: Number(event.target.value || 1024) })}
                style={fieldStyle}
              />
            </label>
          </SettingsSection>

          {error && (
            <div style={{ color: "var(--color-danger)", fontSize: 12, fontWeight: 700 }}>
              {error}
            </div>
          )}
        </div>

        <footer
          style={{
            padding: 16,
            borderTop: "1px solid var(--color-border)",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button type="button" onClick={onClose} style={secondaryButtonStyle}>
            {t(language, "cancel")}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onSave(draft)}
            style={{
              ...primaryButtonStyle,
              opacity: saving ? 0.7 : 1,
              cursor: saving ? "wait" : "pointer",
            }}
          >
            {saving ? t(language, "saving") : t(language, "save")}
          </button>
        </footer>
      </aside>
    </div>
  );
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: "grid", gap: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 800 }}>{title}</div>
      <div style={{ display: "grid", gap: 10 }}>{children}</div>
    </section>
  );
}

export default function ConsoleView() {
  const doc = useStore((s) => s.doc);
  const connected = useStore((s) => s.connected);
  const appConfig = useStore((s) => s.appConfig);
  const runEvents = useStore((s) => s.runEvents);
  const activeTools = useStore((s) => s.activeTools);
  const activeSkills = useStore((s) => s.activeSkills);
  const loading = useStore((s) => s.chatLoading);
  const setAppConfig = useStore((s) => s.setAppConfig);
  const addRunEvent = useStore((s) => s.addRunEvent);
  const setAiruiDoc = useAirUIStore((s) => s.setDoc);
  const language = appConfig.ui.language;
  const [inspector, setInspector] = useState<InspectorState>({
    skills: [],
    memory: {},
    trajectories: {},
    model: "",
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");

  useEffect(() => {
    if (doc) setAiruiDoc(doc);
  }, [doc, setAiruiDoc]);

  useEffect(() => {
    let cancelled = false;
    async function loadInspector() {
      try {
        const [skillsRes, memoryRes, trajectoriesRes, configRes] = await Promise.all([
          fetch("/api/skills"),
          fetch("/api/memory/stats"),
          fetch("/api/trajectories/summary"),
          fetch("/api/config"),
        ]);
        const [skills, memory, trajectories, config] = await Promise.all([
          skillsRes.json(),
          memoryRes.json(),
          trajectoriesRes.json(),
          configRes.json(),
        ]);
        if (!cancelled) {
          const loadedConfig = config?.config || defaultAgentConfig;
          setAppConfig(loadedConfig);
          setInspector({
            skills: skills.skills || [],
            memory,
            trajectories,
            model: loadedConfig?.model?.name || "",
          });
        }
      } catch {
        if (!cancelled) {
          setInspector((current) => ({ ...current, model: t(language, "unavailable") }));
        }
      }
    }
    loadInspector();
    const timer = window.setInterval(loadInspector, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [language, setAppConfig]);

  const artifacts = useMemo(() => collectArtifactPanels(doc?.root as Component | undefined), [doc]);

  async function saveSettings(nextConfig: AgentConfig) {
    setSettingsSaving(true);
    setSettingsError("");
    try {
      const response = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: nextConfig }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json();
      const savedConfig = payload?.config || nextConfig;
      setAppConfig(savedConfig);
      setInspector((current) => ({ ...current, model: savedConfig?.model?.name || "" }));
      addRunEvent({
        label: t(savedConfig?.ui?.language || language, "saved"),
        detail: savedConfig?.model?.name || savedConfig?.model?.provider || "config",
        state: "done",
      });
      setSettingsOpen(false);
    } catch (error) {
      setSettingsError(String(error));
      addRunEvent({ label: t(language, "settingsSaveFailed"), detail: String(error), state: "error" });
    } finally {
      setSettingsSaving(false);
    }
  }

  return (
    <main className="console-view" style={{ flex: 1, display: "flex", minWidth: 0, background: "var(--color-app-bg)" }}>
      <div className="console-content" style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 18 }}>
        <header
          className="console-header"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 14,
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: 20, letterSpacing: 0, color: "var(--color-text)" }}>
              {t(language, "operationsConsole")}
            </h1>
            <div style={{ fontSize: 13, color: "var(--color-muted)", marginTop: 3 }}>
              {t(language, "operationsSubtitle")}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              style={secondaryButtonStyle}
            >
              {t(language, "settings")}
            </button>
            <span style={{ color: connected ? "var(--color-success)" : "var(--color-danger)", fontWeight: 700 }}>
              {connected ? t(language, "connected") : t(language, "disconnected")}
            </span>
            <span style={{ color: "var(--color-muted)" }}>{activeTools.length} {t(language, "activeTools")}</span>
          </div>
        </header>

        <div style={{ display: "grid", gap: 14 }}>
          <Artifacts artifacts={artifacts} language={language} />
        </div>
      </div>
      <Inspector
        data={inspector}
        events={runEvents}
        running={loading}
        activeSkills={activeSkills}
        language={language}
      />
      <SettingsDrawer
        open={settingsOpen}
        config={appConfig}
        saving={settingsSaving}
        error={settingsError}
        language={language}
        onClose={() => setSettingsOpen(false)}
        onSave={saveSettings}
      />
    </main>
  );
}
