# AIRUI 使用手册

> 本手册基于 [`packages/airui`](../packages/airui/) 的实际实现，描述 AIRUI 的中间表示（IR）、组件清单、事件与增量更新、React 渲染 API，以及在 `apps/console` 中的集成方式。
>
> 相关文档：主题系统见 [`2026-06-09-theme-system.md`](./2026-06-09-theme-system.md)。早期设计意图见包内 [`design.md`](../packages/airui/design.md)（部分已被实现超越，以本文为准）。

## 1. 概述

AIRUI（AI-Ready User Interface）是一种为 LLM 原生设计的 UI 中间表示：用**强结构化 JSON** 描述界面，显式 `state` 承载状态，意图级 `on` 事件驱动交互，原生支持 JSON Patch 增量更新。模型只产出 JSON，渲染器负责映射成真实界面。

**monorepo 结构**（`packages/airui` 为 git submodule，仓库 `LisonEvf/AIRUI`）：

| 包 | 作用 |
|---|---|
| [`@air-ui/core`](../packages/airui/packages/core/src/) | 类型定义 + 状态路径工具 + Patch 应用 + 文档校验，无平台依赖 |
| [`@air-ui/renderer-react`](../packages/airui/packages/renderer-react/src/) | React 渲染器：组件库、状态 store、事件处理、注册表 |

React 渲染器 peerDeps：`react@^18|^19`、`react-dom`、`echarts@^5.6`。

## 2. 快速开始

### 2.1 引入包

```ts
// main.tsx —— 先基线主题，后应用特色主题（顺序决定级联优先级）
import "@air-ui/renderer-react/theme.css"; // light 基线 token（--color-* + --air-* 桥接）
import "./styles.css";                      // 应用层 dark/graphite/neon/glass 等特色覆盖
```

### 2.2 最小渲染

```tsx
import { AirUIComponent, useAirUIStore } from "@air-ui/renderer-react";
import { InteractionProvider } from "@air-ui/renderer-react";

function App({ doc, onInteraction }) {
  const setDoc = useAirUIStore((s) => s.setDoc);
  useEffect(() => { if (doc) setDoc(doc); }, [doc]);

  return (
    <InteractionProvider value={onInteraction}>
      <AirUIComponent comp={doc.root} />
    </InteractionProvider>
  );
}
```

> `AirUIComponent` 从全局 `useAirUIStore` 读取 `doc.state` 来解析 props。必须先把文档喂给 store（`setDoc`），再渲染 `root`。

## 3. 文档结构（IR）

[`AirUIDocument`](../packages/airui/packages/core/src/types.ts)：

```ts
interface AirUIDocument {
  schema: "air-ui@1";          // 固定值，校验以此为准
  viewport: { width: number; height: number };
  state: Record<string, unknown>;        // 全局状态，唯一数据源
  root: Component;                        // 根组件树
  components?: Record<string, ComponentDefinition>; // 可复用组件定义
}
```

`Component`：

```ts
interface Component {
  type: string;                   // 内置组件名 / 注册的自定义组件名
  props?: Record<string, any>;    // 经 state 解析后传入渲染器
  state?: Record<string, any>;    // 局部状态（预留）
  children?: Component[];         // 子组件
  slots?: Record<string, Component>; // 具名插槽（预留）
  on?: Record<string, EventHandler>; // 事件 → 动作
  ref?: string;                   // 标识，供父组件/交互回传使用
}
```

## 4. 状态与数据绑定

props 值在渲染前由 [`resolveProps`](../packages/airui/packages/renderer-react/src/resolve.ts) 解析：

| 写法 | 含义 |
|---|---|
| `"@state.foo.bar"` | 整值绑定：取 `state.foo.bar`（仅当字符串**整体**是此形式） |
| `"当前：{state.count}"` | 模板插值：`{state.xxx}` 被替换为对应值（`Text` 的 `value` 也支持，[typography.tsx](../packages/airui/packages/renderer-react/src/components/typography.tsx) 内二次插值） |
| 其它 | 原样传递（对象/数组递归解析） |

