# General Agent Console Design

## Goal

Convert the project from a stock-market sentiment dashboard into a general agent client.
The first version uses an operations-console layout: chat remains the input and explanation
surface, while the main panel shows run timeline, tool results, artifacts, skills, memory,
and configuration state.

## Scope

- Keep the core agent loop, streaming chat, memory, skills, trajectory recording, review
  scaffolding, configuration APIs, and AIRUI WebSocket/session support.
- Remove stock-market endpoints, stock/KPL/TDX tools, market dashboard auto-refresh,
  and stock-specific skills from the active path.
- Replace the initial AIRUI document with a generic console document.
- Update frontend copy and layout from market dashboard to general agent operations console.
- Preserve AIRUI rendering as a generic artifact surface.

## First Screen

- Left rail: chat input and assistant messages.
- Center: run timeline, artifacts, and tool results.
- Right inspector: active skills, memory status, model/config, and trajectory summary.
- Bottom status: connection, session, tool count, token usage.

## Non-goals

- Do not build a plugin loader in this pass.
- Do not add real shell/file tools in this pass; the generic client should run safely with
  AIRUI rendering tools only.
- Do not delete historical documentation or external SDK folders yet. Remove them from the
  app's main runtime path first.

## Evolution: Generative-UI Agent

The console conversion above (sentiment dashboard → general agent console) established the
**message-driven** baseline: chat as the primary input, AIRUI as the artifact surface.

The next step is an **interaction-paradigm upgrade** to a click-driven generative-UI agent,
where each AIRUI document *is* the agent's reply and each clickable element carries a
structured intent payload. Users drive the loop purely by clicking; when a prediction is
wrong, a correction modal lets them fix or rephrase the intent, and the discrepancy is stored
as prediction memory so the next screen's predictions improve.

This is an upgrade, not a rebuild — the AIRUI interaction events, the `/ws/airui` channel,
the `HOME_PROMPTS` starter cards, skill routing, and MCP injection all stay in place. What
is missing is intent modeling, prediction/correction/memory, and making panels/flows a
first-class concept.

Full design, gap analysis, and step-by-step evolution path:
[docs/generative-ui-agent-design.md](generative-ui-agent-design.md).
