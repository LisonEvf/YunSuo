# AIRUI Capability Inventory

Date: 2026-06-09

## Source Of Truth

AIRUI built-in capability is defined by the React renderer exports in
`packages/airui/packages/renderer-react/src/components/index.ts`.

The current renderer-backed built-in set contains 39 components:

| Area | Components |
| --- | --- |
| Layout | `Column`, `Row`, `Divider` |
| Typography | `Text` |
| Form | `Button`, `Input`, `Select`, `Switch`, `Checkbox`, `Radio`, `Slider`, `Image`, `Dropdown` |
| Data display | `KPI`, `PlateCard`, `Gauge`, `Progress`, `Tag`, `Badge`, `Avatar`, `Skeleton` |
| Data table | `Table`, `Pagination` |
| Chart | `Chart` |
| Navigation | `Tabs`, `Breadcrumb`, `Steps` |
| Overlay | `Modal`, `Drawer`, `DropdownMenu` |
| Feedback | `Alert`, `Loading`, `ErrorFallback`, `Tooltip` |
| Structure | `Dashboard`, `Widget`, `Accordion`, `Timeline`, `Tree` |

`MiniChart` and `EmptyState` are not part of the built-in set because they do not
currently have renderer implementations.

## Alignment Contract

- `packages/airui/packages/core/src/types.ts` exports `BUILTIN_COMPONENTS`, and
  `BuiltinComponent` derives from that constant.
- `apps/api/app/agent/tools.py` accepts all renderer-backed built-ins and
  normalizes flexible names such as `dropdown-menu`, `plate_card`, and
  `errorfallback` to their canonical component names.
- `apps/console/src/components/ConsoleView.tsx` applies the same canonical
  normalization for inline AIRUI artifacts returned in chat messages.
- Tests assert that core, renderer-react, and backend agent tooling stay aligned.

