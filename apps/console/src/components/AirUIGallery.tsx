import { useLayoutEffect, useMemo, useState } from "react";
import type { AirUIDocument, Component } from "@air-ui/core";
import { AirUIComponent, InteractionProvider, useAirUIStore } from "@air-ui/renderer-react";

interface DemoItem {
  name: string;
  component: Component;
}

interface DemoSection {
  title: string;
  description: string;
  items: DemoItem[];
}

const imageOne = svgData("#0f766e", "#ccfbf1", "AIRUI");
const imageTwo = svgData("#1d4ed8", "#dbeafe", "MEDIA");
const imageThree = svgData("#7c2d12", "#ffedd5", "DATA");
const videoUrl = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";
const audioUrl = "https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3";
const pdfUrl = "https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf";

const galleryDoc: AirUIDocument = {
  schema: "air-ui@1",
  viewport: { width: 1440, height: 1000 },
  state: {
    sampleText: "State interpolation is alive",
    modalOpen: true,
    drawerOpen: true,
  },
  root: { type: "Column", children: [] },
};

function c(type: string, props?: Record<string, unknown>, children?: Component[], extra?: Partial<Component>): Component {
  return { type, props, children, ...extra };
}

function text(value: string, style = "body"): Component {
  return c("Text", { value, style });
}

function sectionCard(title: string, child: Component): Component {
  return c("Column", { gap: "small" }, [
    text(title, "caption"),
    child,
  ]);
}

const tableColumns = [
  { key: "name", label: "Name" },
  { key: "status", label: "Status" },
  { key: "value", label: "Value", color: "signed" },
];

const tableRows = [
  { name: "Alpha", status: "Running", value: "+12%" },
  { name: "Beta", status: "Queued", value: "-3%" },
  { name: "Gamma", status: "Done", value: "+6%" },
];

const selectOptions = [
  { value: "ops", label: "Operations" },
  { value: "media", label: "Media" },
  { value: "data", label: "Data" },
];

const galleryImages = [
  { src: imageOne, title: "Operations" },
  { src: imageTwo, title: "Media" },
  { src: imageThree, title: "Data" },
];

