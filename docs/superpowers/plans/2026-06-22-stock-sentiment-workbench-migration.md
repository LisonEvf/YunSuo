# A股情绪工作台 1:1 迁移实现计划

> **For agentic workers:** follow this plan task-by-task. Use checkbox (`- [ ]`) syntax for tracking. Keep changes scoped to the files named in the active task, and do not revert unrelated worktree changes.

**Goal:** 落地 spec `docs/superpowers/specs/2026-06-22-stock-sentiment-workbench-migration-design.md`，把旧版市场情绪工作台 1:1 集成到当前云梭 Console：新版保留旧版 dashboard 数据契约、五个工作台页签、盘中/策略/AI/设置交互、本地 LLM 调度，同时沿用当前 AIRUI/Chat/Intent/Settings 架构。

**Smallest useful milestone:** 先让后端 `GET /api/stock-sentiment/dashboard` 和兼容 `GET /api/dashboard` 返回完整 13 个顶层 key，并用 fixture 锁定契约。这个里程碑不依赖前端，能最早证明迁移方向没有跑偏。

**Architecture:** 后端新增 `apps/api/app/stock_sentiment/` 包，集中处理 MCP 数据源、dashboard 契约、派生规则、AIRUI 启动 wrapper 和 chat prepare。前端新增 `apps/console/src/stock-sentiment/` 专用工作台 surface，由当前 `stock-sentiment` preset 启动，主区渲染 `StockSentimentWorkbench`，通用 `ArtifactGallery` 只负责承载该 workbench artifact。

**Tech Stack:** FastAPI + pytest（后端），React 19 + Zustand + AIRUI renderer + Vite（前端），KPL/TDX MCP tools，经现有 `app.agent.mcp_client` adapter 调用。

**Spec:** [docs/superpowers/specs/2026-06-22-stock-sentiment-workbench-migration-design.md](../specs/2026-06-22-stock-sentiment-workbench-migration-design.md)

---

## File Structure

| File | Action | Tasks |
|---|---|---|
| `apps/api/app/stock_sentiment/__init__.py` | Create package | 1 |
| `apps/api/app/stock_sentiment/models.py` | Dashboard contract types/defaults | 1 |
| `apps/api/app/stock_sentiment/sources.py` | MCP adapter helpers + defensive parsing/cache | 1 |
| `apps/api/app/stock_sentiment/service.py` | Build 13-key dashboard payload | 1, 2 |
| `apps/api/app/stock_sentiment/airui.py` | Build fixed `stock-workbench` wrapper | 3 |
| `apps/api/app/stock_sentiment/llm_prepare.py` | `/api/chat/prepare` request assembly | 8 |
| `apps/api/app/stock_dashboard.py` | Compatibility wrapper around new package | 3 |
| `apps/api/app/main.py` | Routes for dashboard, preset, chat prepare | 2, 3, 8 |
| `apps/api/tests/fixtures/stock_sentiment_dashboard.json` | Normalized contract fixture | 1 |
| `apps/api/tests/test_stock_sentiment_dashboard.py` | Backend contract tests | 1, 2, 3, 8 |
| `apps/console/src/stock-sentiment/types.ts` | Frontend dashboard types | 4 |
| `apps/console/src/stock-sentiment/api.ts` | Fetch dashboard/chat prepare/local config | 4, 8, 9 |
| `apps/console/src/stock-sentiment/StockSentimentWorkbench.tsx` | Workbench shell and tabs | 5 |
| `apps/console/src/stock-sentiment/SentimentTab.tsx` | 情绪仪表盘 | 6 |
| `apps/console/src/stock-sentiment/IntradayTab.tsx` | 盘中盯盘 | 7 |
| `apps/console/src/stock-sentiment/StrategyTab.tsx` | 明日策略 | 7 |
| `apps/console/src/stock-sentiment/AiAnalysisTab.tsx` | AI 研判 + local LLM | 8 |
| `apps/console/src/stock-sentiment/SentimentSettingsTab.tsx` | 设置 + localStorage migration | 9 |
| `apps/console/src/stock-sentiment/StockInteractionPicker.tsx` | 旧版卡片交互选择器 | 7 |
| `apps/console/src/stock-sentiment/interaction.ts` | Intent mapping | 7 |
| `apps/console/src/airui-custom/gallery.tsx` | Special render path for `stock-workbench` | 4 |
| `apps/console/src/components/ConsoleView.tsx` | `collectArtifactPanels` detects workbench | 4 |
| `apps/console/src/airui-custom/home.tsx` | Preset entry still calls `/api/preset/dashboard` | 4 |
| `apps/console/src/airui-custom/index.tsx` | Register custom component if needed | 4 |
| `apps/console/src/styles.css` | Scoped workbench styles | 5-9 |
| `apps/api/app/agent/domain_templates.py` | Fix stock starter text only if touched by entry | 10 |

