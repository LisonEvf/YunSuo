# 阶段 0：基础配置 + 使用体验优化 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 spec `docs/superpowers/specs/2026-06-15-stage0-config-ux-design.md` 的 5 项（C1/A1/A2/B1/B2），让 console 配置即时生效、artifact 带「预设下一步」按钮、对话窗口在产出 artifact 后自动弱化。

**Architecture:** 后端唯一改动是 C1（`render_airui_panel` 支持 `actions` 参数 + system_prompt 引导），其余 4 项都是前端改动。后端走 TDD（项目有 pytest 基建），前端无单测，走 `tsc + vite build` + 手动验收（遵循项目既有模式，不强行引入 vitest）。

**Tech Stack:** FastAPI + pytest（后端）；React 19 + Zustand + AIRUI + Vite（前端）；Bun workspaces。

---

## File Structure

| 文件 | 改动 | 任务 |
|---|---|---|
| `apps/api/app/agent/tools.py` | Modify：`render_airui_panel` 加 `actions` 参数 + 透传进 Widget.props | Task 1 |
| `apps/api/tests/test_agent_tools.py` | Modify：加 actions 透传测试 | Task 1 |
| `apps/api/app/agent/system_prompt.py` | Modify：AIRUI 引导段加 actions 说明 | Task 2 |
| `apps/console/src/airui-custom/helpers.ts` | Modify：`ArtifactPanel` 加 `actions` 字段 | Task 3 |
| `apps/console/src/components/ConsoleView.tsx` | Modify：`collectArtifactPanels` 提取 actions；去 45s 轮询改事件驱动；openSettings 触发刷新 | Task 3, 7 |
| `apps/console/src/airui-custom/gallery.tsx` | Modify：渲染 actions 按钮 + sendChat | Task 4 |
| `apps/console/src/airui-custom/llm.tsx` | Modify：activate 即时 PUT（A2）；MCP 应用并重连（A1） | Task 5, 6 |
| `apps/console/src/i18n.ts` | Modify：加 `applyAndReconnect` 文案 | Task 6 |
| `apps/console/src/chat.ts` | Modify：done 后触发 inspector 刷新（B1）；airui 首次产出后折叠 chat（B2） | Task 7, 8 |

---

## Task 1: C1 后端 — `render_airui_panel` 支持 actions 参数（TDD）

**Files:**
- Modify: `apps/api/app/agent/tools.py:26-44`（TOOL_DEFINITIONS）和 `tools.py:135-174`（`_render_airui_panel`）
- Test: `apps/api/tests/test_agent_tools.py`

- [ ] **Step 1: 写失败测试**

在 `apps/api/tests/test_agent_tools.py` 末尾追加：

```python
def test_render_airui_panel_attaches_actions_to_widget(monkeypatch):
    fake_doc = {"root": {"type": "Dashboard", "children": [{"ref": "row-artifacts", "type": "Row", "children": []}]}}

    class FakeSession:
        def __init__(self):
            self.doc = fake_doc

    class FakeManager:
        def get_or_create(self, session_id):
            return FakeSession()

    async def fake_push(*args, **kwargs):
        return None

    monkeypatch.setattr("app.airui.session.session_manager", FakeManager())
    monkeypatch.setattr("app.airui.ws_bridge.push_document", fake_push)

    from app.agent.tools import _render_airui_panel
    actions = [{"label": "导出", "prompt": "把当前表格导出为 CSV", "variant": "secondary"}]
    result = _render_airui_panel({
        "ref": "artifact-test",
        "title": "测试面板",
        "content": {"type": "KPI", "props": {"label": "总数", "value": 3}},
        "actions": actions,
    })

    assert result["status"] == "rendered"
    widget = fake_doc["root"]["children"][0]["children"][-1]
    assert widget["ref"] == "artifact-test"
    assert widget["props"]["actions"] == actions
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && python -m pytest tests/test_agent_tools.py::test_render_airui_panel_attaches_actions_to_widget -v`
Expected: FAIL（`KeyError: 'actions'`，当前 Widget.props 不含 actions）

- [ ] **Step 3: 改 TOOL_DEFINITIONS 加 actions 参数**

在 `apps/api/app/agent/tools.py` 的 `render_airui_panel` 定义里，`content` 参数后、`session_id` 参数前插入：

```python
                    "actions": {
                        "type": "array",
                        "description": "Suggested next-step actions shown as buttons under the panel. Each item: {label (short button caption), prompt (a directly executable instruction sent on click), variant ('primary'|'secondary', optional)}. Aim for 2-4 actions matching what the user most likely wants next.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {"type": "string"},
                                "prompt": {"type": "string"},
                                "variant": {"type": "string"},
                            },
                        },
                    },
```

