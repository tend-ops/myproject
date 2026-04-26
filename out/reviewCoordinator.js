"use strict";
/**
 * 审查流程编排：统一调度代码解析、规则校验、模型智能分析，
 * 合并去重后写入 DiagnosticCollection、结果缓存与侧边栏数据源。
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
exports.diagnosticCollection = void 0;
exports.getLastReviewResult = getLastReviewResult;
exports.runRuleCheckOnly = runRuleCheckOnly;
exports.runSmartAnalysisOnly = runSmartAnalysisOnly;
exports.runFullReview = runFullReview;
const vscode = __importStar(require("vscode"));
const treeSitterService_1 = require("./treeSitterService");
const lintRunner_1 = require("./lintRunner");
const aiClient_1 = require("./aiClient");
const agentClient_1 = require("./agentClient");
const astExtract_1 = require("./astExtract");
const resultCache_1 = require("./resultCache");
const builtinRules_1 = require("./builtinRules");
const crypto = __importStar(require("crypto"));
const diagnosticCollection = vscode.languages.createDiagnosticCollection('smartCodeReview');
exports.diagnosticCollection = diagnosticCollection;
/** 当前审查结果，供侧边栏与 CodeAction 使用 */
let lastReviewResult = null;
function getLastReviewResult() {
    return lastReviewResult;
}
/**
 * 处理Agent结果并更新诊断信息
 */
async function handleAgentResult(document, context, agentResult, output) {
    if (!agentResult)
        return false;
    // 将 agentResult 中的 issues 转为 Diagnostics
    const diagnostics = [];
    for (const item of agentResult.issues) {
        if (item.line > 0) {
            const line = Math.max(0, item.line - 1);
            const range = new vscode.Range(line, 0, line, 256);
            const severity = item.severity === 'error' ? vscode.DiagnosticSeverity.Error
                : item.severity === 'warning' ? vscode.DiagnosticSeverity.Warning
                    : vscode.DiagnosticSeverity.Information;
            diagnostics.push(new vscode.Diagnostic(range, item.message, severity));
        }
    }
    diagnosticCollection.set(document.uri, diagnostics);
    // 构建FileReviewResult格式
    const result = {
        uri: document.uri.toString(),
        filePath: document.fileName,
        contentHash: '',
        timestamp: Date.now(),
        ir: null,
        ruleIssues: [],
        aiResult: null,
        mergedItems: agentResult.issues.map((issue) => ({
            id: `agent-${issue.category}-${issue.line}-${issue.message.slice(0, 30)}`,
            source: 'agent',
            category: issue.category,
            message: issue.message,
            severity: issue.severity,
            line: issue.line,
            column: 0
        }))
    };
    lastReviewResult = result;
    (0, resultCache_1.setCachedResult)(context, result);
    await vscode.commands.executeCommand('smartCodeReview.refreshReviewView');
    await vscode.commands.executeCommand('workbench.view.extension.smartCodeReview');
    if (output) {
        output.appendLine('=== Agent 审查完成 ===');
        if (agentResult.execution_time) {
            output.appendLine(`[Agent] 执行时间: ${agentResult.execution_time.total.toFixed(2)}ms`);
        }
        output.appendLine(`[Agent] 发现问题: ${agentResult.issues.length} 个`);
        if (agentResult.summary && agentResult.summary.by_category) {
            for (const category in agentResult.summary.by_category) {
                output.appendLine(`  ${category}: ${agentResult.summary.by_category[category]}`);
            }
        }
    }
    return true;
}
/**
 * 检查Agent状态并处理请求
 */
