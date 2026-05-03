/**
 * Agent HTTP 契约：扩展将 FastAPI 返回字段统一为 MergedReviewItem。
 */

import type { MergedReviewItem } from './types';

const AGENT_CATEGORIES = new Set(['syntax', 'style', 'security', 'performance', 'refactor']);

function normalizeAgentCategory(cat: unknown): MergedReviewItem['category'] {
  const s = String(cat || 'style').toLowerCase();
  return (AGENT_CATEGORIES.has(s) ? s : 'style') as MergedReviewItem['category'];
}

function normalizeAgentSeverity(s: unknown): MergedReviewItem['severity'] {
  const v = String(s || 'warning').toLowerCase();
  if (v === 'error' || v === 'info' || v === 'warning') {
    return v;
  }
  return 'warning';
}

/**
 * 将 /review 返回体规范为侧边栏可用的 mergedItems；
 * mergedItems 优先于旧字段 issues。
 */
export function parseAgentReviewResponse(agentResult: unknown): MergedReviewItem[] {
  const payload = agentResult as Record<string, unknown> | null | undefined;
  const raw: unknown[] = Array.isArray(payload?.mergedItems)
    ? (payload!.mergedItems as unknown[])
    : Array.isArray(payload?.issues)
      ? (payload!.issues as unknown[])
      : [];
  return raw.map((row, idx) => {
    const item = row as Record<string, unknown>;
    return {
      id: String(item?.id ?? `agent-${idx}-${item?.line ?? 0}`),
      source: item?.source === 'rule' ? 'rule' : 'ai',
      category: normalizeAgentCategory(item?.category),
      message: String(item?.message ?? ''),
      severity: normalizeAgentSeverity(item?.severity),
      line: Number(item?.line ?? 0) || 0,
      column: Number(item?.column ?? 0) || 0,
      code: item?.code as string | undefined,
      tool: item?.tool as string | undefined,
      exampleCode: item?.exampleCode as string | undefined,
      hasQuickFix: Boolean(item?.hasQuickFix)
    };
  });
}
