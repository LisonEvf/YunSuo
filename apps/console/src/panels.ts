/**
 * 面板与流程客户端 —— 后端 /api/panels & /api/flows 的封装。
 * 见 docs/generative-ui-agent-design.md §6。
 *
 * 面板 = 可复用起手屏：starter_prompt 让 agent 渲染首屏，种子意图预填默认参数，
 * 随后点击意图循环接管。流程 = 编排多个面板/提示的脚本路径。
 */
import type { Intent } from "./chat";

export interface Panel {
  id: number;
  name: string;
  description: string;
  starter_prompt: string;
  seed_intent?: Partial<Intent> & Record<string, unknown>;
  domain: string;
  tags: string[];
  is_builtin?: boolean;
  mcp_tools?: string[];
  created_at: string;
  updated_at: string;
}

export interface FlowStep {
  label: string;
  prompt?: string;
  panel_id?: number;
  mcp_tools?: string[];
}

export interface Flow {
  id: number;
  name: string;
  description: string;
  steps: FlowStep[];
  created_at: string;
  updated_at: string;
}

export async function listPanels(domain?: string): Promise<Panel[]> {
  const url = domain ? `/api/panels?domain=${encodeURIComponent(domain)}` : "/api/panels";
  const res = await fetch(url);
  if (!res.ok) return [];
  return (await res.json()).panels ?? [];
}

export async function createPanel(
  data: Pick<Panel, "name" | "starter_prompt"> & Partial<Panel>,
): Promise<Panel | null> {
  const res = await fetch("/api/panels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) return null;
  return (await res.json()).panel;
}

export async function deletePanel(id: number): Promise<boolean> {
  const res = await fetch(`/api/panels/${id}`, { method: "DELETE" });
  return res.ok;
}

export interface PanelRunResult {
  starter_prompt: string;
  seed_intent: Record<string, unknown>;
  mcp_tools: string[];
}

export async function runPanel(id: number): Promise<PanelRunResult | null> {
  const res = await fetch(`/api/panels/${id}/run`);
  if (!res.ok) return null;
  const body = await res.json();
  return {
    starter_prompt: body.starter_prompt,
    seed_intent: body.seed_intent || {},
    mcp_tools: body.mcp_tools || [],
  };
}

/** 运行流程：拿到有序步骤，前端依次走 sendChat 流式执行（一键流）。 */
export async function runFlow(id: number): Promise<{ steps: Array<{ index: number; label: string; prompt: string; panel_id?: number; mcp_tools?: string[] }> } | null> {
  const res = await fetch(`/api/flows/${id}/run`);
  if (!res.ok) return null;
  const body = await res.json();
  return { steps: body.steps ?? [] };
}

export async function listFlows(): Promise<Flow[]> {
  const res = await fetch("/api/flows");
  if (!res.ok) return [];
  return (await res.json()).flows ?? [];
}

export async function deleteFlow(id: number): Promise<boolean> {
  const res = await fetch(`/api/flows/${id}`, { method: "DELETE" });
  return res.ok;
}