async function checkAndHandleAgent(document, context, output) {
    const agentUrl = vscode.workspace.getConfiguration('smartCodeReview.agent').get('serverUrl', '');
    if (!agentUrl)
        return false;
    if (output) {
        output.appendLine('[Agent] 使用 Review Agent 进行全流程审查...');
    }
    const agentStatus = await (0, agentClient_1.checkAgentStatus)();
    if (!agentStatus) {
        if (output) {
            output.appendLine('[Agent] 服务不可用，回退到本地逻辑');
        }
        return false;
    }
    const agentResult = await (0, agentClient_1.requestAgentReview)(document, [], [], null);
    if (!agentResult) {
        if (output) {
            output.appendLine('[Agent] 请求失败，回退到本地逻辑');
        }
        return false;
    }
    return await handleAgentResult(document, context, agentResult, output);
}
/** 将 Linter 的 RuleIssue 转为 MergedReviewItem（规范 vs 安全） */
function ruleIssuesToItems(ruleIssues) {
    return ruleIssues.map(r => {
        const category = r.message.includes('安全') || r.highRisk ? 'security'
            : r.message.includes('性能') ? 'performance'
                : 'style';
        return {
            id: `rule-${r.line}-${r.column}-${r.message.slice(0, 30)}`,
            source: 'rule',
            category,
            message: `[${r.tool}] ${r.message}`,
            severity: r.severity,
            line: r.line,
            column: r.column,
            code: r.code,
            tool: r.tool,
            hasQuickFix: ['unused-variable', 'no-unused-vars', 'C0116'].includes(String(r.code))
        };
    });
}
/** 合并五阶段结果 + AI，去重排序 */
function mergeAllStages(syntaxItems, styleItems, securityItems, performanceItems, refactorItems, aiResult) {
    const map = new Map();
    const add = (item) => {
        const key = item.id || `${item.category}-${item.line}-${item.message.slice(0, 30)}`;
        if (!map.has(key))
            map.set(key, item);
    };
    syntaxItems.forEach(add);
    styleItems.forEach(add);
    securityItems.forEach(add);
    performanceItems.forEach(add);
    refactorItems.forEach(add);
    if (aiResult) {
        aiResult.items.forEach((item, i) => {
            const key = `ai-${item.category}-${item.line ?? 0}-${item.description.slice(0, 40)}`;
            if (!map.has(key)) {
                map.set(key, {
                    id: `ai-${i}-${crypto.randomBytes(4).toString('hex')}`,
                    source: 'ai',
                    category: item.category,
                    message: item.description,
                    severity: item.category === 'security' ? 'error' : 'warning',
                    line: item.line ?? 0,
                    column: 0,
                    exampleCode: item.exampleCode,
                    hasQuickFix: false
                });
            }
        });
    }
    const config = vscode.workspace.getConfiguration('smartCodeReview.rules');
    const priorityMap = config.get('priority', {
        security: 100,
        performance: 80,
        refactor: 60,
        style: 40,
        syntax: 120
    });
    return Array.from(map.values()).sort((a, b) => {
        const priorityA = priorityMap[a.category] || 0;
        const priorityB = priorityMap[b.category] || 0;
        if (priorityB !== priorityA)
            return priorityB - priorityA;
        if (a.line !== b.line)
            return a.line - b.line;
        return a.column - b.column;
    });
}
/** 仅运行规则校验 + 诊断展示（可被 onDidChange 等触发，异步不阻塞） */
async function runRuleCheckOnly(document, context) {
    if (await checkAndHandleAgent(document, context)) {
        return { ruleIssues: [], ir: null };
    }
    const parseResult = treeSitterService_1.treeSitterService.parse(document);
    const ir = parseResult.ir;
    const syntaxErrors = parseResult.errors ?? [];
    const ruleIssues = await (0, lintRunner_1.runLinters)(document);
    // 调用内置规则
    const builtinSecurity = (0, builtinRules_1.runSecurityRules)(document);
    const performanceItems = (0, builtinRules_1.runPerformanceRules)(document);
    const refactorItems = (0, builtinRules_1.runRefactorRules)(document, ir);
    const diagnostics = [];
    for (const e of syntaxErrors) {
        diagnostics.push(new vscode.Diagnostic(new vscode.Range(0, 0, 0, 0), e, vscode.DiagnosticSeverity.Error));
    }
    for (const r of ruleIssues) {
        const line = Math.max(0, r.line - 1);
        const col = Math.max(0, r.column - 1);
        const range = new vscode.Range(line, col, r.endLine ? r.endLine - 1 : line, r.endColumn ?? col + 1);
        const severity = r.severity === 'error' ? vscode.DiagnosticSeverity.Error
            : r.severity === 'warning' ? vscode.DiagnosticSeverity.Warning
                : vscode.DiagnosticSeverity.Information;
        diagnostics.push(new vscode.Diagnostic(range, `[${r.tool}] ${r.message}` + (r.code ? ` (${r.code})` : ''), severity));
    }
    // 添加内置规则的诊断
    for (const item of [...builtinSecurity, ...performanceItems, ...refactorItems]) {
        if (item.line > 0) {
            const line = Math.max(0, item.line - 1);
            const range = new vscode.Range(line, 0, line, 256);
            const severity = item.severity === 'error' ? vscode.DiagnosticSeverity.Error
                : item.severity === 'warning' ? vscode.DiagnosticSeverity.Warning
                    : vscode.DiagnosticSeverity.Information;
            diagnostics.push(new vscode.Diagnostic(range, item.message, severity));
        }
    }
    diagnosticCollection.set(document.uri, diagnostics);
    const ruleItems = ruleIssuesToItems(ruleIssues);
    const syntaxItems = (parseResult.errors ?? []).map((e, i) => ({
        id: `syntax-${i}`,
        source: 'rule',
        category: 'syntax',
        message: e,
        severity: 'error',
        line: 0,
        column: 0
    }));
    const linterSecurityItems = ruleItems.filter(i => i.category === 'security');
    const securityItems = [...linterSecurityItems, ...builtinSecurity];
    const merged = mergeAllStages(syntaxItems, ruleItems.filter(i => i.category === 'style'), securityItems, performanceItems, refactorItems, null);
    const result = {
        uri: document.uri.toString(),
        filePath: document.fileName,
        contentHash: ir?.contentHash ?? '',
        timestamp: Date.now(),
        ir,
        ruleIssues,
        aiResult: null,
        mergedItems: merged
    };
    lastReviewResult = result;
    (0, resultCache_1.setCachedResult)(context, result);
    return { ruleIssues, ir };
}
/**
 * 智能分析：仅调用模型，输入为当前光标所在函数/片段 + 上下文。
 * 触发条件：用户点击「智能分析」或（可选）规则检测到高风险时。
 */
