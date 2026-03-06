"use strict";
/**
 * 分析结果与数据管理：以轻量级 JSON 形式缓存审查结果，
 * 用于展示历史问题记录与侧边栏，便于回溯代码质量变化。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCachedResult = getCachedResult;
exports.setCachedResult = setCachedResult;
exports.getAllCachedResults = getAllCachedResults;
const CACHE_KEY = 'smartCodeReview.fileResults';
const MAX_CACHED_FILES = 50;
function getCachedResult(context, uri) {
    const stored = context.globalState.get(CACHE_KEY);
    if (!stored)
        return null;
    return stored[uri] || null;
}
function setCachedResult(context, result) {
    let stored = context.globalState.get(CACHE_KEY) || {};
    stored[result.uri] = result;
    const keys = Object.keys(stored);
    if (keys.length > MAX_CACHED_FILES) {
        const sorted = keys
            .map(k => ({ k, ts: stored[k].timestamp }))
            .sort((a, b) => a.ts - b.ts);
        for (let i = 0; i < sorted.length - MAX_CACHED_FILES; i++) {
            delete stored[sorted[i].k];
        }
    }
    context.globalState.update(CACHE_KEY, stored);
}
function getAllCachedResults(context) {
    const stored = context.globalState.get(CACHE_KEY);
    if (!stored)
        return [];
    return Object.values(stored);
}
//# sourceMappingURL=resultCache.js.map