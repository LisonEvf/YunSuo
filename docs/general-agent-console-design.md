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