- [ ] **Step 4: 改 `_render_airui_panel` 透传 actions**

在 `apps/api/app/agent/tools.py:140-145`（读取 col_span/row_span 附近）后加：

```python
    actions = args.get("actions")
```

把 `tools.py:166-171` 的 `target_children.append({...})` 替换为：

```python
    widget_props = {"title": title, "colSpan": max(1, min(col_span, 12)), "rowSpan": max(1, row_span)}
    if isinstance(actions, list):
        widget_props["actions"] = actions
    target_children.append({
        "type": "Widget",
        "ref": ref,
        "props": widget_props,
        "children": [content],
    })
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd apps/api && python -m pytest tests/test_agent_tools.py::test_render_airui_panel_attaches_actions_to_widget -v`
Expected: PASS

- [ ] **Step 6: 跑全量后端测试确保无回归**

Run: `cd apps/api && python -m pytest tests -q`
Expected: 85 passed（原 84 + 新 1）

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/agent/tools.py apps/api/tests/test_agent_tools.py
git commit -m "feat(api): render_airui_panel 支持 actions 参数透传进 Widget.props"
```

---

## Task 2: C1 后端 — system_prompt 加 actions 引导

**Files:**
- Modify: `apps/api/app/agent/system_prompt.py:23-38`（AIRUI Artifact Guidance 段）

- [ ] **Step 1: 在 AIRUI Artifact Guidance 段加 actions 引导**

在 `system_prompt.py` 的 `Use stable refs such as ...` 那一行之后、`Common component shapes:` 之前，插入：

```text
- For every artifact, include 2-4 `actions` (suggested next steps the user can trigger with one click, without typing). Each action = {label, prompt, variant?}: `label` is a short caption (≤6 chars, e.g. "导出"/"对比"/"深入"); `prompt` is a directly executable instruction sent as the next user turn; `variant` is "primary" for the recommended action or "secondary" otherwise. Pick actions that match what the user most likely wants to do next with this artifact.
```

- [ ] **Step 2: 确认 prompt 构建无语法错误**

Run: `cd apps/api && python -c "from app.agent.system_prompt import build_system_prompt; print(build_system_prompt()[:200])"`
Expected: 打印 prompt 开头，无异常

- [ ] **Step 3: Commit**

```bash
git add apps/api/app/agent/system_prompt.py
git commit -m "feat(api): system_prompt 引导 agent 为 artifact 生成 suggested actions"
```

---

## Task 3: C1 前端 — ArtifactPanel 类型 + collectArtifactPanels 提取 actions

**Files:**
- Modify: `apps/console/src/airui-custom/helpers.ts:91-95`
- Modify: `apps/console/src/components/ConsoleView.tsx:26-39`

- [ ] **Step 1: helpers.ts 加 SuggestedAction 类型 + ArtifactPanel.actions**

把 `apps/console/src/airui-custom/helpers.ts:91-95` 的 `ArtifactPanel` 替换为：

```typescript
export interface SuggestedAction {
  label: string;
  prompt: string;
  variant?: string;
}

export interface ArtifactPanel {
  ref: string;
  title: string;
  component: Component;
  actions?: SuggestedAction[];
}
```

- [ ] **Step 2: collectArtifactPanels 提取 actions**

把 `apps/console/src/components/ConsoleView.tsx:30-38` 的 `.map((widget, index) => {...})` 返回值替换为：

```typescript
    return {
      ref,
      title: String(widget?.props?.title ?? ref),
      component: normalizeAirUIComponent(inner),
      actions: Array.isArray(widget?.props?.actions) ? widget.props.actions : undefined,
    };
```

- [ ] **Step 3: tsc 类型检查通过**

Run: `cd apps/console && npx tsc -b --noEmit`
Expected: 无错误（`actions` 是可选字段，chat 通道的 `chatPanel` 构造不传 actions 也不报错）

- [ ] **Step 4: Commit**

```bash
git add apps/console/src/airui-custom/helpers.ts apps/console/src/components/ConsoleView.tsx
git commit -m "feat(console): ArtifactPanel 提取并携带 suggested actions"
```

---

## Task 4: C1 前端 — gallery 渲染 actions 按钮

**Files:**
- Modify: `apps/console/src/airui-custom/gallery.tsx`

- [ ] **Step 1: 顶部加 sendChat + chatLoading import**

把 `apps/console/src/airui-custom/gallery.tsx:1-7` 的 import 区，在 `import { savePreset } from "./presets";` 后加：

```typescript
import { sendChat } from "../chat";
import { useStore } from "../store";
```

- [ ] **Step 2: 组件内取 chatLoading**

在 `apps/console/src/airui-custom/gallery.tsx` 的 `ArtifactGallery` 组件内，`const setDoc = useAirUIStore((s) => s.setDoc);` 后加：

```typescript
  const loading = useStore((s) => s.chatLoading);