---

## Task 1: Backend Contract Fixture And Defaults

**Purpose:** lock the 13-key legacy-compatible dashboard contract before building UI.

**Files:**
- Create: `apps/api/app/stock_sentiment/__init__.py`
- Create: `apps/api/app/stock_sentiment/models.py`
- Create: `apps/api/app/stock_sentiment/sources.py`
- Create: `apps/api/app/stock_sentiment/service.py`
- Create: `apps/api/tests/fixtures/stock_sentiment_dashboard.json`
- Create: `apps/api/tests/test_stock_sentiment_dashboard.py`

- [ ] Step 1: Add fixture `apps/api/tests/fixtures/stock_sentiment_dashboard.json` with the 13 top-level keys from the spec and one representative item for each list domain.
- [ ] Step 2: Add tests asserting `build_dashboard_payload()` returns exactly these top-level keys: `meta`, `overview`, `kpis`, `indexes`, `trend`, `plates`, `methods`, `risks`, `opportunities`, `watchlist`, `monitor`, `intraday`, `raw`.
- [ ] Step 3: Add tests for required nested schemas: `kpis` named fields, `methods` six fixed method names, `intraday.gates/phases/candidates/alerts/interaction`, and item schemas for `risks/opportunities/watchlist/monitor`.
- [ ] Step 4: Implement `models.py` defaults and normalizers so missing source data still produces the full shape.
- [ ] Step 5: Implement `sources.py` with wrappers around `app.agent.mcp_client.call`; all failures return warnings instead of raising through the service.
- [ ] Step 6: Implement `service.py` with a minimal payload using available MCP data plus safe defaults.

**Completion signal:** `cd apps/api && python -m pytest tests/test_stock_sentiment_dashboard.py -q` passes with fixture and failure-path tests.

**Rollback:** If live MCP data blocks tests, isolate MCP calls behind injectable functions and keep fixture tests pure.

---

## Task 2: Backend Data Derivation

**Purpose:** move from skeleton shape to meaningful legacy-compatible values.

**Files:**
- Modify: `apps/api/app/stock_sentiment/service.py`
- Modify: `apps/api/app/stock_sentiment/sources.py`
- Modify: `apps/api/tests/test_stock_sentiment_dashboard.py`

- [ ] Step 1: Derive `overview` and `kpis` from `kpl.emotion_today` and available historical emotion endpoints.
- [ ] Step 2: Derive `indexes` from `tdx.get_index_overview`.
- [ ] Step 3: Derive `trend` from available historical emotion/limit-up endpoints; return available length and add `meta.warnings` if fewer than 30 points.
- [ ] Step 4: Derive `plates` from `kpl.plate_ranking` and optional theme/plate detail calls.
- [ ] Step 5: Derive `methods`, `risks`, `opportunities`, `watchlist`, `monitor`, and `intraday` from the normalized source bundle.
- [ ] Step 6: Add formula comments for each non-obvious score or status decision.

**Completion signal:** backend tests assert non-empty meaningful data when source fixtures are provided and graceful values when tools fail.

**Rollback:** Keep formula changes localized in `service.py`; if a derivation is uncertain, use stable fallback plus a warning rather than blocking the entire payload.

---

## Task 3: Backend Routes And Preset Launch Contract