const sections: DemoSection[] = [
  {
    title: "Layout And Shell",
    description: "Base layout primitives plus application frame patterns.",
    items: [
      { name: "Column", component: c("Column", { gap: "small", padding: "small" }, [text("Column item A"), text("Column item B")]) },
      { name: "Row", component: c("Row", { gap: "small", align: "center" }, [c("Tag", { label: "Row" }), c("Badge", { value: 3 }), text("Aligned children")]) },
      { name: "Divider", component: c("Divider", { label: "Divider" }) },
      { name: "Text", component: c("Text", { value: "{state.sampleText}", style: "subtitle" }) },
      { name: "AppShell", component: c("AppShell", { height: 300, sidebarWidth: 170 }, [text("Main content rendered inside AppShell.")], { slots: {
        header: c("TopNav", { title: "Workspace", items: [{ key: "home", label: "Home", active: true }, { key: "runs", label: "Runs" }] }),
        sidebar: c("Sidebar", { title: "Sections", items: [{ key: "a", label: "Overview", active: true }, { key: "b", label: "Artifacts" }] }),
        footer: c("Toolbar", { border: false, items: [{ key: "sync", label: "Sync" }, { key: "export", label: "Export" }] }),
      } }) },
      { name: "Sidebar", component: c("Sidebar", { title: "Navigation", items: [{ key: "dash", label: "Dashboard", active: true }, { key: "media", label: "Media" }, { key: "settings", label: "Settings" }] }) },
      { name: "TopNav", component: c("TopNav", { title: "TopNav", items: [{ key: "one", label: "One", active: true }, { key: "two", label: "Two" }] }) },
      { name: "Toolbar", component: c("Toolbar", { items: [{ key: "bold", label: "Bold", icon: "B" }, { key: "save", label: "Save", active: true }] }) },
      { name: "SplitPane", component: c("SplitPane", { height: 180, primarySize: "42%" }, [text("Left pane"), text("Right pane")]) },
      { name: "ScrollArea", component: c("ScrollArea", { maxHeight: 110 }, [text("Line 1"), text("Line 2"), text("Line 3"), text("Line 4"), text("Line 5"), text("Line 6")]) },
    ],
  },
  {
    title: "Inputs And Forms",
    description: "Common input widgets for generated app artifacts.",
    items: [
      { name: "Button", component: c("Button", { label: "Run action" }) },
      { name: "Input", component: c("Input", { placeholder: "Type a query" }) },
      { name: "Select", component: c("Select", { options: selectOptions, value: "ops" }) },
      { name: "Switch", component: c("Switch", { label: "Auto refresh", checked: true }) },
      { name: "Checkbox", component: c("Checkbox", { label: "Include archived", checked: true }) },
      { name: "Radio", component: c("Radio", { direction: "horizontal", options: selectOptions, value: "media" }) },
      { name: "Slider", component: c("Slider", { label: "Confidence", value: 72, min: 0, max: 100 }) },
      { name: "Dropdown", component: c("Dropdown", { options: selectOptions, selected: "data" }) },
      { name: "Form", component: c("Form", { title: "Quick form", submitLabel: "Submit" }, [c("Input", { name: "title", placeholder: "Title" }), c("Textarea", { name: "notes", placeholder: "Notes", rows: 2 })]) },
      { name: "Textarea", component: c("Textarea", { label: "Notes", value: "Multi-line text", rows: 3 }) },
      { name: "DatePicker", component: c("DatePicker", { label: "Date", value: "2026-06-09" }) },
      { name: "TimePicker", component: c("TimePicker", { label: "Time", value: "09:30" }) },
      { name: "DateRangePicker", component: c("DateRangePicker", { label: "Range", start: "2026-06-09", end: "2026-06-16" }) },
      { name: "NumberInput", component: c("NumberInput", { label: "Quantity", value: 8, min: 0, max: 20 }) },
      { name: "Autocomplete", component: c("Autocomplete", { label: "Search", value: "Data", options: selectOptions }) },
      { name: "MultiSelect", component: c("MultiSelect", { label: "Tags", value: ["ops", "data"], options: selectOptions }) },
      { name: "FileUpload", component: c("FileUpload", { label: "Upload", prompt: "Drop or choose files", multiple: true }) },
    ],
  },
  {
    title: "Media",
    description: "Visual and file media primitives, including video playback.",
    items: [
      { name: "Image", component: c("Image", { src: imageOne, alt: "Generated swatch" }) },
      { name: "Video", component: c("Video", { src: videoUrl, poster: imageTwo, controls: true, aspectRatio: "16 / 9" }) },
      { name: "Audio", component: c("Audio", { src: audioUrl, controls: true }) },
      { name: "ImageGallery", component: c("ImageGallery", { images: galleryImages, columns: 3 }) },
      { name: "Carousel", component: c("Carousel", { items: galleryImages, aspectRatio: "16 / 9" }) },
      { name: "Lightbox", component: c("Lightbox", { items: galleryImages, inline: true }) },
      { name: "PDFViewer", component: c("PDFViewer", { src: pdfUrl, height: 300, title: "Sample PDF" }) },
    ],
  },
  {
    title: "Data Display",
    description: "Dashboard metrics, tabular data, and charts.",
    items: [
      { name: "KPI", component: c("KPI", { label: "Revenue", value: "$128K", change: "+12%", trend: "up" }) },
      { name: "PlateCard", component: c("PlateCard", { name: "AI Tools", change: "+6.4%", lead: "Renderer expansion", flow: "Active" }) },
      { name: "Gauge", component: c("Gauge", { label: "Load", value: 68, max: 100, unit: "%" }) },
      { name: "Progress", component: c("Progress", { label: "Completion", value: 74, max: 100 }) },
      { name: "Tag", component: c("Tag", { label: "Stable", color: "success" }) },
      { name: "Badge", component: c("Badge", { value: 18, color: "accent" }) },
      { name: "Avatar", component: c("Avatar", { name: "Ada Lovelace", size: 44 }) },
      { name: "Skeleton", component: c("Skeleton", { rows: 3 }) },
      { name: "Table", component: c("Table", { columns: tableColumns, data: tableRows }) },
      { name: "Pagination", component: c("Pagination", { total: 128, pageSize: 10, current: 4 }) },
      { name: "DataGrid", component: c("DataGrid", { columns: tableColumns.map((col) => ({ ...col, sortable: true })), data: tableRows, selectable: true }) },
      { name: "EmptyState", component: c("EmptyState", { title: "No alerts", description: "Everything is calm.", actionLabel: "Refresh" }) },
      { name: "Chart", component: c("Chart", { type: "bar", data: { labels: ["Mon", "Tue", "Wed", "Thu"], values: [12, 18, 9, 24] } }) },
    ],
  },
  {
    title: "Navigation Overlay Feedback",
    description: "Navigation, overlay, feedback, and command surfaces.",
    items: [
      { name: "Tabs", component: c("Tabs", { items: [{ key: "one", label: "One" }, { key: "two", label: "Two" }], active: "one" }, [text("Tab one content"), text("Tab two content")]) },
      { name: "Breadcrumb", component: c("Breadcrumb", { items: [{ label: "Home" }, { label: "AIRUI" }, { label: "Gallery" }] }) },
      { name: "Steps", component: c("Steps", { current: 1, items: [{ title: "Design" }, { title: "Build" }, { title: "Verify" }] }) },
      { name: "Modal", component: c("Modal", { title: "Inline modal preview", inline: true, visible: "@state.modalOpen" }, [text("This is the modal body.")]) },
      { name: "Drawer", component: c("Drawer", { title: "Inline drawer preview", inline: true, visible: "@state.drawerOpen" }, [text("Drawer content appears here.")]) },
      { name: "DropdownMenu", component: c("DropdownMenu", { trigger: "Actions", items: [{ key: "copy", label: "Copy" }, { key: "delete", label: "Delete", danger: true }] }) },
      { name: "Alert", component: c("Alert", { type: "success", message: "Renderer online", description: "Feedback component rendered." }) },
      { name: "Loading", component: c("Loading") },
      { name: "ErrorFallback", component: c("ErrorFallback", { message: "Preview error state", retryable: true }) },
      { name: "Tooltip", component: c("Tooltip", { content: "Tooltip wrapper" }, [c("Button", { label: "Hover target" })]) },
      { name: "Toast", component: c("Toast", { inline: true, type: "info", message: "Inline toast preview" }) },
      { name: "Notification", component: c("Notification", { type: "warning", title: "Notification", description: "A compact notification card." }) },
      { name: "Popconfirm", component: c("Popconfirm", { title: "Confirm action?", trigger: "Danger action" }) },
      { name: "ContextMenu", component: c("ContextMenu", { minHeight: 80, items: [{ key: "open", label: "Open" }, { key: "inspect", label: "Inspect" }] }, [text("Right-click this area")]) },
      { name: "CommandPalette", component: c("CommandPalette", { autoFocus: false, items: [{ key: "new", label: "New artifact", shortcut: "N" }, { key: "run", label: "Run agent", shortcut: "R" }] }) },
    ],
  },
  {
    title: "Structure Content Domain Views",
    description: "Higher-level structure, text content, and domain visualization widgets.",
    items: [
      { name: "Dashboard", component: c("Dashboard", { columns: 2, gap: "small" }, [c("Widget", { title: "Widget A" }, [text("Dashboard child")]), c("Widget", { title: "Widget B" }, [c("Progress", { value: 42 })])]) },
      { name: "Widget", component: c("Widget", { title: "Standalone widget" }, [text("Reusable framed content.")]) },
      { name: "Accordion", component: c("Accordion", { items: [{ key: "a", title: "First" }, { key: "b", title: "Second" }], active: ["a"] }, [text("First panel"), text("Second panel")]) },
      { name: "Timeline", component: c("Timeline", { items: [{ key: "1", title: "Started", time: "09:00", color: "success" }, { key: "2", title: "Validated", time: "09:30", color: "accent" }] }) },
      { name: "Tree", component: c("Tree", { data: [{ key: "root", label: "Root", children: [{ key: "child", label: "Child" }] }] }) },
      { name: "Markdown", component: c("Markdown", { value: "## Markdown\n- Lists\n- Headings\n\n```ts\nconst ok = true;\n```" }) },
      { name: "CodeBlock", component: c("CodeBlock", { language: "ts", value: "type BuiltinComponent = string;" }) },
      { name: "RichText", component: c("RichText", { blocks: [{ type: "heading", level: 3, text: "Rich text" }, { type: "paragraph", text: "Structured blocks render safely." }, { type: "list", items: ["Paragraph", "List", "Quote"] }] }) },
      { name: "Icon", component: c("Row", { gap: "medium", align: "center" }, [c("Icon", { name: "check", color: "var(--air-success)" }), c("Icon", { name: "warning", color: "var(--air-warning)" }), c("Icon", { name: "search" })]) },
      { name: "Calendar", component: c("Calendar", { month: "2026-06", events: [{ date: "2026-06-09", title: "AIRUI demo", color: "accent" }, { date: "2026-06-16", title: "Review", color: "success" }] }) },
      { name: "Kanban", component: c("Kanban", { columns: [{ key: "todo", title: "Todo", cards: [{ id: "1", title: "Polish media", tags: ["P1"] }] }, { key: "done", title: "Done", cards: [{ id: "2", title: "Renderer build", description: "Passing" }] }] }) },
      { name: "Map", component: c("Map", { markers: [{ id: "sf", label: "SF", lat: 37.77, lng: -122.42 }, { id: "ny", label: "NY", lat: 40.71, lng: -74.0 }] }) },
      { name: "NetworkGraph", component: c("NetworkGraph", { nodes: [{ id: "agent", label: "Agent" }, { id: "airui", label: "AIRUI" }, { id: "user", label: "User" }], edges: [{ source: "agent", target: "airui" }, { source: "airui", target: "user" }] }) },
      { name: "Heatmap", component: c("Heatmap", { data: [{ x: "Mon", y: "API", value: 12 }, { x: "Tue", y: "API", value: 25 }, { x: "Mon", y: "UI", value: 18 }, { x: "Tue", y: "UI", value: 32 }] }) },
    ],
  },
];