```

- [ ] **Step 3: 卡片底部渲染 actions 按钮区**

在 `gallery.tsx` 的 `<div className="airui-gallery-card" style={{ padding: 12 }}><AirUIComponent comp={artifact.component} /></div>` 之后、卡片闭合 `</div>` 之前，插入：

```tsx
            {artifact.actions && artifact.actions.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "0 12px 12px", borderTop: "1px solid var(--color-border)", paddingTop: 10 }}>
                {artifact.actions.map((action, i) => {
                  const primary = action.variant === "primary";
                  return (
                    <button
                      key={i}
                      onClick={() => { if (!loading) void sendChat(action.prompt); }}
                      disabled={loading}
                      style={{
                        padding: "6px 12px", borderRadius: 8, cursor: loading ? "default" : "pointer",
                        fontSize: 12, fontWeight: 600, letterSpacing: "-0.005em",
                        border: `1px solid ${primary ? "var(--color-primary)" : "var(--color-border)"}`,
                        background: primary ? "var(--color-primary)" : "var(--color-surface)",
                        color: primary ? "#fff" : "var(--color-text)",
                        opacity: loading ? 0.6 : 1,
                      }}
                    >
                      {action.label}
                    </button>
                  );
                })}
              </div>
            )}
```

- [ ] **Step 4: tsc + build 通过**

Run: `cd apps/console && npx tsc -b --noEmit && bun run build`
Expected: 无错误，构建成功

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/airui-custom/gallery.tsx
git commit -m "feat(console): artifact 画廊渲染 suggested action 按钮，点击 sendChat 驱动下一轮"
```

---

## Task 5: A2 — provider 切换即时生效

**Files:**
- Modify: `apps/console/src/airui-custom/llm.tsx:244-259`（`activate`）

- [ ] **Step 1: activate 改 async 并即时 PUT**

把 `apps/console/src/airui-custom/llm.tsx` 的 `const activate = (id: string) => {...}`（244-259 行）替换为：

```typescript
  const activate = async (id: string) => {
    const inst = providers.find((p) => p.id === id);
    if (!inst) return;
    patchDraft({
      active_provider_id: id,
      model: {
        ...model,
        display_name: inst.name,
        provider: inst.provider,
        name: inst.model_name,
        base_url: inst.base_url,
        api_key: inst.api_key,
        max_output_tokens: inst.max_output_tokens,
      },
    });
    // 即时生效：merge 进 appConfig 并 PUT，后端 reset_agent 使下一轮用新 provider
    try {
      const current = useStore.getState().appConfig;
      const next = {
        ...current,
        active_provider_id: id,
        model: {
          ...current.model,
          display_name: inst.name,
          provider: inst.provider,
          name: inst.model_name,
          base_url: inst.base_url,
          api_key: inst.api_key,
          max_output_tokens: inst.max_output_tokens,
        },
      };
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: next }),
      });
      if (res.ok) {
        const payload = await res.json();
        useStore.getState().setAppConfig(payload?.config ?? next);
      }
    } catch { /* 即时生效失败不阻塞 draft 编辑，用户仍可底部统一保存 */ }
  };
```

- [ ] **Step 2: 修正调用点（activate 现在是 async）**

`llm.tsx` 中调用 `activate` 的地方是 `onClick={() => activate(p.id)}`（约 357 行），改成 `onClick={() => { void activate(p.id); }}`。

- [ ] **Step 3: tsc + build 通过**

