"use strict";
/**
 * 优化与重构建议模块 - CodeAction 提供器：
 * 对部分简单问题（如未使用变量、格式类）提供「一键修复」或「插入注释忽略」等可执行修改。
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
exports.registerCodeActions = registerCodeActions;
const vscode = __importStar(require("vscode"));
const reviewCoordinator_1 = require("./reviewCoordinator");
function registerCodeActions(_context) {
    return vscode.languages.registerCodeActionsProvider([
        { language: 'python' },
        { language: 'javascript' },
        { language: 'typescript' }
    ], {
        provideCodeActions(document, range, codeActionContext) {
            const result = (0, reviewCoordinator_1.getLastReviewResult)();
            if (!result || result.uri !== document.uri.toString())
                return [];
            const actions = [];
            const line = range.start.line + 1;
            for (const item of result.mergedItems) {
                if (item.line !== line && item.line !== 0)
                    continue;
                if (!item.hasQuickFix)
                    continue;
                if (item.source === 'rule' && item.code) {
                    if (['no-unused-vars', 'unused-variable', 'W0612', 'C0116'].includes(item.code)) {
                        const isPython = document.languageId === 'python';
                        const fix = new vscode.CodeAction(isPython ? '忽略本行 (noqa)' : '忽略本行 (eslint-disable)', vscode.CodeActionKind.QuickFix);
                        fix.diagnostics = [...codeActionContext.diagnostics];
                        fix.edit = new vscode.WorkspaceEdit();
                        const lineText = document.lineAt(range.start.line).text;
                        const indent = lineText.match(/^\s*/)?.[0] ?? '';
                        if (isPython) {
                            fix.edit.insert(document.uri, new vscode.Position(range.start.line, 0), `${indent}# noqa: ${item.code}\n`);
                        }
                        else {
                            fix.edit.insert(document.uri, new vscode.Position(range.start.line, 0), `${indent}// eslint-disable-next-line ${item.code}\n`);
                        }
                        actions.push(fix);
                    }
                }
            }
            if (actions.length === 0 && codeActionContext.diagnostics.some((d) => d.source === 'smartCodeReview')) {
                const quickFix = new vscode.CodeAction('在侧边栏查看 Smart Code Review', vscode.CodeActionKind.Empty);
                quickFix.command = { command: 'smartCodeReview.refreshReviewView', title: 'Refresh' };
                quickFix.diagnostics = [...codeActionContext.diagnostics];
                actions.push(quickFix);
            }
            return actions;
        }
    }, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] });
}
//# sourceMappingURL=codeActionProvider.js.map