**Purpose:** expose the data and replace the old multi-card preset with a single `stock-workbench` launch artifact.

**Files:**
- Create: `apps/api/app/stock_sentiment/airui.py`
- Modify: `apps/api/app/stock_dashboard.py`
- Modify: `apps/api/app/main.py`
- Modify: `apps/api/tests/test_stock_sentiment_dashboard.py`

- [ ] Step 1: Add `GET /api/stock-sentiment/dashboard`.
- [ ] Step 2: Add compatibility `GET /api/dashboard` returning the same payload.
- [ ] Step 3: Add `build_workbench_artifact_root()` in `airui.py` that emits the fixed `stock-workbench` wrapper from the spec.
- [ ] Step 4: Change `POST /api/preset/dashboard` to push the `stock-workbench` artifact and return `{ ok, title, workbench }`.
- [ ] Step 5: Keep `stock_dashboard.py` as a small compatibility module or re-export so existing imports do not break.
- [ ] Step 6: Test that prior `row-artifacts` rows are replaced, not duplicated.

**Completion signal:** route tests pass and `/api/preset/dashboard` returns/pushes only the `stock-workbench` wrapper.

**Rollback:** If custom component registration is not ready, the backend can still launch the fixed artifact; frontend will show a temporary fallback until Task 4.

---

## Task 4: Frontend Workbench Registration And Launch

**Purpose:** make the existing preset button open the dedicated workbench surface.

**Files:**
- Create: `apps/console/src/stock-sentiment/types.ts`
- Create: `apps/console/src/stock-sentiment/api.ts`
- Modify: `apps/console/src/components/ConsoleView.tsx`
- Modify: `apps/console/src/airui-custom/gallery.tsx`
- Modify: `apps/console/src/airui-custom/home.tsx` only if endpoint response handling needs adjustment
- Modify: `apps/console/src/airui-custom/index.tsx` only if custom registration is needed

- [ ] Step 1: Add TypeScript types matching the backend fixture.
- [ ] Step 2: Add `fetchStockSentimentDashboard()` and refresh helper.
- [ ] Step 3: Update `collectArtifactPanels` to preserve `workbench` metadata for `stock-workbench`.
- [ ] Step 4: Update `ArtifactGallery` to render `StockSentimentWorkbench` for `artifact.ref === "stock-workbench"` or `artifact.workbench === "stock-sentiment"`.
- [ ] Step 5: Confirm homepage `stock-sentiment` preset still calls `POST /api/preset/dashboard`.
- [ ] Step 6: Add a temporary minimal workbench placeholder if Task 5 is not yet complete.

**Completion signal:** clicking the stock sentiment starter opens a workbench placeholder without breaking ordinary artifacts.

**Verification:** `bun run build:console`.

---

## Task 5: Workbench Shell And Shared UI

**Purpose:** build the five-tab shell, loading/error/refresh states, and reusable display primitives.

**Files:**
- Create: `apps/console/src/stock-sentiment/StockSentimentWorkbench.tsx`
- Create shared helpers inside `apps/console/src/stock-sentiment/` as needed
- Modify: `apps/console/src/styles.css`

- [ ] Step 1: Build shell header: title, updated time, source, warnings, refresh button.
- [ ] Step 2: Add tabs: `情绪仪表盘`, `盘中盯盘`, `明日策略`, `AI 研判`, `设置`.
- [ ] Step 3: Add loading skeleton, empty state, module warning state, and retry.
- [ ] Step 4: Add responsive layout rules scoped under a workbench class.
- [ ] Step 5: Keep visual style product-focused: dense, scannable, no decorative hero, no nested cards.

**Completion signal:** workbench shell renders all five tabs and refreshes dashboard data.

**Verification:** `bun run build:console`; browser smoke test starter -> shell -> tab switching.

---

## Task 6: Sentiment Tab

**Purpose:** migrate the old `情绪仪表盘` functionality.

**Files:**
- Create: `apps/console/src/stock-sentiment/SentimentTab.tsx`
- Modify: `apps/console/src/stock-sentiment/StockSentimentWorkbench.tsx`
- Modify: `apps/console/src/styles.css`

