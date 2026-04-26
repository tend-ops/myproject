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
exports.requestAgentReview = requestAgentReview;
exports.checkAgentStatus = checkAgentStatus;
exports.requestBatchReview = requestBatchReview;
exports.requestAgentFix = requestAgentFix;
const vscode = __importStar(require("vscode"));
// 使用 Node.js 内置的 fetch API
const fetch = globalThis.fetch;
const KNOWN_AGENT_PATHS = new Set(['/review', '/status', '/batch-review', '/fix', '/index-project']);
function getAgentBaseUrl() {
    const config = vscode.workspace.getConfiguration('smartCodeReview');
    const raw = (config.get('agent.serverUrl', '') || '').trim();
    if (!raw)
        return null;
    try {
        const parsed = new URL(raw);
        const normalizedPath = parsed.pathname.replace(/\/+$/, '');
        // 允许用户填写到具体接口，如 /review，内部统一回退到服务根路径。
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
function buildAgentUrl(path) {
    const base = getAgentBaseUrl();
    if (!base)
        return null;
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
/**
 * 调用AI Agent进行代码审查
 */
async function requestAgentReview(document, _syntaxErrors, _ruleIssues, _ir) {
    const endpoint = buildAgentUrl('/review');
    if (!endpoint)
        return null;
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                languageId: document.languageId,
                filePath: document.fileName,
                code: document.getText()
            })
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const result = await response.json();
        return result;
    }
    catch (error) {
        console.error('AI Agent调用失败:', error);
        return null;
    }
}
/**
 * 检查AI Agent服务状态
 */
async function checkAgentStatus() {
    const endpoint = buildAgentUrl('/status');
    if (!endpoint)
        return false;
    try {
        const response = await fetch(endpoint);
        return response.ok;
    }
    catch (error) {
        console.error('AI Agent服务状态检查失败:', error);
        return false;
    }
}
/**
 * 批量审查多个文件
 */
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
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(inputs)
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const result = await response.json();
        return result;
    }
    catch (error) {
        console.error('批量审查请求失败:', error);
        return null;
    }
}
/**
 * 请求Agent生成修复代码
 */
async function requestAgentFix(document, issues) {
    const endpoint = buildAgentUrl('/fix');
    if (!endpoint)
        return null;
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                languageId: document.languageId,
                filePath: document.fileName,
                code: document.getText(),
                issues: issues
            })
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const result = await response.json();
        return result;
    }
    catch (error) {
        console.error('AI Agent修复请求失败:', error);
        return null;
    }
}
//# sourceMappingURL=agentClient.js.map