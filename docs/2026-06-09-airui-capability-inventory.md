# AIRUI Capability Inventory

Date: 2026-06-09

## Source Of Truth

AIRUI built-in capability is defined by the React renderer exports in
`packages/airui/packages/renderer-react/src/components/index.ts`.

The current renderer-backed built-in set contains 76 components:

| Area | Components |
| --- | --- |
| Layout | `Column`, `Row`, `Divider` |
| Typography | `Text` |
| Form | `Button`, `Input`, `Select`, `Switch`, `Checkbox`, `Radio`, `Slider`, `Image`, `Dropdown` |
| Advanced form | `Form`, `Textarea`, `DatePicker`, `TimePicker`, `DateRangePicker`, `NumberInput`, `Autocomplete`, `MultiSelect`, `FileUpload` |
| Media | `Video`, `Audio`, `ImageGallery`, `Carousel`, `Lightbox`, `PDFViewer` |
| Data display | `KPI`, `PlateCard`, `Gauge`, `Progress`, `Tag`, `Badge`, `Avatar`, `Skeleton` |
| Data table | `Table`, `Pagination` |
| Data workbench | `DataGrid`, `EmptyState` |
| Chart | `Chart` |
| Navigation | `Tabs`, `Breadcrumb`, `Steps` |
| Overlay | `Modal`, `Drawer`, `DropdownMenu` |
| Feedback | `Alert`, `Loading`, `ErrorFallback`, `Tooltip`, `Toast`, `Notification`, `Popconfirm`, `ContextMenu`, `CommandPalette` |
| Structure | `Dashboard`, `Widget`, `Accordion`, `Timeline`, `Tree` |
| App shell | `AppShell`, `Sidebar`, `TopNav`, `Toolbar`, `SplitPane`, `ScrollArea` |
| Content | `Markdown`, `CodeBlock`, `RichText`, `Icon` |
| Domain views | `Calendar`, `Kanban`, `Map`, `NetworkGraph`, `Heatmap` |

`MiniChart` is not part of the built-in set because it does not currently have a
renderer implementation.

## Alignment Contract

- `packages/airui/packages/core/src/types.ts` exports `BUILTIN_COMPONENTS`, and
  `BuiltinComponent` derives from that constant.
- `apps/api/app/agent/tools.py` accepts all renderer-backed built-ins and
  normalizes flexible names such as `dropdown-menu`, `plate_card`, and
  `errorfallback` to their canonical component names.
- `apps/console/src/components/ConsoleView.tsx` applies the same canonical
  normalization for inline AIRUI artifacts returned in chat messages.
- Tests assert that core, renderer-react, and backend agent tooling stay aligned.