Run: `cd apps/console && npx tsc -b --noEmit && bun run build`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add apps/console/src/airui-custom/llm.tsx
git commit -m "feat(console): provider 切换即时 PUT 生效，无需底部统一保存"
```

---

## Task 6: A1 — MCP「应用并重连」一步生效

**Files:**
- Modify: `apps/console/src/airui-custom/llm.tsx:66-79`（`reconnect`）
- Modify: `apps/console/src/i18n.ts`（加文案）
- Modify: `apps/console/src/airui-custom/llm.tsx:88`（按钮文案）

- [ ] **Step 1: i18n 加 applyAndReconnect 文案**

在 `apps/console/src/i18n.ts` 的 zh-CN messages 对象里加键值 `"applyAndReconnect": "应用并重连"`；在 en-US messages 对象里加 `"applyAndReconnect": "Apply & Reconnect"`。（加在已有 `reconnect` / `reconnecting` 键附近）

- [ ] **Step 2: reconnect 改成 applyMcpAndReconnect（先 PUT config 再重连）**

把 `apps/console/src/airui-custom/llm.tsx:66-79` 的 `reconnect` 函数替换为：

```typescript
  const applyMcpAndReconnect = async () => {
    setReconnecting(true);
    setError("");
    try {
      // 1. merge draft.mcp 进 appConfig 并 PUT，让后端拿到最新 MCP 配置
      const current = useStore.getState().appConfig;
      const next = {
        ...current,
        mcp: { ...current.mcp, servers: servers.map((s) => ({ ...s })) },
      };
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      useStore.getState().setAppConfig(payload?.config ?? next);
      // 2. 重连（读已保存的 config）
      const r2 = await fetch("/api/mcp/reconnect", { method: "POST" });
      if (!r2.ok) throw new Error(`HTTP ${r2.status}`);
      const data = await r2.json();
      if (doc) setDoc({ ...doc, state: setByPath(doc.state, "mcpServers", data.servers || []) });
    } catch {
      setError(txt("reconnectFailed"));
    } finally {
      setReconnecting(false);
    }
  };
```

- [ ] **Step 3: 按钮调用点改名 + 文案**

把 `llm.tsx` 中 reconnect 按钮（约 88 行）：
- `onClick={reconnect}` → `onClick={applyMcpAndReconnect}`
- `{reconnecting ? txt("reconnecting") : txt("reconnect")}` → `{reconnecting ? txt("reconnecting") : txt("applyAndReconnect")}`

- [ ] **Step 4: tsc + build 通过**

Run: `cd apps/console && npx tsc -b --noEmit && bun run build`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/airui-custom/llm.tsx apps/console/src/i18n.ts
git commit -m "feat(console): MCP 配置「应用并重连」一步生效，去掉先保存再重连"
```

---

## Task 7: B1 — 去掉 45s 轮询，改事件驱动

**Files:**
- Modify: `apps/console/src/components/ConsoleView.tsx:185-234`（loadInspector + setInterval）和 `ConsoleView.tsx:46-63`（openSettings）
- Modify: `apps/console/src/chat.ts:108-110`（done 事件）

- [ ] **Step 1: loadInspector 提到组件顶层 useCallback**

把 `apps/console/src/components/ConsoleView.tsx:185-234` 的 `useEffect(() => { let cancelled = false; async function loadInspector() {...} loadInspector(); const timer = setInterval(loadInspector, 45000); return ...; }, [language, setAppConfig])` 整体替换为两段：

先在组件内（其他 useEffect 附近）加 `loadInspector` 的 useCallback 定义：

```typescript
  const loadInspector = useCallback(async () => {
    try {
      const [skillsRes, memoryRes, trajectoriesRes, configRes, mcpRes, pluginsRes] = await Promise.all([
        fetch("/api/skills"),
        fetch("/api/memory/stats"),
        fetch("/api/trajectories/summary"),
        fetch("/api/config"),
        fetch("/api/mcp/status"),
        fetch("/api/plugins"),
      ]);
      const [skills, memory, trajectories, config, mcpStatus, pluginsData] = await Promise.all([
        skillsRes.json(), memoryRes.json(), trajectoriesRes.json(),
        configRes.json(), mcpRes.json(), pluginsRes.json(),
      ]);
      const loaded = config?.config || defaultAgentConfig;
      setAppConfig(loaded);
      const lang = loaded?.ui?.language || language;
      const docState = useAirUIStore.getState().doc;
      if (docState) {
        useAirUIStore.getState().applyPatch([{
          op: "update-state",
          stateDelta: {
            skills: skills.skills || [],
            mcpServers: mcpStatus.servers || [],
            plugins: pluginsData.plugins || [],
            runtime: {
              modelText: loaded?.model?.name || t(lang, "notLoaded"),
              memoryText: `${memory.total || 0} ${t(lang, "entries")}`,
              trajectoriesText: `${trajectories.total || 0} ${t(lang, "samples")}`,
              failedText: `${trajectories.failed || 0}`,
              skillsCountText: String(skills.skills?.length || 0),
            },
          },
        }]);
      }
    } catch {
      // 静默：保留上一次 inspector 数据
    }
  }, [language, setAppConfig]);
```

再加两个 useEffect（mount 触发 + 事件监听），**取代原 setInterval**：

```typescript
  // mount + 语言切换时拉一次（不再定时轮询）
  useEffect(() => { void loadInspector(); }, [loadInspector]);

  // 事件驱动刷新：chat done / 进设置页时触发
  useEffect(() => {
    const handler = () => { void loadInspector(); };
    window.addEventListener("yunsuo:inspector-refresh", handler);
    return () => window.removeEventListener("yunsuo:inspector-refresh", handler);
  }, [loadInspector]);
```

