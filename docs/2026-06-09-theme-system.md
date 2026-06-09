# 主题系统与风格重载

> 本文档描述 `apps/console` 的主题架构、内置主题，以及通过 localStorage 自定义重载风格的标准。

## 概述

主题系统分三层，由底向上：

1. **light 基线** — 位于 airui 包内，开箱即用的默认配色。
2. **特色主题** — 位于应用层，包含 dark / graphite / neon / glass 四套预设。
3. **自定义重载** — 通过 localStorage JSON 在运行时覆盖 light / dark，无需改代码。

切换通过 `<html data-theme="...">` 属性驱动；`system` 主题在 JS 层解析为 `light` / `dark`。

## 架构

### Token 分层

- 包内组件（`packages/air-ui/renderer-react/src/components/*.tsx`）消费 `var(--air-*)`。
- 应用外壳（StatusBar / ConsoleView 等）消费 `var(--color-*)`。
- `--air-*` 桥接 `var(--color-*)`，故覆盖 `--color-*` 即可让组件层与应用层同步变化。

### 文件分布

| 层 | 位置 | 内容 |
|---|---|---|
| 包内默认 | `packages/air-ui/renderer-react/src/theme.css` | light 基线 token（`--color-*` 底层 + `--air-*` 桥接），经 `package.json` `exports["./theme.css"]` 暴露 |
| 应用特色 | `apps/console/src/styles.css` | dark / graphite / neon / glass + 全局排版（Sohne/Inter） |
| 自定义重载 | `localStorage["airui:custom-themes"]` | 运行时注入 `<style>` 覆盖 light / dark |

入口加载顺序见 [`apps/console/src/main.tsx`](../apps/console/src/main.tsx)：先 `@air-ui/renderer-react/theme.css`（基线），后 `./styles.css`（特色）。

> ⚠️ `packages/airui` 是 git submodule（`LisonEvf/AIRUI`）。包内改动（theme.css / package.json）需在 submodule 仓库内单独 commit / push，主仓库只记录指针变化。

## 内置主题

| 主题 | data-theme | 主色 / 背景 | 特征 |
|---|---|---|---|
| light | `light`（默认，无 data-theme） | `#635bff` / `#f6f9fc` | Stripe 风，Navy 文字，双层柔和阴影 |
| dark | `dark` | `#7a73ff` / `#06182e` | Navy 深调，紫提亮 |
| graphite | `graphite` | `#5352ed` / `#eceff3` | 浅冷灰 slate |
| neon | `neon` | `#00d9ff` / `#06070f` | 未来感，彩色 glow 阴影（全层级生效） |
| glass | `glass` | `#635bff` / 渐变 | 半透明 surface + 青→紫→粉渐变 + `backdrop-filter: blur(20px)` |
| system | `system` | — | 按 `prefers-color-scheme` 自动切 light / dark |

## 自定义主题标准（重载）

在 `localStorage` 写入 JSON 即可覆盖内置的 light / dark。支持明（light）、暗（dark）各一套，可只写 1 个或都写（2 个）。

### localStorage

- **key**：`airui:custom-themes`
- **value**：JSON 字符串，结构如下

```ts
interface CustomThemes {
  light?: { name?: string; tokens: ThemeTokens };
  dark?:  { name?: string; tokens: ThemeTokens };
}
```

### ThemeTokens 字段

全部可选，只覆盖填写的项。一个语义字段会同步设置其映射到的所有 CSS 变量（保持 `--color-*` 与 `--air-*` 一致）。

| 字段 | 映射的 CSS 变量 |
|---|---|
| `appBg` | `--color-app-bg` |
| `surface` | `--color-surface`, `--air-surface` |
| `surfaceMuted` | `--color-surface-muted`, `--air-surfaceAlt` |
| `border` | `--color-border`, `--air-border` |
| `borderStrong` | `--color-border-strong` |
| `text` | `--color-text`, `--air-text` |
| `muted` | `--color-muted`, `--air-textMuted` |
| `primary` | `--color-primary`, `--air-accent` |
| `primaryStrong` | `--color-primary-strong`, `--air-accentHover` |
| `primarySoft` | `--color-primary-soft`, `--air-accentSubtle` |
| `primaryText` | `--color-primary-text` |
| `danger` | `--color-danger`, `--air-danger` |
| `success` | `--color-success`, `--air-success` |
| `info` | `--color-info` |
| `warning` | `--air-warning` |
| `shadow` | `--shadow-panel`, `--air-shadow` |
| `shadowHover` | `--air-shadowHover` |

### 示例

仅重载明色（1 个）：

```js
localStorage.setItem("airui:custom-themes", JSON.stringify({
  light: { name: "暖橙", tokens: { primary: "#ff6b00", appBg: "#fff8f0" } }
}));
```

明暗都重载（2 个）：

```js
localStorage.setItem("airui:custom-themes", JSON.stringify({
  light: { tokens: { primary: "#635bff", surface: "#ffffff", danger: "#df1b41" } },
  dark:  { tokens: { primary: "#7a73ff", surface: "#0f2540" } }
}));
```

清除重载：

```js
localStorage.removeItem("airui:custom-themes");
```

## 生效机制

1. 应用启动时（[`App.tsx`](../apps/console/src/App.tsx)）调用 `loadCustomThemes()` 读取 JSON，`applyCustomThemes()` 注入一个 `<style id="airui-custom-themes">` 到 `<head>`。
2. 注入的 CSS 为 `:root{...}` 与 `:root[data-theme="dark"]{...}`，因出现在内置样式之后，优先级更高，完成覆盖。
3. 监听 `window` 的 `storage` 事件，跨标签页修改时自动重载。
4. 切到 light / dark / system 时即看到自定义效果。

实现见 [`apps/console/src/themes.ts`](../apps/console/src/themes.ts)。

## 边界与注意

- **作用范围**：仅覆盖 light / dark（含 system 解析出的二者）。neon / graphite / glass 不受影响。
- **字段可选**：`tokens` 中未填的字段保留内置值。
- **容错**：JSON 解析失败或 `tokens` 为空 → 静默移除覆盖，回退内置。
- **同标签页**：`storage` 事件不在同标签页触发，故同标签页写入后需刷新一次；跨标签页自动。
- **优先级**：依赖 `<style>` 在文档中的出现顺序（注入到 head 末尾，晚于内置样式）。若日后有更高优先级的样式冲突，可在注入 CSS 上加 `!important`（当前未加）。

## 开发者指南

| 需求 | 改动位置 |
|---|---|
| 改 light 默认配色 | 包内 `packages/air-ui/renderer-react/src/theme.css`（submodule） |
| 新增 / 修改特色主题 | `apps/console/src/styles.css` + `store.ts`（ThemeMode）+ `i18n.ts` + `ConsoleView.tsx`（select） |
| 运行时自定义（不改码） | localStorage `airui:custom-themes` |
| 暴露更多可重载 token | `themes.ts` 的 `ThemeTokens` 与 `TOKEN_TO_VARS` 映射 |

### 新增特色主题清单

1. `styles.css` 加 `:root[data-theme="<name>"] { ... }` 块。
2. `store.ts` 的 `ThemeMode` 联合类型加 `"<name>"`。
3. `i18n.ts` 两个语言块加 `<name>: "<显示名>"`。
4. `ConsoleView.tsx` 主题 `<select>` 加 `<option>`。
5.（可选）`ThemeSwitcher.tsx` 的 `THEMES` 数组加色块。

`App.tsx` 无需改 —— `theme === "system" ? ... : theme` 会自动透传新值为 `data-theme`。
