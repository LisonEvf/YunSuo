/**
 * 自定义主题标准（localStorage JSON）
 * ────────────────────────────────────
 * 在 localStorage[CUSTOM_THEMES_KEY] 写入 JSON 即可重载内置 light/dark 主题。
 * 支持明(light)、暗(dark)各一套，可只写 1 个或都写(2 个)。仅作用于 light/dark（及 system 解析出的二者），不影响 neon/graphite/glass。
 *
 * 仅重载明色主色与背景：
 *   { "light": { "name": "我的明色", "tokens": { "primary": "#ff6b00", "appBg": "#fff8f0" } } }
 *
 * 明暗都重载：
 *   { "light": { "tokens": { "primary": "#635bff", "surface": "#ffffff" } },
 *     "dark":  { "tokens": { "primary": "#7a73ff", "surface": "#0f2540" } } }
 *
 * tokens 全部可选，只覆盖填写的项；字段见 ThemeTokens。
 * 生效时机：跨标签页自动（storage 事件）；同标签页刷新后生效。
 */

/** 可定制的设计 token（语义化命名；内部展开为对应的 --color-* / --air-* CSS 变量）。全部可选。 */
export interface ThemeTokens {
  appBg?: string;
  surface?: string;
  surfaceMuted?: string;
  border?: string;
  borderStrong?: string;
  text?: string;
  muted?: string;
  primary?: string;
  primaryStrong?: string;
  primarySoft?: string;
  primaryText?: string;
  danger?: string;
  success?: string;
  info?: string;
  warning?: string;
  shadow?: string;
  shadowHover?: string;
}

export interface CustomThemeEntry {
  name?: string;
  tokens: ThemeTokens;
}

/** localStorage 标准：可定义明/暗各一套自定义主题（0/1/2 个）。 */
export interface CustomThemes {
  light?: CustomThemeEntry;
  dark?: CustomThemeEntry;
}

export const CUSTOM_THEMES_KEY = "airui:custom-themes";
const STYLE_ELEMENT_ID = "airui-custom-themes";

/** 语义 token → CSS 变量（一个语义可同步多个变量，保持 --color-* 与 --air-* 一致）。 */
const TOKEN_TO_VARS: Record<keyof ThemeTokens, string[]> = {
  appBg: ["--color-app-bg"],
  surface: ["--color-surface", "--air-surface"],
  surfaceMuted: ["--color-surface-muted", "--air-surfaceAlt"],
  border: ["--color-border", "--air-border"],
  borderStrong: ["--color-border-strong"],
  text: ["--color-text", "--air-text"],
  muted: ["--color-muted", "--air-textMuted"],
  primary: ["--color-primary", "--air-accent"],
  primaryStrong: ["--color-primary-strong", "--air-accentHover"],
  primarySoft: ["--color-primary-soft", "--air-accentSubtle"],
  primaryText: ["--color-primary-text"],
  danger: ["--color-danger", "--air-danger"],
  success: ["--color-success", "--air-success"],
  info: ["--color-info"],
  warning: ["--air-warning"],
  shadow: ["--shadow-panel", "--air-shadow"],
  shadowHover: ["--air-shadowHover"],
};

function tokensToCss(tokens: ThemeTokens, selector: string): string {
  const decls: string[] = [];
  for (const [key, value] of Object.entries(tokens)) {
    const vars = TOKEN_TO_VARS[key as keyof ThemeTokens];
    if (!vars || value == null) continue;
    for (const v of vars) decls.push(`${v}: ${value};`);
  }
  if (!decls.length) return "";
  return `${selector}{${decls.join("")}}`;
}

function buildCustomCss(custom: CustomThemes): string {
  const blocks: string[] = [];
  if (custom.light) {
    const css = tokensToCss(custom.light.tokens, ":root");
    if (css) blocks.push(css);
  }
  if (custom.dark) {
    const css = tokensToCss(custom.dark.tokens, ':root[data-theme="dark"]');
    if (css) blocks.push(css);
  }
  return blocks.join("\n");
}

/** 读取 localStorage 的自定义主题；格式非法返回 null。 */
export function loadCustomThemes(): CustomThemes | null {
  try {
    const raw = localStorage.getItem(CUSTOM_THEMES_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as CustomThemes;
  } catch {
    return null;
  }
}

/** 把自定义主题注入为 <style>（覆盖内置 :root / dark）；传 null 则移除。 */
export function applyCustomThemes(custom: CustomThemes | null): void {
  let style = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  const css = custom ? buildCustomCss(custom) : "";
  if (!css) {
    style?.remove();
    return;
  }
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ELEMENT_ID;
    document.head.appendChild(style);
  }
  style.textContent = css;
}