状态路径（[state.ts](../packages/airui/packages/core/src/state.ts)）：`state.foo.bar` 与 `@state.foo.bar` 等价，`.` 与 `/` 都可作分隔符。取不到值返回 `undefined`，模板里保留 `{state.xxx}` 原文。

## 5. 事件系统

`on.<event>` 映射到 [`EventHandler`](../packages/airui/packages/core/src/types.ts)，由 [`handleEvent`](../packages/airui/packages/renderer-react/src/host.ts) 执行。四种 action：

| action | 必填字段 | 行为 |
|---|---|---|
| `mutate` | `target`(状态路径) + `by`(数值) | 当前数值 + `by`，写回 `target` |
| `set` | `target` + `value` | 将 `target` 设为 `value`；`value` 支持 `$event.xxx` 取事件载荷 |
| `emit` | `event`(对象) | `window.dispatchEvent("air-ui-event", event)`，供外部 agent 监听 |
| `call` | `function` + `args` | 调用通过 `registerHostFunction` 注册的宿主函数 |

`when`（可选）：自然语言或条件表达式，仅作文档意图标注，**当前实现不执行**。

事件载荷 `$event.xxx`：组件派发交互时携带的字段（如 `Select` 的 `{ value }`、`Chart` 的 `{ category, value }`、`Table` 的 `{ row, index }`），`set` 可直接引用。

> **两类交互通道**：
> - `on` → 上述 action，**本地**修改 `state`（mutate/set）或对外发信号（emit/call）。
> - **Interaction 回传**：组件 `emit("drilldown", payload)` 等通过 `useComponentEvents` → `InteractionProvider` → 上层回调（见 §8.3），通常经 WebSocket 发回后端 agent，由 agent 产出新文档/patch。

## 6. 增量更新（Patch）

[`Patch`](../packages/airui/packages/core/src/types.ts) 是 RFC 6902 子集 + `update-state`：

```ts
type Patch =
  | { op: "replace"; path: string; value: unknown }
  | { op: "add"; path: string; value: unknown }
  | { op: "remove"; path: string }
  | { op: "update-state"; stateDelta: Record<string, unknown> };
```

- `path` 为 JSON Pointer：`/root/children/0/props/value`、`/state/counter`（`~1`→`/`，`~0`→`~`）。
- `update-state` 是浅合并：`Object.assign(doc.state, stateDelta)`，最常用于只改状态不重排结构。
- 应用入口：[`applyPatches(doc, patches)`](../packages/airui/packages/core/src/state.ts)（不可变，返回新 doc）。

> 只改 `state` 时优先用 `update-state`，渲染器会自动重算依赖该 state 的 props（含 `{state.xxx}` 模板）。无需重发整棵树。

## 7. 内置组件

全部内置类型见 [`BUILTIN_COMPONENTS`](../packages/airui/packages/core/src/types.ts)（70+），渲染映射见 [engine.tsx](../packages/airui/packages/renderer-react/src/components/engine.tsx) 的 `builtinMap`。未知 `type` 渲染为红色 `Unknown: <type>` 提示。

### 7.1 布局（[layout.tsx](../packages/airui/packages/renderer-react/src/components/layout.tsx)）

| 组件 | 关键 props |
|---|---|
| `Column` / `Row` | `gap`（`small`/`medium`/`large`/数字px）、`padding`（同 gap）、`align`（`start`/`center`/`end`/`stretch`）。子节点走 `children`。 |
| `Divider` | `label`、`direction`（`horizontal`/`vertical`） |

### 7.2 文本（[typography.tsx](../packages/airui/packages/renderer-react/src/components/typography.tsx)）

| 组件 | 关键 props |
|---|---|
| `Text` | `value`（字符串，支持 `{state.xxx}`）、`style`（`title`/`subtitle`/`body`/`caption`/`placeholder`） |

