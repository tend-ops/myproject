"use strict";
/**
 * 智能代码审查与优化助手 - VS Code 插件入口
 * 事件驱动与模块解耦：监听文档打开/变更，注册命令与侧边栏，统一调度解析—规则—模型—结果展示。
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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const reviewCoordinator_1 = require("./reviewCoordinator");
const codeActionProvider_1 = require("./codeActionProvider");
const sidebarView_1 = require("./sidebarView");
const codeFixer_1 = require("./codeFixer");
const batchReviewManager_1 = require("./batchReviewManager");
const SUPPORTED_LANGUAGES = new Set([
    'python', 'javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'java'
]);
let ruleCheckDebounce = null;
const DEBOUNCE_MS = 800;
function shouldAnalyze(document) {
    if (document.uri.scheme !== 'file')
        return false;
    return SUPPORTED_LANGUAGES.has(document.languageId);
}
function doRuleCheck(document, context) {
    if (!shouldAnalyze(document))
        return;
    (0, reviewCoordinator_1.runRuleCheckOnly)(document, context).catch(err => {
        console.error('Smart Code Review rule check error', err);
    });
}
function activate(context) {
    // 命令：全流程审查（当前打开的文件）
    context.subscriptions.push(vscode.commands.registerCommand('smartCodeReview.runFullReview', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('请先打开要审查的文件，或使用「选择文件并全流程审查」从工作区选择。');
            return;
        }
        const doc = editor.document;
        if (!SUPPORTED_LANGUAGES.has(doc.languageId)) {
            vscode.window.showWarningMessage(`当前语言 ${doc.languageId} 暂不支持，支持: ${[...SUPPORTED_LANGUAGES].join(', ')}`);
            return;
        }
        await (0, reviewCoordinator_1.runFullReview)(doc, context);
    }));
    // 命令：选择 .py / .js / .ts 文件并全流程审查
    context.subscriptions.push(vscode.commands.registerCommand('smartCodeReview.pickFileAndReview', async () => {
        const uris = await vscode.window.showOpenDialog({
            title: '选择要审查的 Python、JavaScript 或 Java 文件',
            filters: {
                'Python': ['py'],
                'JavaScript/TypeScript': ['js', 'ts', 'jsx', 'tsx'],
                'Java': ['java'],
                '所有支持': ['py', 'js', 'ts', 'jsx', 'tsx', 'java']
            },
            canSelectMany: false,
            defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri
        });
        if (!uris || uris.length === 0)
            return;
        const uri = uris[0];
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc);
        const langId = doc.languageId;
        if (!SUPPORTED_LANGUAGES.has(langId)) {
            vscode.window.showWarningMessage(`该文件语言 ${langId} 将仅做部分检查。`);
        }
        await (0, reviewCoordinator_1.runFullReview)(doc, context);
    }));
    // 命令：根据最近一次审查结果生成修复后代码并展示（可与原文件对比）
    context.subscriptions.push(vscode.commands.registerCommand('smartCodeReview.generateFixedCode', async () => {
        const last = (0, reviewCoordinator_1.getLastReviewResult)();
        if (!last) {
            vscode.window.showWarningMessage('请先对当前文件执行「全流程审查」或「选择文件并全流程审查」。');
            return;
        }
        const editor = vscode.window.activeTextEditor;
        const originalText = editor?.document.uri.toString() === last.uri ? editor.document.getText() : undefined;
        const out = vscode.window.createOutputChannel('Smart Code Review');
        out.appendLine('正在生成修复后代码...');
        const fixResult = await (0, codeFixer_1.generateFixedCode)(last, originalText);
        out.appendLine('修复摘要: ' + fixResult.summary.join('; '));
        out.appendLine('共应用 ' + fixResult.appliedCount + ' 处修改建议。');
        const ext = (0, codeFixer_1.getExtension)(last);
        const langMap = {
            py: 'python',
            js: 'javascript',
            ts: 'typescript',
            jsx: 'javascriptreact',
            tsx: 'typescriptreact',
            java: 'java'
        };
        const baseName = last.filePath.replace(/[/\\]/g, '/').split('/').pop() || 'file';
        const fixedName = baseName.replace(/\.[^.]+$/, '') + '_fixed.' + (ext || 'txt');
        const newDoc = await vscode.workspace.openTextDocument({
            content: fixResult.fixedCode,
            language: langMap[ext] || 'plaintext'
        });
        let showedDiff = false;
        try {
            const origUri = vscode.Uri.file(last.filePath);
            await vscode.commands.executeCommand('vscode.diff', origUri, newDoc.uri, `原文件 ↔ ${fixedName}`);
            showedDiff = true;
        }
        catch {
            // 无法打开 diff 时仅展示修复后文档
        }
        if (!showedDiff) {
            await vscode.window.showTextDocument(newDoc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
        }
        vscode.window.showInformationMessage(`已生成修复后代码（${fixResult.appliedCount} 处建议）。${showedDiff ? '请查看对比视图。' : '新文档已在右侧打开，可另存为 ' + fixedName + '。'}`);
    }));
    // 命令：仅智能分析（模型分析，输入裁剪）
    context.subscriptions.push(vscode.commands.registerCommand('smartCodeReview.runSmartAnalysis', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('请先打开要分析的文件。');
            return;
        }
        const doc = editor.document;
        const cursorLine = editor.selection.active.line;
        await (0, reviewCoordinator_1.runSmartAnalysisOnly)(doc, context, { cursorLine });
    }));
    // 命令：显示审查面板（聚焦侧边栏）
    context.subscriptions.push(vscode.commands.registerCommand('smartCodeReview.showReviewPanel', () => {
        vscode.commands.executeCommand('smartCodeReview.refreshReviewView');
        vscode.commands.executeCommand('workbench.view.extension.smartCodeReviewView');
    }));
    // 命令：批量审查
    context.subscriptions.push(vscode.commands.registerCommand('smartCodeReview.runBatchReview', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('请打开一个工作区进行批量审查');
            return;
        }
        // 让用户选择文件类型
        const fileTypes = await vscode.window.showQuickPick(['Python (.py)', 'JavaScript/TypeScript (.js, .ts)', 'Java (.java)', '所有支持的文件'], { placeHolder: '选择要审查的文件类型' });
        if (!fileTypes)
            return;
        // 构建文件匹配模式
        let pattern;
        switch (fileTypes) {
            case 'Python (.py)':
                pattern = '**/*.py';
                break;
            case 'JavaScript/TypeScript (.js, .ts)':
                pattern = '**/*.{js,ts,jsx,tsx}';
                break;
            case 'Java (.java)':
                pattern = '**/*.java';
                break;
            default:
                pattern = '**/*.{py,js,ts,java,jsx,tsx}';
        }
        // 获取文件列表
        const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**|**/.git/**');
        if (files.length === 0) {
            vscode.window.showInformationMessage('未找到可审查的代码文件');
            return;
        }
        // 确认审查
        const confirm = await vscode.window.showInformationMessage(`将审查 ${files.length} 个文件，这可能需要一些时间。是否继续？`, '继续', '取消');
        if (confirm !== '继续')
            return;
        // 执行批量审查
        await (0, batchReviewManager_1.runBatchReview)(files, context);
    }));
    // 命令：索引项目
    context.subscriptions.push(vscode.commands.registerCommand('smartCodeReview.indexProject', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('请打开一个工作区进行索引');
            return;
        }
        const projectPath = workspaceFolders[0].uri.fsPath;
        await (0, batchReviewManager_1.indexProject)(projectPath);
    }));
    // 文档打开时：执行一次规则校验（异步）
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(doc => {
        if (shouldAnalyze(doc))
            doRuleCheck(doc, context);
    }));
    // 文档变更时：防抖后执行规则校验，避免频繁调用
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(ev => {
        if (!shouldAnalyze(ev.document))
            return;
        if (ruleCheckDebounce)
            clearTimeout(ruleCheckDebounce);
        ruleCheckDebounce = setTimeout(() => {
            ruleCheckDebounce = null;
            doRuleCheck(ev.document, context);
        }, DEBOUNCE_MS);
    }));
    // 已打开的文件在激活时也跑一次
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && shouldAnalyze(activeEditor.document)) {
        doRuleCheck(activeEditor.document, context);
    }
    (0, codeActionProvider_1.registerCodeActions)(context);
    (0, sidebarView_1.registerSidebarView)(context);
}
function deactivate() {
    if (ruleCheckDebounce)
        clearTimeout(ruleCheckDebounce);
}
//# sourceMappingURL=extension.js.map