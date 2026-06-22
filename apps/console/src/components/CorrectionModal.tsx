import { type FC, useEffect, useId, useRef, useState } from "react";
import type { PanelAction } from "../store";
import { sendIntent, type Intent } from "../chat";
import {
  closeCorrection,
  subscribeCorrection,
  withCorrection,
  type CorrectionContext,
} from "../correction";

/**
 * 修正弹窗 —— 生成式 UI「预判不准」时的纠偏入口。
 * 见 docs/generative-ui-agent-design.md §5。
 *
 * 三类入口：
 *  1. 候选意图：同一面板的其他 actions 作为"我其实想…"的快捷选项；
 *  2. 自由输入：外行用户补一句（action=correct）；
 *  3. 结构化编辑：进阶用户直接改 action/target/params。
 *
 * 提交时把原预判作为 corrected_from 一并回传，后端记录偏差样本。
 */
const CorrectionModal: FC = () => {
  const [ctx, setCtx] = useState<CorrectionContext | null>(null);
  const [mode, setMode] = useState<"candidates" | "freeform" | "edit">("candidates");
  const [freeText, setFreeText] = useState("");
  const [editAction, setEditAction] = useState("custom");
  const [editTarget, setEditTarget] = useState("");
  const [editParams, setEditParams] = useState("{}");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => subscribeCorrection(setCtx), []);

  useEffect(() => {
    if (!ctx) return;
    setMode("candidates");
    setFreeText("");
    setEditAction(ctx.originalAction.intent?.action || "custom");
    setEditTarget(ctx.originalAction.intent?.target || ctx.artifactRef);
    setEditParams(
      JSON.stringify(ctx.originalAction.intent?.params || {}, null, 0),
    );
    triggerRef.current = document.activeElement as HTMLElement;
    document.body.style.overflow = "hidden";
    const id = setTimeout(() => inputRef.current?.focus(), 50);
    return () => {
      clearTimeout(id);
      document.body.style.overflow = "";
      triggerRef.current?.focus();
    };
  }, [ctx]);

  useEffect(() => {
    if (!ctx) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); closeCorrection(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ctx]);

  if (!ctx) return null;

  const submit = (actual: Intent) => {
    const enriched = withCorrection(actual, ctx.originalAction);
    void sendIntent(enriched, actual.label || actual.prompt || "");
    closeCorrection();
  };

  // 候选意图：同一面板的其他 actions（排除触发修正的那个）
  const candidates: PanelAction[] = ctx.siblingActions.filter(
    (a) => a !== ctx.originalAction && a.intent?.action && a.intent.action !== "correct",
  );

  const submitFreeform = () => {
    const text = freeText.trim();
    if (!text) return;
    submit({ action: "correct", target: ctx.artifactRef, prompt: text, label: text });
  };

  const submitEdit = () => {
    let params: Record<string, unknown> = {};
    try { params = JSON.parse(editParams); } catch { params = {}; }
    submit({ action: editAction || "custom", target: editTarget || ctx.artifactRef, params });
  };

  return (
    <div className="prompt-modal-overlay" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={closeCorrection}>
      <div className="prompt-modal" style={{ maxWidth: 460, position: "relative" }} onClick={(e) => e.stopPropagation()}>
        <div className="prompt-modal-title" id={titleId}>预判不准？告诉我你想要什么</div>
        <button onClick={closeCorrection} aria-label="关闭" style={{ position: "absolute", top: 14, right: 14, width: 28, height: 28, borderRadius: 8, border: "none", background: "var(--color-surface-muted)", color: "var(--color-muted)", cursor: "pointer", fontSize: 16, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        <div style={{ fontSize: 12, color: "var(--color-muted)", marginBottom: 12 }}>
          原预判：<strong>{ctx.originalAction.label}</strong>
          {ctx.originalAction.intent?.action ? ` · ${ctx.originalAction.intent.action}` : ""}
        </div>

        {/* 模式切换 */}
        <div style={{ display: "flex", gap: 4, marginBottom: 14, borderBottom: "1px solid var(--color-border)" }}>
          {([["candidates", "候选"], ["freeform", "输入"], ["edit", "编辑"]] as const).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                border: "none", background: "transparent",
                borderBottom: mode === m ? "2px solid var(--color-primary)" : "2px solid transparent",
                color: mode === m ? "var(--color-primary)" : "var(--color-muted)",
              }}
            >{label}</button>
          ))}
        </div>

        {mode === "candidates" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {candidates.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--color-muted)", padding: "8px 0" }}>
                没有其他候选，切换到「输入」补充你的需求。
              </div>
            )}
            {candidates.map((a, i) => (
              <button
                key={i}
                onClick={() => a.intent && submit(a.intent)}
                style={{
                  textAlign: "left", padding: "10px 12px", cursor: "pointer",
                  border: "1px solid var(--color-border)", borderRadius: "var(--radius-pill, 8px)",
                  background: "var(--color-surface)", color: "var(--color-text)",
                  fontSize: 13,
                }}
              >
                <span style={{ fontWeight: 600 }}>{a.label}</span>
                {a.intent?.action && (
                  <span style={{ color: "var(--color-muted)", marginLeft: 8, fontSize: 11 }}>
                    {a.intent.action}{a.intent.target ? ` · ${a.intent.target}` : ""}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {mode === "freeform" && (
          <>
            <textarea
              ref={inputRef}
              className="prompt-modal-input"
              style={{ minHeight: 72, resize: "vertical" }}
              placeholder="例如：我想看华东区的退货率，不是销售额"
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitFreeform(); } }}
            />
            <div className="prompt-modal-actions">
              <button className="prompt-modal-btn prompt-modal-btn-cancel" onClick={closeCorrection}>取消</button>
              <button className="prompt-modal-btn prompt-modal-btn-confirm" onClick={submitFreeform} disabled={!freeText.trim()}>发送</button>
            </div>
          </>
        )}

        {mode === "edit" && (
          <>
            <label style={{ fontSize: 12, color: "var(--color-muted)", display: "block", marginBottom: 4 }}>action</label>
            <input className="prompt-modal-input" value={editAction} onChange={(e) => setEditAction(e.target.value)} style={{ marginBottom: 10 }} />
            <label style={{ fontSize: 12, color: "var(--color-muted)", display: "block", marginBottom: 4 }}>target</label>
            <input className="prompt-modal-input" value={editTarget} onChange={(e) => setEditTarget(e.target.value)} style={{ marginBottom: 10 }} />
            <label style={{ fontSize: 12, color: "var(--color-muted)", display: "block", marginBottom: 4 }}>params (JSON)</label>
            <input className="prompt-modal-input" value={editParams} onChange={(e) => setEditParams(e.target.value)} style={{ marginBottom: 12, fontFamily: "monospace", fontSize: 12 }} />
            <div className="prompt-modal-actions">
              <button className="prompt-modal-btn prompt-modal-btn-cancel" onClick={closeCorrection}>取消</button>
              <button className="prompt-modal-btn prompt-modal-btn-confirm" onClick={submitEdit}>发送</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default CorrectionModal;
