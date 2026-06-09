# AIRUI Component Expansion Design

Date: 2026-06-09

## Goal

Expand AIRUI from an operations-dashboard renderer into a broader app-artifact
renderer. The first version should make every common frontend capability
renderable through AIRUI documents without adding heavyweight dependencies or
turning AIRUI into a full application framework.

## Scope

Add 37 renderer-backed built-ins:

- Media: `Video`, `Audio`, `ImageGallery`, `Carousel`, `Lightbox`, `PDFViewer`
- Form: `Form`, `Textarea`, `DatePicker`, `TimePicker`, `DateRangePicker`,
  `NumberInput`, `Autocomplete`, `MultiSelect`, `FileUpload`
- App shell: `AppShell`, `Sidebar`, `TopNav`, `Toolbar`, `SplitPane`,
  `ScrollArea`
- Data workbench: `DataGrid`, `EmptyState`
- Feedback and commands: `Toast`, `Notification`, `Popconfirm`, `ContextMenu`,
  `CommandPalette`
- Content: `Markdown`, `CodeBlock`, `RichText`, `Icon`
- Domain views: `Calendar`, `Kanban`, `Map`, `NetworkGraph`, `Heatmap`

The expanded built-in set will contain 76 components.

## Design

The renderer remains the source of truth for built-in capability. Core exports a
`BUILTIN_COMPONENTS` constant derived from the renderer-backed list, and tests
assert that renderer exports match it exactly.

Components should accept plain JSON props that are easy for agents to generate.
Interactive components emit simple events such as `change`, `select`, `submit`,
`click`, `open`, `close`, `play`, `pause`, `ended`, and `seek`.

Complex components get useful first-version behavior:

- `DataGrid` supports sorting, filtering, selection, sticky headers, and a
  virtualized body.
- Media components use browser-native rendering primitives.
- `Markdown`, `CodeBlock`, and `RichText` render safe React text nodes rather
  than injecting raw HTML.
- `Map`, `NetworkGraph`, and `Heatmap` render lightweight visual summaries from
  JSON data without external map or graph engines.

## Alignment

The backend AIRUI tool and console inline artifact normalizer must recognize all
built-ins and normalize flexible spellings such as `pdf-viewer`,
`command_palette`, `data-grid`, and `video-player`.

## Verification

- AIRUI core tests and build
- AIRUI renderer-react tests and build
- Backend agent tool tests
- Console production build