- [ ] **Step 2: openSettings 触发刷新**

在 `apps/console/src/components/ConsoleView.tsx` 的 `openSettings()` 函数末尾（`patchConsole({...} as DraftShape);` 之后）加：

```typescript
  window.dispatchEvent(new CustomEvent("yunsuo:inspector-refresh"));
```

- [ ] **Step 3: chat.ts done 后触发刷新**

把 `apps/console/src/chat.ts:108-110` 的 `if (evt.type === "done") {...}` 块替换为：

```typescript
        if (evt.type === "done") {
          useStore.getState().addRunEvent({ label: "Final response", detail: "Assistant response completed.", state: "done" });
          window.dispatchEvent(new CustomEvent("yunsuo:inspector-refresh"));
        }
```

- [ ] **Step 4: 确认 useCallback 已 import**

`apps/console/src/components/ConsoleView.tsx:1` 已是 `import { useCallback, useEffect, useMemo } from "react";`，无需改。若 tsc 报错才补。

- [ ] **Step 5: tsc + build 通过**

Run: `cd apps/console && npx tsc -b --noEmit && bun run build`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/components/ConsoleView.tsx apps/console/src/chat.ts
git commit -m "refactor(console): 去掉 45s 轮询，inspector 改事件驱动刷新"
```

---

## Task 8: B2 — 产出首个 artifact 后自动折叠 chat

**Files:**
- Modify: `apps/console/src/chat.ts:100-102`（airui 事件）

- [ ] **Step 1: 加模块级「只折叠一次」标志 + airui 事件后折叠**

在 `apps/console/src/chat.ts` 顶部（`export async function sendChat` 之前）加：

```typescript
// 整场会话首个 artifact 产出后自动折叠 chat 一次，让用户聚焦 artifact + actions
let autoCollapsedThisSession = false;
```

把 `apps/console/src/chat.ts:100-102` 的 `if (evt.type === "airui" && evt.data) {...}` 块替换为：

```typescript
        if (evt.type === "airui" && evt.data) {
          useStore.getState().updateLastMessage({ content: assistantContent, airui: evt.data, toolStatus: toolStatuses });
          if (!autoCollapsedThisSession) {
            autoCollapsedThisSession = true;
            const cfg = useStore.getState().appConfig;
            useStore.getState().setAppConfig({ ui: { ...cfg.ui, chatCollapsed: true } });
          }
        }
```

- [ ] **Step 2: tsc + build 通过**

Run: `cd apps/console && npx tsc -b --noEmit && bun run build`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/chat.ts
git commit -m "feat(console): 首个 artifact 产出后自动折叠 chat，弱化对话窗口"
```

---

## Task 9: 整体验证

- [ ] **Step 1: 后端全量测试**

Run: `cd apps/api && python -m pytest tests -q`
Expected: 85 passed

- [ ] **Step 2: 前端构建**

Run: `bun run build:console`
Expected: tsc + vite build 成功，主 chunk 体积无明显回归（基准 175 KB）

- [ ] **Step 3: 手动验收（启动 `bun run dev`）**

1. **A1**：设置 → MCP，改一个 server 配置 → 点「应用并重连」→ 一步生效（Network 面板看到 PUT /api/config + POST /api/mcp/reconnect）
2. **A2**：设置 → 已保存 provider，点「激活」→ 发一条消息 → 确认用的是新 provider
3. **B1**：静置 1 分钟 → Network 面板无周期性 /api/skills 等请求；发一条消息 → done 后 inspector 刷新一次
4. **C1 + B2**：让 agent「生成一个示例运营看板」→ 看板底部出现 actions 按钮 + chat 自动折叠 → 点一个 action → 新一轮产出

---

## Self-Review

**Spec coverage:** C1→Task 1-4；A1→Task 6；A2→Task 5；B1→Task 7；B2→Task 8；整体验证→Task 9。spec 的 5 项全部覆盖，非目标（C2/A3/api_key 脱敏/阶段 1-2 内容）均不在本计划。

**Placeholder scan:** 无 TBD/TODO，每个 code step 都有完整代码。

**Type consistency:** `SuggestedAction`（helpers.ts）→ `ArtifactPanel.actions`（helpers.ts/ConsoleView.tsx）→ gallery.tsx `artifact.actions` 全链路命名一致；`actions` 在后端 Widget.props / 前端 ArtifactPanel / gallery 三处字段名统一为 `actions`。
