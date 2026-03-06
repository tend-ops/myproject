/**
 * 审查流程编排：统一调度代码解析、规则校验、模型智能分析，
 * 合并去重后写入 DiagnosticCollection、结果缓存与侧边栏数据源。
 */

import * as vscode from 'vscode';
import { treeSitterService } from './treeSitterService';
import { runLinters, hasHighRiskIssues } from './lintRunner';
import { requestAiReview } from './aiClient';
import { getCodeSnippetAtLine } from './astExtract';
import { setCachedResult } from './resultCache';
import { runSecurityRules, runPerformanceRules, runRefactorRules } from './builtinRules';
import {
  RuleIssue,
  FileReviewResult,
  MergedReviewItem,
  AiAnalysisResult,
  CodeIntermediateRepresentation
} from './types';
import * as crypto from 'crypto';

const diagnosticCollection = vscode.languages.createDiagnosticCollection('smartCodeReview');

/** 当前审查结果，供侧边栏与 CodeAction 使用 */
let lastReviewResult: FileReviewResult | null = null;

export function getLastReviewResult(): FileReviewResult | null {
  return lastReviewResult;
}

/** 将 Linter 的 RuleIssue 转为 MergedReviewItem（规范 vs 安全） */
function ruleIssuesToItems(ruleIssues: RuleIssue[]): MergedReviewItem[] {
  return ruleIssues.map(r => {
    const category =
      r.message.includes('安全') || r.highRisk ? 'security'
      : r.message.includes('性能') ? 'performance'
      : 'style';
    return {
      id: `rule-${r.line}-${r.column}-${r.message.slice(0, 30)}`,
      source: 'rule' as const,
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
function mergeAllStages(
  syntaxItems: MergedReviewItem[],
  styleItems: MergedReviewItem[],
  securityItems: MergedReviewItem[],
  performanceItems: MergedReviewItem[],
  refactorItems: MergedReviewItem[],
  aiResult: AiAnalysisResult | null
): MergedReviewItem[] {
  const map = new Map<string, MergedReviewItem>();
  const add = (item: MergedReviewItem) => {
    const key = item.id || `${item.category}-${item.line}-${item.message.slice(0, 30)}`;
    if (!map.has(key)) map.set(key, item);
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
  const priorityMap = config.get<Record<string, number>>('priority', {
    security: 100,
    performance: 80,
    refactor: 60,
    style: 40,
    syntax: 120
  });
  
  return Array.from(map.values()).sort((a, b) => {
    const priorityA = priorityMap[a.category] || 0;
    const priorityB = priorityMap[b.category] || 0;
    if (priorityB !== priorityA) return priorityB - priorityA;
    if (a.line !== b.line) return a.line - b.line;
    return a.column - b.column;
  });
}

/** 仅运行规则校验 + 诊断展示（可被 onDidChange 等触发，异步不阻塞） */
export async function runRuleCheckOnly(
  document: vscode.TextDocument,
  context: vscode.ExtensionContext
): Promise<{ ruleIssues: RuleIssue[]; ir: CodeIntermediateRepresentation | null }> {
  const parseResult = treeSitterService.parse(document);
  const ir = parseResult.ir;
  const syntaxErrors = parseResult.errors ?? [];
  const ruleIssues = await runLinters(document);

  // 调用内置规则
  const builtinSecurity = runSecurityRules(document);
  const performanceItems = runPerformanceRules(document);
  const refactorItems = runRefactorRules(document, ir);

  const diagnostics: vscode.Diagnostic[] = [];
  for (const e of syntaxErrors) {
    diagnostics.push(
      new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 0),
        e,
        vscode.DiagnosticSeverity.Error
      )
    );
  }
  for (const r of ruleIssues) {
    const line = Math.max(0, r.line - 1);
    const col = Math.max(0, r.column - 1);
    const range = new vscode.Range(line, col, r.endLine ? r.endLine - 1 : line, r.endColumn ?? col + 1);
    const severity = 
      r.severity === 'error' ? vscode.DiagnosticSeverity.Error
      : r.severity === 'warning' ? vscode.DiagnosticSeverity.Warning
      : vscode.DiagnosticSeverity.Information;
    diagnostics.push(
      new vscode.Diagnostic(range, `[${r.tool}] ${r.message}` + (r.code ? ` (${r.code})` : ''), severity)
    );
  }
  // 添加内置规则的诊断
  for (const item of [...builtinSecurity, ...performanceItems, ...refactorItems]) {
    if (item.line > 0) {
      const line = Math.max(0, item.line - 1);
      const range = new vscode.Range(line, 0, line, 256);
      const severity = 
        item.severity === 'error' ? vscode.DiagnosticSeverity.Error
        : item.severity === 'warning' ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Information;
      diagnostics.push(new vscode.Diagnostic(range, item.message, severity));
    }
  }
  diagnosticCollection.set(document.uri, diagnostics);

  const ruleItems = ruleIssuesToItems(ruleIssues);
  const syntaxItems: MergedReviewItem[] = (parseResult.errors ?? []).map((e, i) => ({
    id: `syntax-${i}`,
    source: 'rule' as const,
    category: 'syntax' as const,
    message: e,
    severity: 'error' as const,
    line: 0,
    column: 0
  }));
  
  const linterSecurityItems = ruleItems.filter(i => i.category === 'security');
  const securityItems = [...linterSecurityItems, ...builtinSecurity];
  
  const merged = mergeAllStages(
    syntaxItems,
    ruleItems.filter(i => i.category === 'style'),
    securityItems,
    performanceItems,
    refactorItems,
    null
  );
  const result: FileReviewResult = {
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
  setCachedResult(context, result);
  return { ruleIssues, ir };
}

/**
 * 智能分析：仅调用模型，输入为当前光标所在函数/片段 + 上下文。
 * 触发条件：用户点击「智能分析」或（可选）规则检测到高风险时。
 */
export async function runSmartAnalysisOnly(
  document: vscode.TextDocument,
  context: vscode.ExtensionContext,
  options?: { cursorLine?: number }
): Promise<void> {
  const output = vscode.window.createOutputChannel('Smart Code Review');
  output.show(true);
  output.appendLine('[智能分析] 正在准备输入（裁剪代码 + 上下文）...');

  const parseResult = treeSitterService.parse(document);
  const ir = parseResult.ir;
  const ruleIssues = await runLinters(document);
  const cursorLine = options?.cursorLine ?? vscode.window.activeTextEditor?.selection.active.line ?? 0;
  const code = document.getText();
  const codeSnippet = ir ? getCodeSnippetAtLine(ir, code, cursorLine) : code.slice(0, 8000);
  const contextSummary = ir
    ? `函数: ${ir.functions.map(f => f.name).join(', ')}; 变量: ${ir.variables.slice(0, 20).map(v => v.name).join(', ')}`
    : '';

  const aiResult = await requestAiReview({
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

  const syntaxItems: MergedReviewItem[] = (parseResult.errors ?? []).map((e, i) => ({
    id: `syntax-${i}`,
    source: 'rule' as const,
    category: 'syntax' as const,
    message: e,
    severity: 'error' as const,
    line: 0,
    column: 0
  }));
  const ruleItems = ruleIssuesToItems(ruleIssues);
  const merged = mergeAllStages(
    syntaxItems,
    ruleItems.filter(i => i.category === 'style'),
    ruleItems.filter(i => i.category === 'security'),
    [],
    [],
    aiResult
  );
  const result: FileReviewResult = {
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
  setCachedResult(context, result);
  // 自动刷新并打开侧边栏
  await vscode.commands.executeCommand('smartCodeReview.refreshReviewView');
  await vscode.commands.executeCommand('workbench.view.extension.smartCodeReview');
}

/**
 * 全流程审查：语法错误检测 → 代码规范校验 → 安全漏洞识别 → 性能优化建议 → 重构方案生成。
 * 内置规则保证安全/性能/重构在无 Linter、无 AI 时仍有输出；可选 CodeLlama 增强。
 */
export async function runFullReview(
  document: vscode.TextDocument,
  context: vscode.ExtensionContext,
  options?: { skipAi?: boolean }
): Promise<void> {
  const output = vscode.window.createOutputChannel('Smart Code Review');
  output.clear();
  output.show(true);
  output.appendLine('=== Smart Code Review 全流程审查 ===');
  output.appendLine('流程：语法错误检测 → 代码规范校验 → 安全漏洞识别 → 性能优化建议 → 重构方案生成');
  output.appendLine('');

  const code = document.getText();

  // ——— 阶段 1：语法错误检测（Tree-sitter） ———
  output.appendLine('[1/5] 语法错误检测（Tree-sitter 解析）...');
  const parseResult = treeSitterService.parse(document);
  const ir = parseResult.ir;
  const syntaxErrors = parseResult.errors ?? [];
  const syntaxItems: MergedReviewItem[] = syntaxErrors.map((e, i) => ({
    id: `syntax-${i}`,
    source: 'rule' as const,
    category: 'syntax' as const,
    message: e,
    severity: 'error' as const,
    line: 0,
    column: 0
  }));
  if (syntaxErrors.length > 0) {
    output.appendLine(`  发现 ${syntaxErrors.length} 处语法错误`);
  } else {
    output.appendLine('  未发现语法错误');
  }

  // ——— 阶段 2：代码规范校验（Pylint/ESLint/Checkstyle） ———
  output.appendLine('[2/5] 代码规范校验（Pylint/ESLint/Checkstyle）...');
  const ruleIssues = await runLinters(document);
  const ruleItems = ruleIssuesToItems(ruleIssues);
  const styleItems = ruleItems.filter(i => i.category === 'style');
  const linterSecurityItems = ruleItems.filter(i => i.category === 'security');
  if (ruleIssues.length > 0) {
    output.appendLine(`  发现 ${ruleIssues.length} 条规范/风格问题`);
  } else {
    output.appendLine('  未发现规范问题（未安装 Linter 时也为空）');
  }

  // ——— 阶段 3：安全漏洞识别（内置规则 + Linter 高风险） ———
  output.appendLine('[3/5] 安全漏洞识别（内置规则 + Linter 高风险）...');
  const builtinSecurity = runSecurityRules(document);
  const securityItems = [...linterSecurityItems, ...builtinSecurity];
  if (securityItems.length > 0) {
    output.appendLine(`  发现 ${securityItems.length} 条安全相关建议`);
  } else {
    output.appendLine('  未发现安全风险');
  }

  // ——— 阶段 4：性能优化建议（内置规则） ———
  output.appendLine('[4/5] 性能优化建议（内置规则）...');
  const performanceItems = runPerformanceRules(document);
  if (performanceItems.length > 0) {
    output.appendLine(`  发现 ${performanceItems.length} 条性能优化建议`);
  } else {
    output.appendLine('  未发现性能建议');
  }

  // ——— 阶段 5：重构方案生成（内置规则） ———
  output.appendLine('[5/5] 重构方案生成（内置规则）...');
  const refactorItems = runRefactorRules(document, ir);
  if (refactorItems.length > 0) {
    output.appendLine(`  发现 ${refactorItems.length} 条重构建议`);
  } else {
    output.appendLine('  未发现重构建议');
  }

  // ——— 可选：CodeLlama 增强（安全/性能/重构） ———
  let aiResult: AiAnalysisResult | null = null;
  const config = vscode.workspace.getConfiguration('smartCodeReview');
  const autoTriggerAi = config.get<boolean>('ai.autoTriggerOnHighRisk', false);
  const shouldCallAi = !options?.skipAi && (autoTriggerAi ? hasHighRiskIssues(ruleIssues) : true);
  if (shouldCallAi) {
    output.appendLine('');
    output.appendLine('[可选] 调用 CodeLlama 模型增强安全/性能/重构建议...');
    const cursorLine = vscode.window.activeTextEditor?.selection.active.line ?? 0;
    const codeSnippet = ir ? getCodeSnippetAtLine(ir, code, cursorLine) : code.slice(0, 8000);
    const contextSummary = ir
      ? `函数: ${ir.functions.map(f => f.name).join(', ')}; 变量: ${ir.variables.slice(0, 20).map(v => v.name).join(', ')}`
      : '';
    aiResult = await requestAiReview({
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
    } else {
      output.appendLine('  未配置或连接失败，已使用内置规则结果');
    }
  }

  const merged = mergeAllStages(
    syntaxItems,
    styleItems,
    securityItems,
    performanceItems,
    refactorItems,
    aiResult
  );

  // 诊断：语法 + 规范 + 内置安全/性能/重构（行号有效者）
  const diagnostics: vscode.Diagnostic[] = [];
  for (const e of syntaxErrors) {
    diagnostics.push(new vscode.Diagnostic(new vscode.Range(0, 0, 0, 0), e, vscode.DiagnosticSeverity.Error));
  }
  for (const r of ruleIssues) {
    const line = Math.max(0, r.line - 1);
    const col = Math.max(0, r.column - 1);
    const range = new vscode.Range(line, col, r.endLine ? r.endLine - 1 : line, r.endColumn ?? col + 1);
    const severity =
      r.severity === 'error' ? vscode.DiagnosticSeverity.Error
      : r.severity === 'warning' ? vscode.DiagnosticSeverity.Warning
      : vscode.DiagnosticSeverity.Information;
    diagnostics.push(
      new vscode.Diagnostic(range, `[${r.tool}] ${r.message}` + (r.code ? ` (${r.code})` : ''), severity)
    );
  }
  for (const item of [...securityItems, ...performanceItems, ...refactorItems]) {
    if (item.line > 0) {
      const line = Math.max(0, item.line - 1);
      const range = new vscode.Range(line, 0, line, 256);
      const severity =
        item.severity === 'error' ? vscode.DiagnosticSeverity.Error
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

  const result: FileReviewResult = {
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
  setCachedResult(context, result);
  await vscode.commands.executeCommand('smartCodeReview.refreshReviewView');
  await vscode.commands.executeCommand('workbench.view.extension.smartCodeReview');
}

export { diagnosticCollection };
