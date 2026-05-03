"use strict";
/**
 * AI Agent 客户端
 * 与Python AI Agent服务通信，获取智能代码审查结果
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNormalizedAgentOrigin = getNormalizedAgentOrigin;
exports.requestAgentReview = requestAgentReview;
exports.checkAgentStatus = checkAgentStatus;
exports.requestBatchReview = requestBatchReview;
exports.requestAgentFix = requestAgentFix;
const vscode = __importStar(require("vscode"));
const fetch = globalThis.fetch;
const KNOWN_AGENT_PATHS = new Set(['/review', '/status', '/batch-review', '/fix', '/index-project', '/ping', '/clear-index']);
function getAgentBaseUrl() {
    const config = vscode.workspace.getConfiguration('smartCodeReview');
    const raw = (config.get('agent.serverUrl', '') || '').trim();
    if (!raw)
        return null;
    try {
        const parsed = new URL(raw);
        const normalizedPath = parsed.pathname.replace(/\/+$/, '');
        if (KNOWN_AGENT_PATHS.has(normalizedPath)) {
            parsed.pathname = '';
        }
        parsed.search = '';
        parsed.hash = '';
        return parsed.toString().replace(/\/+$/, '');
    }
    catch {
        return null;
    }
}
/** 供索引等其它模块使用，与 buildAgentUrl 同源归一化 */
function getNormalizedAgentOrigin() {
    return getAgentBaseUrl();
}
function buildAgentUrl(path) {
    const base = getAgentBaseUrl();
    if (!base)
        return null;
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
/** 审查/修复等长请求超时；配置异常时回退 120s，并限制在 [5s, 10min] */
function getAgentLongTimeoutMs() {
    const c = vscode.workspace.getConfiguration('smartCodeReview');
    const raw = c.get('agent.timeout', 120000);
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return 120000;
    }
    return Math.min(Math.max(raw, 5000), 600000);
}
async function fetchWithTimeout(endpoint, init, timeoutMs) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
        return await fetch(endpoint, { ...init, signal: ctl.signal });
    }
    finally {
        clearTimeout(timer);
    }
}
async function requestAgentReview(document, _syntaxErrors, _ruleIssues, _ir) {
    const endpoint = buildAgentUrl('/review');
    if (!endpoint)
        return null;
    try {
        const response = await fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                languageId: document.languageId,
                filePath: document.fileName,
                code: document.getText()
            })
        }, getAgentLongTimeoutMs());
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    }
    catch (error) {
        console.error('AI Agent调用失败:', error);
        return null;
    }
}
async function checkAgentStatus() {
    const endpoint = buildAgentUrl('/status');
    if (!endpoint)
        return false;
    try {
        const response = await fetchWithTimeout(endpoint, { method: 'GET' }, 8000);
        return response.ok;
    }
    catch (error) {
        console.error('AI Agent服务状态检查失败:', error);
        return false;
    }
}
async function requestBatchReview(documents) {
    const endpoint = buildAgentUrl('/batch-review');
    if (!endpoint)
        return null;
    try {
        const inputs = documents.map(doc => ({
            languageId: doc.languageId,
            filePath: doc.fileName,
            code: doc.getText()
        }));
        const response = await fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(inputs)
        }, getAgentLongTimeoutMs());
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    }
    catch (error) {
        console.error('批量审查请求失败:', error);
        return null;
    }
}
async function requestAgentFix(document, issues) {
    const endpoint = buildAgentUrl('/fix');
    if (!endpoint)
        return null;
    try {
        const response = await fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                languageId: document.languageId,
                filePath: document.fileName,
                code: document.getText(),
                issues
            })
        }, getAgentLongTimeoutMs());
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    }
    catch (error) {
        console.error('AI Agent修复请求失败:', error);
        return null;
    }
}
//# sourceMappingURL=agentClient.js.map