async function runSmartAnalysisOnly(document, context, options) {
    const output = vscode.window.createOutputChannel('Smart Code Review');
    output.show(true);
    output.appendLine('[智能分析] 正在准备输入（裁剪代码 + 上下文）...');
    if (await checkAndHandleAgent(document, context, output)) {
        output.appendLine('[智能分析] 由 Agent 完成');
        output.appendLine(`[智能分析] 发现 ${lastReviewResult?.mergedItems.length || 0} 个问题`);
        lastReviewResult?.mergedItems.forEach((issue) => output.appendLine(`  [${issue.category}] ${issue.message}`));
        return;
    }
    const code = document.getText();
    const parseResult = treeSitterService_1.treeSitterService.parse(document);
    const ir = parseResult.ir;
    const ruleIssues = await (0, lintRunner_1.runLinters)(document);
    const cursorLine = options?.cursorLine ?? vscode.window.activeTextEditor?.selection.active.line ?? 0;
    const codeSnippet = ir ? (0, astExtract_1.getCodeSnippetAtLine)(ir, document.getText(), cursorLine) : document.getText().slice(0, 8000);
    const contextSummary = ir
        ? `函数: ${ir.functions.map(f => f.name).join(', ')}; 变量: ${ir.variables.slice(0, 20).map(v => v.name).join(', ')}`
        : '';
    const aiResult = await (0, aiClient_1.requestAiReview)({
        languageId: document.languageId,
        filePath: document.fileName,
        codeSnippet,
        fullCode: code.length < 12000 ? code : undefined,
        syntaxFindings: parseResult.errors,
        lintIssues: ruleIssues,
        contextSummary
    });
    if (aiResult) {
        output.appendLine('[智能分析] 总结: ' + aiResult.summary);
        aiResult.items.forEach(i => output.appendLine(`  [${i.category}] ${i.description}`));
    }
    const syntaxItems = (parseResult.errors ?? []).map((e, i) => ({
        id: `syntax-${i}`,
        source: 'rule',
        category: 'syntax',
        message: e,
        severity: 'error',
        line: 0,
        column: 0
    }));
    const ruleItems = ruleIssuesToItems(ruleIssues);
    const merged = mergeAllStages(syntaxItems, ruleItems.filter(i => i.category === 'style'), ruleItems.filter(i => i.category === 'security'), [], [], aiResult);
    const result = {
        uri: document.uri.toString(),
        filePath: document.fileName,
        contentHash: ir?.contentHash ?? '',
        timestamp: Date.now(),
        ir,
        ruleIssues,
        aiResult,
        mergedItems: merged
    };
    lastReviewResult = result;
    (0, resultCache_1.setCachedResult)(context, result);
    // 自动刷新并打开侧边栏
    await vscode.commands.executeCommand('smartCodeReview.refreshReviewView');
    await vscode.commands.executeCommand('workbench.view.extension.smartCodeReview');
}
/**
 * 全流程审查：语法错误检测 → 代码规范校验 → 安全漏洞识别 → 性能优化建议 → 重构方案生成。
 * 内置规则保证安全/性能/重构在无 Linter、无 AI 时仍有输出；可选 CodeLlama 增强。
 */
