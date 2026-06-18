import { type FC } from "react";
import type { Component } from "@air-ui/core";
import MarkdownView from "../components/MarkdownView";

/**
 * Console-level AIRUI Markdown / CodeBlock renderers.
 *
 * The built-in AIRUI Markdown component only understands a few line prefixes
 * (headings, lists, quotes) and has no table/link/GFM support. These overrides
 * route through the shared MarkdownView (react-markdown + remark-gfm) so any
 * card that emits a Markdown/CodeBlock component renders exactly like chat:
 * tables, fenced code, lists, links, inline code -- all in the Morandi theme.
 *
 * Registered in registerConsoleComponents(); registration takes precedence over
 * the built-in renderers (see renderer-react engine AirUIComponent).
 */

/** Coerce the common content props to a markdown string. */
function readText(resolvedProps: Record<string, unknown>): string {
  const raw =
    resolvedProps.value ??
    resolvedProps.text ??
    resolvedProps.content ??
    resolvedProps.source;
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  try {
    return JSON.stringify(raw, null, 2);
  } catch {
    return String(raw);
  }
}

// Reuse the shared markdown root ("chat-md") so every .md-* rule applies, then
// add the card scope ("airui-card-md") for any card-specific typographic tweak.
const ROOT = "chat-md airui-card-md";

export const MarkdownCard: FC<{
  comp: Component;
  resolvedProps: Record<string, unknown>;
}> = ({ resolvedProps }) => {
  const content = readText(resolvedProps);
  if (!content.trim()) return null;
  return <MarkdownView content={content} className={ROOT} />;
};

export const CodeBlockCard: FC<{
  comp: Component;
  resolvedProps: Record<string, unknown>;
}> = ({ resolvedProps }) => {
  const code = readText(resolvedProps);
  if (!code.trim()) return null;
  const language =
    typeof resolvedProps.language === "string"
      ? resolvedProps.language.trim()
      : undefined;
  return (
    <div className={ROOT}>
      <pre className="md-pre">
        {language && <div className="md-code-lang">{language}</div>}
        <code className="md-code-block">{code}</code>
      </pre>
    </div>
  );
};
