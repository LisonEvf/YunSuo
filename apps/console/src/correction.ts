/**
 * 修正弹窗状态管理（module-level，类似 Toast 模式）。
 * 见 docs/generative-ui-agent-design.md §5「预判、修正与记忆」。
 *
 * 当 agent 的预判不准时，用户打开修正弹窗，三类入口：
 *  1. 候选意图（从同一面板的其他 actions 派生）
 *  2. 自由输入（外行用户补一句）
 *  3. 结构化编辑（进阶用户改 intent payload）
 *
 * 提交修正时，把"原预判（corrected_from）"连同实际意图一起回传后端，
 * agent loop 会记录偏差样本，下次预判更准。
 */
import type { PanelAction } from "./store";
import type { Intent } from "./chat";

export interface CorrectionContext {
  /** 触发修正的面板 ref（用于候选派生与上下文） */
  artifactRef: string;
  /** 用户原本点的、预判不准的那个 action（被修正的原预判） */
  originalAction: PanelAction;
  /** 同一面板的全部 actions，作为候选意图来源 */
  siblingActions: PanelAction[];
}

type CorrectionListener = (ctx: CorrectionContext | null) => void;

let current: CorrectionContext | null = null;
const listeners = new Set<CorrectionListener>();

function emit() {
  for (const fn of listeners) fn(current);
}

/** 打开修正弹窗。gallery 在 action 行的"修正"入口调用。 */
export function openCorrection(ctx: CorrectionContext): void {
  current = ctx;
  emit();
}

/** 关闭修正弹窗。 */
export function closeCorrection(): void {
  current = null;
  emit();
}

export function useCorrection(): CorrectionContext | null {
  // 响应式订阅由 CorrectionModal 组件用 useState + useEffect 完成。
  // 这里仅返回当前快照，供非响应式场景读取。
  return current;
}

export function subscribeCorrection(fn: CorrectionListener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * 把一个 PanelAction 转成可发送的 Intent。
 * 修正提交时调用：actualIntent 携带 corrected_from（原预判），让后端记录偏差。
 */
export function withCorrection(
  actualIntent: Intent,
  originalAction: PanelAction,
): Intent {
  const predicted = originalAction.intent
    ? { ...originalAction.intent }
    : { action: "unknown", target: "", label: originalAction.label, prompt: originalAction.prompt };
  return {
    ...actualIntent,
    params: {
      ...(actualIntent.params || {}),
      corrected_from: predicted,
    },
  };
}
