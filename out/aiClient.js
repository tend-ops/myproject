"use strict";
/**
 * 模型智能分析模块：通过本地或远程 HTTP 调用 CodeLlama-7B-Instruct 等开源代码大模型。
 * 触发条件由上层控制；输入为裁剪后的代码片段 + 上下文（函数名、规则检测结果），
 * 对模型返回结果进行结构化解析。
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
exports.requestAiReview = requestAiReview;
const vscode = __importStar(require("vscode"));
const https = __importStar(require("https"));
const http = __importStar(require("http"));
/** 从模型返回的文本中尝试提取结构化建议（正则/关键词） */
function parseStructuredFromText(raw) {
    const items = [];
    const categories = [
        { key: '安全|security|漏洞|vulnerability', category: 'security' },
        { key: '性能|performance|优化|optimization', category: 'performance' },
        { key: '重构|refactor|拆分|抽取', category: 'refactor' },
        { key: '规范|style|命名|format', category: 'style' },
        { key: '语法|syntax|错误|error', category: 'syntax' }
    ];
    const lines = raw.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
        const t = line.replace(/^[\s\-*•]+/, '').trim();
        if (t.length < 4)
            continue;
        let category = 'style';
        for (const { key, category: cat } of categories) {
            if (new RegExp(key, 'i').test(t)) {
                category = cat;
                break;
            }
        }
        items.push({ category, description: t });
    }
    return items;
}
async function requestAiReview(input) {
    const config = vscode.workspace.getConfiguration('smartCodeReview.ai');
    const serverUrl = config.get('serverUrl', 'http://localhost:11434/api/generate');
    const apiKey = config.get('apiKey', '');
    console.log('AI Server URL:', serverUrl);
    try {
        const url = new URL(serverUrl);
        // 构建优化的提示词模板
        const prompt = `你是一个专业的代码审查助手，需要对以下代码进行全面分析：

语言: ${input.languageId}
文件路径: ${input.filePath}

${input.contextSummary ? `上下文信息: ${input.contextSummary}

` : ''}${input.syntaxFindings.length > 0 ? `语法错误: ${input.syntaxFindings.join('; ')}

` : ''}${input.lintIssues.length > 0 ? `规范问题: ${input.lintIssues.map(issue => `[${issue.tool}] ${issue.message}`).join('; ')}

` : ''}代码片段:
${input.languageId}
${input.codeSnippet}


请按照以下维度进行分析：
1. 安全漏洞识别：检测潜在的安全问题，如注入攻击、XSS、命令执行等
2. 性能优化建议：识别性能瓶颈，如循环效率、内存使用等
3. 重构方案生成：提出代码结构改进建议，如长函数拆分、重复代码提取等
4. 代码规范检查：确保代码符合最佳实践和编码规范

请提供详细的分析结果，包括问题位置、原因分析和改进建议。对于每个问题，请指明具体的行号（如果可能）和修复方案。`;
        // 构建 Ollama API 请求体
        const body = JSON.stringify({
            model: 'codellama:7b-instruct',
            prompt: prompt,
            stream: false,
            options: {
                max_tokens: config.get('maxTokens', 2048),
                temperature: 0.7,
                top_p: 0.95
            }
        });
        console.log('Request body:', body);
        const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };
        console.log('Request options:', options);
        if (apiKey) {
            options.headers['Authorization'] = `Bearer ${apiKey}`;
        }
        const client = url.protocol === 'https:' ? https : http;
        const result = await new Promise((resolve, reject) => {
            const req = client.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => resolve(data));
            });
            req.on('error', (err) => {
                console.error('Request error:', err);
                reject(err);
            });
            req.write(body);
            req.end();
        });
        console.log('Response result:', result);
        try {
            const parsed = JSON.parse(result);
            let summary = '无总结信息';
            let items = [];
            // 处理 Ollama 响应格式
            const text = parsed.response || '';
            summary = 'CodeLlama 分析完成';
            items = parseStructuredFromText(text);
            // 兜底处理：如果没有提取到任何信息，尝试从原始响应中解析
            if (items.length === 0) {
                if (parsed.raw) {
                    items = parseStructuredFromText(parsed.raw.slice(0, 2000));
                }
                else if (result) {
                    items = parseStructuredFromText(result.slice(0, 2000));
                }
            }
            return { summary, items, raw: result };
        }
        catch (parseError) {
            console.error('AI response parsing error', parseError);
            // 即使解析失败，也尝试从原始结果中提取信息
            const items = parseStructuredFromText(result.slice(0, 2000));
            return {
                summary: '解析模型响应时出错，但已尝试提取信息',
                items,
                raw: result
            };
        }
    }
    catch (err) {
        console.error('AI review request failed', err);
        vscode.window.showWarningMessage('调用 AI 审查服务失败，请检查 smartCodeReview.ai.serverUrl 及服务是否启动。');
        return null;
    }
}
//# sourceMappingURL=aiClient.js.map