### 7.3 基础表单（[form.tsx](../packages/airui/packages/renderer-react/src/components/form.tsx)）

| 组件 | 关键 props | 派发交互 |
|---|---|---|
| `Button` | `label`、`variant`（`primary`/其它）、`disabled` | `click`（`on.click`）+ interaction `click` |
| `Input` | `type`、`placeholder` | — |
| `Select` | `options:[{value,label}]`、`value`、`placeholder`、`disabled` | interaction `change:{value}` |
| `Switch` | `checked`、`label`、`disabled` | interaction `change:{checked}` |
| `Checkbox` | `checked`、`label`、`disabled` | interaction `change:{checked}` |
| `Radio` | `options`、`value`、`direction`、`disabled` | interaction `change:{value}` |
| `Slider` | `min`、`max`、`step`、`value`、`label`、`showValue`、`disabled` | interaction `change:{value}` |
| `Image` | `src`、`alt` | — |
| `Dropdown` | `options:[{value,label}]`、`selected` | `on.change`（`$event.value`） |

> 多数表单组件有**受控/非受控双模**：传了 `value`/`checked` props 走受控，否则内部 state 自管，变化通过 interaction `change` 上报。

### 7.4 数据展示（[data-display.tsx](../packages/airui/packages/renderer-react/src/components/data-display.tsx)）

| 组件 | 关键 props |
|---|---|
| `KPI` | `label`、`value`、`change`、`trend`（`up`/`down`，或由 `change` 前缀 `+/-` 推断） |
| `PlateCard` | `name`、`change`、`lead`、`flow`；点击派发 `drilldown:{name}` |
| `Gauge` | `value`、`max`、`label`、`unit`（≥80% danger，≥60% warning） |
| `Progress` | `value`、`max`、`label`、`showValue`、`variant`（`line`/`circle`） |
| `Tag` | `value`/`label`、`color`（`default`/`success`/`danger`/`warning`/`accent`）、`variant`（`filled`/`outline`） |
| `Badge` | `value`、`color`、`dot`、`max` |
| `Avatar` | `name`、`src`、`size` |
| `Skeleton` | `variant`（`text`/`circle`/`rect`）、`width`、`height`、`rows`、`count` |

### 7.5 表格（[data-table.tsx](../packages/airui/packages/renderer-react/src/components/data-table.tsx)）

| 组件 | 关键 props |
|---|---|
| `Table` | `columns:[{key,label,color?}]`、`data:[{...}]`（应用层别名 `rows`→`data`）。>50 行自动虚拟滚动；行点击派发 `drilldown:{row,index}`；`color:"signed"` 按 `+/-` 前缀着色 |
| `Pagination` | `total`、`pageSize`、`current`；派发 `change:{page,pageSize}` |

### 7.6 图表（[chart.tsx](../packages/airui/packages/renderer-react/src/components/chart.tsx)，基于 ECharts）

`Chart` props：`type` + `data`。`type ∈ bar|line|pie|candlestick|scatter|radar|heatmap|gauge`。`data` 形态因类型而异：

| type | data 形态 |
|---|---|
| `bar`/`line` | `{ labels:string[], values:number[] }` 或 `[{name,value}]` |
| `pie` | 同上（labels 作为扇区名） |
| `candlestick` | `{ dates:string[], ohlc:number[][] }` |
| `scatter` | `[{x,y,...}]` |
| `radar` | `{ indicators:[{name,max}], values:number[] }` |
| `heatmap` | `[{x,y,value}]` |
| `gauge` | `{ value, min, max, label }` |

点击元素派发 `drilldown`（散点带 `x,y,data`；K 线带 `date,data`；其它带 `category,value`）。

### 7.7 结构容器（[structure.tsx](../packages/airui/packages/renderer-react/src/components/structure.tsx)）