function svgData(fg: string, bg: string, label: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="${bg}"/><circle cx="500" cy="92" r="86" fill="${fg}" opacity=".16"/><rect x="72" y="86" width="360" height="126" rx="24" fill="${fg}" opacity=".18"/><text x="86" y="172" font-family="Arial, sans-serif" font-size="52" font-weight="700" fill="${fg}">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function GalleryCard({ item }: { item: DemoItem }) {
  return (
    <article className="airui-gallery-card">
      <header className="airui-gallery-card-header">
        <strong>{item.name}</strong>
      </header>
      <div className="airui-gallery-render">
        <AirUIComponent comp={item.component} />
      </div>
    </article>
  );
}

export default function AirUIGallery() {
  const setDoc = useAirUIStore((store) => store.setDoc);
  const [events, setEvents] = useState<Array<{ ref: string; interaction: string }>>([]);
  const total = useMemo(() => sections.reduce((sum, section) => sum + section.items.length, 0), []);

  useLayoutEffect(() => {
    setDoc(galleryDoc);
  }, [setDoc]);

  return (
    <InteractionProvider
      value={(ref, interaction) => setEvents((current) => [{ ref, interaction }, ...current].slice(0, 8))}
    >
      <main className="airui-gallery-page">
        <header className="airui-gallery-hero">
          <div>
            <div className="airui-gallery-kicker">AIRUI Renderer Gallery</div>
            <h1>76 Built-in Components</h1>
            <p>Every built-in component is rendered through the actual AIRUI React renderer.</p>
          </div>
          <aside>
            <strong>{total}</strong>
            <span>components rendered</span>
          </aside>
        </header>

        {sections.map((section) => (
          <section key={section.title} className="airui-gallery-section">
            <div className="airui-gallery-section-heading">
              <h2>{section.title}</h2>
              <p>{section.description}</p>
            </div>
            <div className="airui-gallery-grid">
              {section.items.map((item) => <GalleryCard key={item.name} item={item} />)}
            </div>
          </section>
        ))}

        <footer className="airui-gallery-events">
          <strong>Recent interactions</strong>
          {events.length === 0 ? <span>Click or change a component to see events here.</span> : events.map((event, index) => (
            <span key={`${event.ref}-${event.interaction}-${index}`}>{event.ref || "(no ref)"} / {event.interaction}</span>
          ))}
        </footer>
      </main>
    </InteractionProvider>
  );
}
