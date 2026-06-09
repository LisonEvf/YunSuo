---
name: artifact-design
description: Design compact visual artifacts, AIRUI panels, tables, timelines, and operational dashboards.
---

## Artifact Design Framework

Use this when the user asks for a panel, dashboard, visual artifact, comparison table, workflow view, or status surface.

1. Decide what the artifact must help the user do.
2. Prefer dense, scannable operational layouts over decorative pages.
3. Use tables for comparison, timelines for process, KPI rows for status, and compact cards for repeated items.
4. Keep labels short and avoid explanatory text that belongs in chat.
5. Use stable refs so future tool calls can patch the artifact.
6. Validate that the artifact can stand alone without domain-specific assumptions.