- [ ] Step 1: Render sentiment score, cycle, advice, key KPIs, first/linked board counts, and premium values.
- [ ] Step 2: Render three-line monitor: market coefficient, short sentiment, money-loss effect.
- [ ] Step 3: Render trend chart, plate heat distribution, risk warnings, TOP8 plates, and time plan.
- [ ] Step 4: Add click interactions for sentiment/risk/plate cards via `StockInteractionPicker`.
- [ ] Step 5: Handle empty chart/table data with inline empty states.

**Completion signal:** the old sentiment page’s named sections are visible in the new tab.

**Verification:** browser compare against old page labels and layout coverage.

---

## Task 7: Intraday, Strategy, And Interaction Picker

**Purpose:** migrate execution workflow and next-day strategy, including the old interaction cadence.

**Files:**
- Create: `apps/console/src/stock-sentiment/IntradayTab.tsx`
- Create: `apps/console/src/stock-sentiment/StrategyTab.tsx`
- Create: `apps/console/src/stock-sentiment/StockInteractionPicker.tsx`
- Create: `apps/console/src/stock-sentiment/interaction.ts`
- Modify: `apps/console/src/stock-sentiment/StockSentimentWorkbench.tsx`
- Modify: `apps/console/src/styles.css`

- [ ] Step 1: Render intraday risk score, opportunity score, position, summary, gates, phases, alerts, interaction rule, and candidates.
- [ ] Step 2: Add candidate buttons: `生成操作单` -> `generate_trade_plan`; `仅复核` -> `review_candidate`.
- [ ] Step 3: Render strategy cycle positioning, plate ladder replay, index monitor, method scoring, risk checklist, opportunity watchlist, observation pool, and position advice.
- [ ] Step 4: Build `StockInteractionPicker` with `拆解`, `执行预案`, `风险复核`, and custom prompt.
- [ ] Step 5: Map picker choices to `sendIntent`; custom prompt always uses `custom`, while existing `CorrectionModal` remains the only `correct` path.

**Completion signal:** old intraday and strategy named workflows exist, and core buttons emit the intended structured intent.

**Verification:** browser click tests or manual console observation for intent payloads.

---

## Task 8: AI Analysis And `/api/chat/prepare`

**Purpose:** migrate the old AI 研判 page and browser-local LLM dispatch path.

**Files:**
- Create: `apps/api/app/stock_sentiment/llm_prepare.py`
- Modify: `apps/api/app/main.py`
- Modify: `apps/api/tests/test_stock_sentiment_dashboard.py`
- Create: `apps/console/src/stock-sentiment/AiAnalysisTab.tsx`
- Modify: `apps/console/src/stock-sentiment/api.ts`
- Modify: `apps/console/src/stock-sentiment/StockSentimentWorkbench.tsx`

- [ ] Step 1: Add `POST /api/chat/prepare` accepting `messages`, `stream`, `skills`, and `include_snapshot`.
- [ ] Step 2: Return `request.messages`, stream flag, snapshot, and skills without leaking API keys.
- [ ] Step 3: Implement frontend local LLM call to `${localBaseUrl}/chat/completions` with optional Authorization header.
- [ ] Step 4: Port or rebuild the old markdown/table/action/risk parser as small focused helpers.
- [ ] Step 5: Render AI summary, KPI/table panels, action/risk panels, and AIRUI dynamic extras.
- [ ] Step 6: Add clear error states for disabled local LLM, missing model/base URL, CORS/network failure, and non-2xx response.

**Completion signal:** AI tab can either produce parsed dynamic panels from a local LLM response or display actionable errors.

**Verification:** backend tests for prepare shape and no-key-leak; browser test with a mocked or reachable OpenAI-compatible local endpoint if available.

---

## Task 9: Settings And Local Storage Migration

**Purpose:** migrate old settings while fitting current cloud console settings.

**Files:**
- Create: `apps/console/src/stock-sentiment/SentimentSettingsTab.tsx`
- Modify: `apps/console/src/stock-sentiment/api.ts`
- Modify: `apps/console/src/stock-sentiment/StockSentimentWorkbench.tsx`
- Modify: `apps/console/src/styles.css`