| 组件 | 关键 props |
|---|---|
| `Dashboard` | `columns`(默认3)、`gap`；子节点通过各自 `props.colSpan`/`rowSpan` 占格，可拖拽 resize 并派发 `resize:{colSpan,rowSpan}` |
| `Widget` | `title`、`loading`、`dataIntent.refreshInterval`(≥1000ms 触发周期 `refresh`)；容器外壳，渲染 `children` |
| `Accordion` | `items:[{key,title}]`、`active`、`single`；展开内容取 `children[idx]`，派发 `toggle` |
| `Timeline` | `items:[{key,title,description?,time?,color?}]`；派发 `click:{key,index}` |
| `Tree` | `data:[{key,label,children?}]`；派发 `click:{key}` |

### 7.8 其余类别（按源码为准）

下列组件的 props 以各源码文件为准（[components/](../packages/airui/packages/renderer-react/src/components/)）：

- **高级表单**：`Form`, `Textarea`, `DatePicker`, `TimePicker`, `DateRangePicker`, `NumberInput`, `Autocomplete`, `MultiSelect`, `FileUpload`（[advanced-form.tsx](../packages/airui/packages/renderer-react/src/components/advanced-form.tsx)）
- **媒体**：`Video`, `Audio`, `ImageGallery`, `Carousel`, `Lightbox`, `PDFViewer`（[media](../packages/airui/packages/renderer-react/src/components/)）
- **工作台**：`DataGrid`, `EmptyState`（[data-workbench.tsx](../packages/airui/packages/renderer-react/src/components/data-workbench.tsx)）
- **导航**：`Tabs`, `Breadcrumb`, `Steps`（[navigation.tsx](../packages/airui/packages/renderer-react/src/components/navigation.tsx)）
- **浮层**：`Modal`, `Drawer`, `DropdownMenu`（[overlay](../packages/airui/packages/renderer-react/src/components/)）
- **反馈**：`Alert`, `Loading`, `ErrorFallback`, `Tooltip`, `Toast`, `Notification`, `Popconfirm`, `ContextMenu`, `CommandPalette`（[feedback](../packages/airui/packages/renderer-react/src/components/)）
- **应用骨架**：`AppShell`, `Sidebar`, `TopNav`, `Toolbar`, `SplitPane`, `ScrollArea`（[app-shell.tsx](../packages/airui/packages/renderer-react/src/components/app-shell.tsx)）
- **内容**：`Markdown`, `CodeBlock`, `RichText`, `Icon`（[content.tsx](../packages/airui/packages/renderer-react/src/components/content.tsx)）
- **领域视图**：`Calendar`, `Kanban`, `Map`, `NetworkGraph`, `Heatmap`（[domain-views.tsx](../packages/airui/packages/renderer-react/src/components/domain-views.tsx)）

## 8. React 渲染 API

入口 [`index.ts`](../packages/airui/packages/renderer-react/src/index.ts) 导出：

### 8.1 状态

```ts
useAirUIStore: { doc, setDoc, applyPatch(patches) }  // zustand store
```

`applyPatch` 内部调 core 的 `applyPatches(doc, patches)`，不可变更新。

### 8.2 渲染

```tsx
<AirUIComponent comp={component} />   // 递归渲染，自动解析 props + 分派事件
```

### 8.3 交互回调（双向通信）

```tsx
import { InteractionProvider } from "@air-ui/renderer-react";

<InteractionProvider value={(widgetRef, interaction, payload) => {
  // 例：发回后端 agent
}}>
```

组件内部用 `useComponentEvents()` 的 `emit(interaction, payload)`，最终以 `(comp.ref, interaction, payload)` 回调到 Provider。`on.click` 的本地 action 仍由 `useEventHandler` 处理。

### 8.4 自定义组件

```tsx
import { registerComponent } from "@air-ui/renderer-react";

registerComponent("MyChart", ({ comp, resolvedProps }) => (
  <canvas data-chart={JSON.stringify(resolvedProps.data)} />
));
```

注册后 `type:"MyChart"` 优先匹配自定义渲染器（先于 `builtinMap`）。组件签名：`(props: { comp, resolvedProps }) => JSX`。