async function runFullReview(document, context, options) {
    const output = vscode.window.createOutputChannel('Smart Code Review');
    output.clear();
    output.show(true);
    output.appendLine('=== Smart Code Review 全流程审查 ===');
    output.appendLine('流程：语法错误检测 → 代码规范校验 → 安全漏洞识别 → 性能优化建议 → 重构方案生成');
    output.appendLine('');
    if (await checkAndHandleAgent(document, context, output)) {
        return;
    }
    const code = document.getText();
    // ——— 阶段 1：语法错误检测（Tree-sitter） ———
    output.appendLine('[1/5] 语法错误检测（Tree-sitter 解析）...');
    const parseResult = treeSitterService_1.treeSitterService.parse(document);
    const ir = parseResult.ir;
    const syntaxErrors = parseResult.errors ?? [];
    const syntaxItems = syntaxErrors.map((e, i) => ({
        id: `syntax-${i}`,
        source: 'rule',
        category: 'syntax',
        message: e,
        severity: 'error',
        line: 0,
        column: 0
    }));
    if (syntaxErrors.length > 0) {
        output.appendLine(`  发现 ${syntaxErrors.length} 处语法错误`);
    }
    else {
        output.appendLine('  未发现语法错误');
    }
    // ——— 阶段 2：代码规范校验（Pylint/ESLint/Checkstyle） ———
    output.appendLine('[2/5] 代码规范校验（Pylint/ESLint/Checkstyle）...');
    const ruleIssues = await (0, lintRunner_1.runLinters)(document);
    const ruleItems = ruleIssuesToItems(ruleIssues);
    const styleItems = ruleItems.filter(i => i.category === 'style');
    const linterSecurityItems = ruleItems.filter(i => i.category === 'security');
    if (ruleIssues.length > 0) {
        output.appendLine(`  发现 ${ruleIssues.length} 条规范/风格问题`);
    }
    else {
        output.appendLine('  未发现规范问题（未安装 Linter 时也为空）');
    }
    // ——— 阶段 3：安全漏洞识别（内置规则 + Linter 高风险） ———
    output.appendLine('[3/5] 安全漏洞识别（内置规则 + Linter 高风险）...');
    const builtinSecurity = (0, builtinRules_1.runSecurityRules)(document);
    const securityItems = [...linterSecurityItems, ...builtinSecurity];
    if (securityItems.length > 0) {
        output.appendLine(`  发现 ${securityItems.length} 条安全相关建议`);
    }
    else {
        output.appendLine('  未发现安全风险');
    }
    // ——— 阶段 4：性能优化建议（内置规则） ———
    output.appendLine('[4/5] 性能优化建议（内置规则）...');
    const performanceItems = (0, builtinRules_1.runPerformanceRules)(document);
    if (performanceItems.length > 0) {
        output.appendLine(`  发现 ${performanceItems.length} 条性能优化建议`);
    }
    else {
        output.appendLine('  未发现性能建议');
    }
    // ——— 阶段 5：重构方案生成（内置规则） ———
    output.appendLine('[5/5] 重构方案生成（内置规则）...');
    const refactorItems = (0, builtinRules_1.runRefactorRules)(document, ir);
    if (refactorItems.length > 0) {
        output.appendLine(`  发现 ${refactorItems.length} 条重构建议`);
    }
    else {
        output.appendLine('  未发现重构建议');
    }
    // ——— 可选：CodeLlama 增强（安全/性能/重构） ———
    let aiResult = null;
    const config = vscode.workspace.getConfiguration('smartCodeReview');
    const autoTriggerAi = config.get('ai.autoTriggerOnHighRisk', false);
    const shouldCallAi = !options?.skipAi && (autoTriggerAi ? (0, lintRunner_1.hasHighRiskIssues)(ruleIssues) : true);
    if (shouldCallAi) {
        output.appendLine('');
        output.appendLine('[可选] 调用 CodeLlama 模型增强安全/性能/重构建议...');
        const cursorLine = vscode.window.activeTextEditor?.selection.active.line ?? 0;
        const codeSnippet = ir ? (0, astExtract_1.getCodeSnippetAtLine)(ir, code, cursorLine) : code.slice(0, 8000);
        const contextSummary = ir
            ? `函数: ${ir.functions.map(f => f.name).join(', ')}; 变量: ${ir.variables.slice(0, 20).map(v => v.name).join(', ')}`
            : '';
        aiResult = await (0, aiClient_1.requestAiReview)({
            languageId: document.languageId,
            filePath: document.fileName,
            codeSnippet,
            fullCode: code.length < 12000 ? code : undefined,
            syntaxFindings: syntaxErrors,
            lintIssues: ruleIssues,
            contextSummary
        });
        if (aiResult) {
            output.appendLine('  AI 返回: ' + aiResult.summary);
        }
        else {
            output.appendLine('  未配置或连接失败，已使用内置规则结果');
        }
    }
    const merged = mergeAllStages(syntaxItems, styleItems, securityItems, performanceItems, refactorItems, aiResult);
    // 诊断：语法 + 规范 + 内置安全/性能/重构（行号有效者）
    const diagnostics = [];
    for (const e of syntaxErrors) {
        diagnostics.push(new vscode.Diagnostic(new vscode.Range(0, 0, 0, 0), e, vscode.DiagnosticSeverity.Error));
    }
    for (const r of ruleIssues) {
        const line = Math.max(0, r.line - 1);
        const col = Math.max(0, r.column - 1);
        const range = new vscode.Range(line, col, r.endLine ? r.endLine - 1 : line, r.endColumn ?? col + 1);
        const severity = r.severity === 'error' ? vscode.DiagnosticSeverity.Error
            : r.severity === 'warning' ? vscode.DiagnosticSeverity.Warning
                : vscode.DiagnosticSeverity.Information;
        diagnostics.push(new vscode.Diagnostic(range, `[${r.tool}] ${r.message}` + (r.code ? ` (${r.code})` : ''), severity));
    }
    for (const item of [...securityItems, ...performanceItems, ...refactorItems]) {
        if (item.line > 0) {
            const line = Math.max(0, item.line - 1);
            const range = new vscode.Range(line, 0, line, 256);
            const severity = item.severity === 'error' ? vscode.DiagnosticSeverity.Error
                : item.severity === 'warning' ? vscode.DiagnosticSeverity.Warning
                    : vscode.DiagnosticSeverity.Information;
            diagnostics.push(new vscode.Diagnostic(range, item.message, severity));
        }
    }
    diagnosticCollection.set(document.uri, diagnostics);
    output.appendLine('');
    output.appendLine('--- 汇总 ---');
    output.appendLine(`语法: ${syntaxItems.length} | 规范: ${styleItems.length} | 安全: ${securityItems.length} | 性能: ${performanceItems.length} | 重构: ${refactorItems.length}`);
    if (aiResult) {
        output.appendLine('AI: ' + aiResult.items.length + ' 条补充建议');
    }
    output.appendLine('=== 审查完成 ===');
    const result = {
        uri: document.uri.toString(),
        filePath: document.fileName,
        contentHash: ir?.contentHash ?? '',
        timestamp: Date.now(),
        ir,
        ruleIssues,
        aiResult,
        mergedItems: merged
    };
    lastReviewResult = result;
    (0, resultCache_1.setCachedResult)(context, result);
    await vscode.commands.executeCommand('smartCodeReview.refreshReviewView');
    await vscode.commands.executeCommand('workbench.view.extension.smartCodeReview');
}
//# sourceMappingURL=reviewCoordinator.js.map