- [ ] Step 1: Read legacy keys: `sentiment-theme`, `LOCAL_LLM_CONFIG_KEY`, `ADMIN_TOKEN_KEY`, and `sentiment-enabled-skills`.
- [ ] Step 2: Save local LLM config to `yunsuo.stockSentiment.localLlm`, while continuing to read the legacy key on first load.
- [ ] Step 3: Map theme choices to current `appConfig.ui.theme`; support automatic/system, light, dark, and graphite.
- [ ] Step 4: Add admin token lock/unlock UI with local persistence.
- [ ] Step 5: Render enabled skills based on current `/api/skills` and workbench state.
- [ ] Step 6: Ensure API keys are never echoed into chat messages, logs, or `/api/chat/prepare`.

**Completion signal:** old settings capabilities exist in the new Settings tab and survive page refresh.

**Verification:** browser refresh test, localStorage inspection, build.

---

## Task 10: Text Encoding, Domain Entry, And Regression Cleanup

**Purpose:** clean only migration-adjacent rough edges so the entry point is usable.

**Files:**
- Modify: `apps/api/app/agent/domain_templates.py` only for stock-related starter text
- Modify: `apps/api/app/stock_dashboard.py` only if compatibility import/export needs cleanup
- Modify: `apps/console/src/i18n.ts` only if user-facing labels are needed
- Do not broad-clean unrelated mojibake in docs or other domains.

- [ ] Step 1: Fix the stock analyst starter labels/prompts if they are shown on the entry path.
- [ ] Step 2: Replace emoji-only action affordances in the stock workbench with existing icon/button vocabulary where needed.
- [ ] Step 3: Ensure generated Chinese text in newly touched files is UTF-8.
- [ ] Step 4: Confirm generic console home, settings, and ordinary artifact gallery still render.

**Completion signal:** stock entry text is readable and unrelated domains are untouched.

**Verification:** `git diff` shows only migration-adjacent text cleanup.

---

## Task 11: End-To-End Verification

**Purpose:** prove 1:1 migration against the original objective.

**Commands:**

```bash
bun run test:api
bun run build:console
```

Browser verification:

- [ ] Old dashboard reference opens at `https://lisonevf-sentiment.hf.space/dashboard/`.
- [ ] New console stock sentiment entry opens the workbench.
- [ ] Five tabs exist: `情绪仪表盘`, `盘中盯盘`, `明日策略`, `AI 研判`, `设置`.
- [ ] Sentiment tab includes old named sections: sentiment score, cycle lines, heat distribution, risk warning, TOP8 plates.
- [ ] Intraday tab includes gates, phases, alerts, candidates, and candidate buttons.
- [ ] Strategy tab includes methods, risks, opportunities, watchlist, observation pool, and position advice.
- [ ] AI tab supports prepare -> local LLM -> parsed panels or clear fallback error.
- [ ] Settings tab supports theme, admin lock, local LLM config, and skill selection.
- [ ] Card click opens interaction picker; custom prompt emits `custom`; correction modal remains `correct`.
- [ ] Ordinary chat and non-stock artifacts still work.

**Completion signal:** all backend tests, frontend build, and browser checks pass. Only then can the active goal be considered complete.

---

## Risks And Rollback

| Risk | Mitigation | Rollback |
|---|---|---|
| Old indicator formulas are not fully visible | Lock the JSON shape and document formula assumptions in `service.py` | Keep defaults and warnings while refining formulas later |
| MCP data differs by date/time | Tests use fixtures; live endpoint allows warnings and partial lists | Disable live derivation per source without breaking shape |
| Dedicated workbench disrupts generic ArtifactGallery | Gate special rendering only on `stock-workbench` | Remove special-case and fall back to a single placeholder artifact |
| Local LLM CORS/config failures look like product bugs | Explicit error states and settings validation | Route AI tab back to `/api/chat` if local path is unavailable |
| Scope grows beyond 1:1 migration | Use spec completion definition as boundary | Defer unrelated cleanup or new trading features |