### 8.5 宿主函数（`call` 动作）

```tsx
import { registerHostFunction } from "@air-ui/renderer-react";
registerHostFunction("toast", (msg) => alert(msg));
```

事件 `{ action:"call", function:"toast", args:["hi"] }` 即触发。

### 8.6 Hooks

- `useEventHandler(handler)` → `(eventData?) => void`：执行 `on` 动作（mutate/set/emit/call）。
- `useComponentEvents(comp)` → `{ emit, fire }`：`emit` 走 InteractionProvider；`fire` 执行 `comp.on.click`。

### 8.7 校验

```ts
import { validateDocument } from "@air-ui/core";
const errors = validateDocument(doc); // [{ path, message }]
```

校验 `schema`、`viewport`、`state`、`root` 递归结构，以及各 action 的必填字段（见 [validator.ts](../packages/airui/packages/core/src/validator.ts)）。

## 9. 在 `apps/console` 中的集成

### 9.1 WebSocket 协议（[ws-client.ts](../apps/console/src/ws-client.ts)）

连接 `ws://.../ws/airui?session=<id>`，消息 JSON：

| 方向 | `type` | 载荷 | 处理 |
|---|---|---|---|
| 服务端→前端 | `document` | `data: AirUIDocument`, `title?` | `setDoc(data)`，更新 `document.title` |
| 服务端→前端 | `patch` | `data: Patch[]` | `applyPatch(data)` |
| 服务端→前端 | `session` | `sessionId` | 更新 sessionId |
| 前端→服务端 | `interaction` | `widgetRef, interaction, payload` | 由组件交互触发 |

### 9.2 Artifacts 渲染约定（[ConsoleView.tsx](../apps/console/src/components/ConsoleView.tsx)）

`apps/console` **不直接渲染 `doc.root`**，而是按约定提取「工件面板」：

1. 找 `root.children` 中 `ref === "row-artifacts"` 的 `Row`。
2. 其 `children` 每个视为一个面板，`ref` 作面板 id，`props.title` 作标题。
3. 若面板是 `Widget`，取其 `children[0]` 作为内容组件。
4. 内容经 `normalizeAirUIComponent` 归一化后用 `AirUIComponent` 渲染。

### 9.3 LLM 友好的归一化与别名（容错）

模型产出的 JSON 不必精确匹配类型名/字段名，[`ConsoleView` 的归一化层](../apps/console/src/components/ConsoleView.tsx) 会自动修正：

- **类型别名**：`card`/`panel`→`Widget`，`container`/`stack`/`vstack`→`Column`，`hstack`→`Row`，`paragraph`/`heading`/`title`→`Text`，`markdown`→`Markdown`，`code`→`CodeBlock`，`table`/`datatable`→`Table`，`datagrid`→`DataGrid`，`metric`/`stat`/`kpi`→`KPI`，`pdf`→`PDFViewer`，`empty`→`EmptyState`，`command`→`CommandPalette`，`number`→`NumberInput`，`upload`→`FileUpload`，`network`→`NetworkGraph` 等（完整表见源码 `componentAliases`）。
- **大小写/分隔符**：`app-shell`、`AppShell`、`appShell` 等价（`canonicalComponentTypes`）。
- **字段兜底**：`Table` 的 `rows`→`data`；`Text` 的 `text`/`content`/`label`→`value`；`KPI` 的 `count`→`value`。
- **无类型推断**：缺 `type` 时，有 `columns`+`data` 判为 `Table`，有 `value`/`count` 判为 `KPI`，否则 `Text`。
- **标量兜底**：裸字符串/数字/布尔包成 `Text`。

> 因此给模型写 prompt 时，**优先产出标准类型名与 props**，但即使写「顺手名」多数也能渲染。

### 9.4 交互回传链

组件 `emit("drilldown", {...})` → `InteractionProvider`（`ConsoleView` 注入的 `interactionHandler`）→ [`sendInteraction`](../apps/console/src/ws-client.ts) → WebSocket `{ type:"interaction", widgetRef, interaction, payload }` → 后端 agent → 产出新 `document` 或 `patch` 回流。

