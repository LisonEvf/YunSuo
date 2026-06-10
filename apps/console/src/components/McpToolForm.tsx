import { useState } from "react";
import { useStore } from "../store";
import { sendChat } from "../chat";

/** MCP 工具参数表单浮层（toast 风格）：有 required 参数的工具点击后弹出。 */
export default function McpToolForm() {
  const form = useStore((s) => s.mcpToolForm);
  const setForm = useStore((s) => s.setMcpToolForm);
  const [values, setValues] = useState<Record<string, string>>({});

  if (!form) return null;

  const submit = () => {
    const args: Record<string, unknown> = {};
    for (const key of form.required) {
      const raw = values[key] ?? "";
      const propType = form.properties[key]?.type;
      if (propType === "number" || propType === "integer") {
        args[key] = Number(raw);
      } else if (propType === "boolean") {
        args[key] = raw === "true" || raw === "1";
      } else {
        args[key] = raw;
      }
    }
    void sendChat(`请调用工具 ${form.prefixedName}，参数：${JSON.stringify(args)}`);
    setForm(null);
    setValues({});
  };

  const cancel = () => {
    setForm(null);
    setValues({});
  };

  return (
    <div
      onClick={cancel}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 380, maxWidth: "90vw", background: "var(--color-surface)", borderRadius: 12, border: "1px solid var(--color-border)", boxShadow: "var(--air-shadow)", padding: 18, display: "flex", flexDirection: "column", gap: 12 }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text)" }}>{form.toolName}</div>
        <div style={{ fontSize: 11, color: "var(--color-muted)" }}>{form.prefixedName}</div>
        {form.required.map((key) => {
          const prop = form.properties[key];
          const label = `${key}${prop?.description ? ` — ${prop.description}` : ""}`;
          const t = prop?.type;
          return (
            <label key={key} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--color-text)" }}>
              {label}
              <input
                value={values[key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                placeholder={t === "boolean" ? "true / false" : (t ?? "string")}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--color-border-strong)", fontSize: 13, color: "var(--color-text)", background: "var(--color-surface)" }}
              />
            </label>
          );
        })}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
          <button onClick={cancel} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)", cursor: "pointer", fontSize: 12 }}>取消</button>
          <button onClick={submit} style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "var(--color-primary)", color: "var(--color-primary-text)", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>调用</button>
        </div>
      </div>
    </div>
  );
}
