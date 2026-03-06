/**
 * 优化与重构建议模块 - CodeAction 提供器：
 * 对部分简单问题（如未使用变量、格式类）提供「一键修复」或「插入注释忽略」等可执行修改。
 */

import * as vscode from 'vscode';
import { getLastReviewResult } from './reviewCoordinator';

export function registerCodeActions(_context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.languages.registerCodeActionsProvider(
    [
      { language: 'python' },
      { language: 'javascript' },
      { language: 'typescript' }
    ],
    {
      provideCodeActions(document, range, codeActionContext) {
        const result = getLastReviewResult();
        if (!result || result.uri !== document.uri.toString()) return [];

        const actions: vscode.CodeAction[] = [];
        const line = range.start.line + 1;

        for (const item of result.mergedItems) {
          if (item.line !== line && item.line !== 0) continue;
          if (!item.hasQuickFix) continue;

          if (item.source === 'rule' && item.code) {
            if (['no-unused-vars', 'unused-variable', 'W0612', 'C0116'].includes(item.code)) {
              const isPython = document.languageId === 'python';
              const fix = new vscode.CodeAction(
                isPython ? '忽略本行 (noqa)' : '忽略本行 (eslint-disable)',
                vscode.CodeActionKind.QuickFix
              );
              fix.diagnostics = [...codeActionContext.diagnostics];
              fix.edit = new vscode.WorkspaceEdit();
              const lineText = document.lineAt(range.start.line).text;
              const indent = lineText.match(/^\s*/)?.[0] ?? '';
              if (isPython) {
                fix.edit.insert(document.uri, new vscode.Position(range.start.line, 0), `${indent}# noqa: ${item.code}\n`);
              } else {
                fix.edit.insert(document.uri, new vscode.Position(range.start.line, 0), `${indent}// eslint-disable-next-line ${item.code}\n`);
              }
              actions.push(fix);
            }
          }
        }

        if (actions.length === 0 && codeActionContext.diagnostics.some((d: vscode.Diagnostic) => d.source === 'smartCodeReview')) {
          const quickFix = new vscode.CodeAction('在侧边栏查看 Smart Code Review', vscode.CodeActionKind.Empty);
          quickFix.command = { command: 'smartCodeReview.refreshReviewView', title: 'Refresh' };
          quickFix.diagnostics = [...codeActionContext.diagnostics];
          actions.push(quickFix);
        }

        return actions;
      }
    },
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
  );
}
