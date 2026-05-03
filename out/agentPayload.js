"use strict";
/**
 * Agent HTTP 契约：扩展将 FastAPI 返回字段统一为 MergedReviewItem。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseAgentReviewResponse = parseAgentReviewResponse;
const AGENT_CATEGORIES = new Set(['syntax', 'style', 'security', 'performance', 'refactor']);
function normalizeAgentCategory(cat) {
    const s = String(cat || 'style').toLowerCase();
    return (AGENT_CATEGORIES.has(s) ? s : 'style');
}
function normalizeAgentSeverity(s) {
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
function parseAgentReviewResponse(agentResult) {
    const payload = agentResult;
    const raw = Array.isArray(payload?.mergedItems)
        ? payload.mergedItems
        : Array.isArray(payload?.issues)
            ? payload.issues
            : [];
    return raw.map((row, idx) => {
        const item = row;
        return {
            id: String(item?.id ?? `agent-${idx}-${item?.line ?? 0}`),
            source: item?.source === 'rule' ? 'rule' : 'ai',
            category: normalizeAgentCategory(item?.category),
            message: String(item?.message ?? ''),
            severity: normalizeAgentSeverity(item?.severity),
            line: Number(item?.line ?? 0) || 0,
            column: Number(item?.column ?? 0) || 0,
            code: item?.code,
            tool: item?.tool,
            exampleCode: item?.exampleCode,
            hasQuickFix: Boolean(item?.hasQuickFix)
        };
    });
}
//# sourceMappingURL=agentPayload.js.map