### 9.5 典型文档片段（Artifacts 风格）

```jsonc
{
  "schema": "air-ui@1",
  "viewport": { "width": 1024, "height": 720 },
  "state": { "region": "all", "sales": { "labels": ["Q1","Q2"], "values": [120,200] } },
  "root": {
    "type": "Column",
    "children": [
      { "ref": "row-artifacts", "type": "Row", "props": { "gap": "large" }, "children": [
        { "ref": "sales-chart", "type": "Widget", "props": { "title": "季度销售" }, "children": [
          { "type": "Chart", "props": { "type": "bar", "data": "@state.sales" } }
        ]},
        { "ref": "kpi-total", "type": "Widget", "props": { "title": "汇总" }, "children": [
          { "type": "KPI", "props": { "label": "总额", "value": "{state.sales.values.1}" } }
        ]}
      ]}
    ]
  }
}
```

> 注意 `@state.sales` 绑定整对象作为 `Chart` 的 `data`；`{state.sales.values.1}` 模板取数组下标。要更新数据，后端发 `[{ "op":"update-state", "stateDelta": { "sales": {...} } }]` 即可，无需重发结构。

## 10. 样式与主题

组件内联样式统一消费 `var(--air-*)` token；`--air-*` 在 [`theme.css`](../packages/airui/packages/renderer-react/src/theme.css) 中桥接 `var(--color-*)`。故覆盖 `--color-*` 即可让组件层与应用外壳同步换色。

内置主题、自定义重载（`localStorage["airui:custom-themes"]`）、新增主题清单等全部见 [`2026-06-09-theme-system.md`](./2026-06-09-theme-system.md)，此处不重复。

## 11. 开发者指南

| 需求 | 做法 |
|---|---|
| 改 light 默认配色 | 包内 `theme.css`（submodule，需在其仓库内 commit/push） |
| 新增/改内置组件 | `packages/airui/packages/renderer-react/src/components/*.tsx` + `index.ts` barrel + `engine.tsx` 的 `builtinMap` + core 的 `BUILTIN_COMPONENTS` |
| 运行期注入自定义组件（不改包） | `registerComponent(type, renderer)` |
| 暴露 `call` 能力 | `registerHostFunction(name, fn)` |
| 应用层新增特色主题 | 见主题文档 |
| 后端推送 UI | WebSocket 发 `document`（整树）或 `patch`（增量） |
| 监听组件交互 | `InteractionProvider` 回调，或 `window` 监听 `"air-ui-event"`（emit 动作） |

### 完整可运行示例

计数器：[`examples/counter.json`](../packages/airui/examples/counter.json)；看板：[`examples/dashboard.json`](../packages/airui/examples/dashboard.json)。Playground 见 [`packages/airui/playground/`](../packages/airui/playground/)。

## 12. 注意与边界

- **`design.md` 与实现的差异**：早期草案的部分概念（`when` 条件执行、`call` 的 navigate/toast 内置、`schema` 的 `viewport` 必填）以**当前代码**为准——`when` 仅标注不执行，`call` 需显式 `registerHostFunction`，组件集已扩至 70+。
- **`Loading` / `Widget` 特殊路径**：`engine` 对二者单独处理（`type==="Loading"`→骨架，`type==="Widget"`→外壳），其余走 `builtinMap`。
- **受控表单**：`Select`/`Switch`/`Slider` 等未传对应 value prop 时为非受控，状态在组件内部；要持久化到 `state`，请用 interaction 上报 + 后端回 patch。
- **Patch `replace`/`add`/`remove` 的 path** 指向文档节点（含 `/state/...`），`update-state` 只浅合并 `state`，不要用它替换深层结构。
- **submodule**：`packages/airui` 是独立 git 仓库，包内改动（`theme.css`/组件源码/`package.json`）须在 submodule 内提交；主仓库只跟踪指针。
