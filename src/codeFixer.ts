/**
 * 根据审查结果生成修复后的代码：Agent 首选；否则本地对常见安全风险与规范做保守改写。
 */

import * as vscode from 'vscode';
import { FileReviewResult, MergedReviewItem } from './types';
import { requestAgentFix, checkAgentStatus } from './agentClient';

export interface FixResult {
  fixedCode: string;
  summary: string[];
  appliedCount: number;
}

function fileProgrammingLang(fp: string): 'python' | 'javascript' | 'typescript' | 'java' {
  const l = fp.toLowerCase().replace(/\\/g, '/');
  if (l.endsWith('.py')) return 'python';
  if (l.endsWith('.java')) return 'java';
  if (l.endsWith('.ts') || l.endsWith('.tsx')) return 'typescript';
  return 'javascript';
}

/** 按行号分组的审查项 */
function groupByLine(items: MergedReviewItem[]): Map<number, MergedReviewItem[]> {
  const map = new Map<number, MergedReviewItem[]>();
  for (const item of items) {
    const line = item.line > 0 ? item.line : 1;
    if (!map.has(line)) map.set(line, []);
    map.get(line)!.push(item);
  }
  return map;
}

/**
 * 根据上次审查结果生成修复后代码。
 * originalText: 当前文件内容（若未传则从 result.filePath 读取）。
 */
export async function generateFixedCode(result: FileReviewResult, originalText?: string): Promise<FixResult> {
  let source = originalText;
  if (source === undefined) {
    try {
      const uri = vscode.Uri.file(result.filePath);
      const buf = await vscode.workspace.fs.readFile(uri);
      source = Buffer.from(buf).toString('utf-8');
    } catch {
      return { fixedCode: '', summary: ['无法读取原文件'], appliedCount: 0 };
    }
  }

  const agentStatus = await checkAgentStatus();
  if (agentStatus) {
    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(result.filePath));
      const issues = result.mergedItems.map(item => ({
        category: item.category,
        message: item.message,
        line: item.line,
        severity: item.severity
      }));

      const agentResult = await requestAgentFix(document, issues);
      if (agentResult && typeof agentResult.fixed_code === 'string' && agentResult.fixed_code.length > 0) {
        const meta = agentResult.fix_meta as
          | { validated?: boolean; deterministic_notes?: string[]; attempts?: unknown[] }
          | undefined;
        const summary: string[] = ['使用 AI Agent 生成修复代码'];
        if (meta?.validated) {
          summary.push('模型输出已通过长度/语法等校验');
        }
        if (meta?.deterministic_notes?.length) {
          summary.push('规则兜底: ' + meta.deterministic_notes.join('; '));
        }
        const appliedCount = meta?.validated
          ? result.mergedItems.length
          : Math.max(1, result.mergedItems.filter(i => i.category === 'security' || i.category === 'syntax').length);
        return {
          fixedCode: agentResult.fixed_code,
          summary,
          appliedCount
        };
      }
    } catch (error) {
      console.error('AI Agent修复失败:', error);
    }
  }

  const lines = source.split(/\r?\n/);
  const lang = fileProgrammingLang(result.filePath);
  const byLine = groupByLine(result.mergedItems);
  const summary: string[] = [];
  let appliedCount = 0;
  const needAstImport = { value: false };

  const fixLine = (lineText: string, lineNum: number): string => {
    const items = byLine.get(lineNum);
    if (!items || items.length === 0) return lineText;
    let out = lineText;
    for (const item of items) {
      if (item.exampleCode && item.line === lineNum) {
        out = item.exampleCode.trim();
        appliedCount++;
        summary.push(`L${lineNum}: 应用 AI 建议`);
        break;
      }
      if (item.category === 'security') {
        if (lang === 'python') {
          if (/\beval\s*\(/.test(out)) {
            out = out.replace(/\beval\s*\(/g, 'ast.literal_eval(');
            needAstImport.value = true;
            appliedCount++;
            summary.push(`L${lineNum}: eval → literal_eval`);
          }
          if (/\bexec\s*\(/.test(out) && !out.trim().startsWith('#')) {
            out = '# FIXME: 避免使用 exec\n' + out;
            appliedCount++;
            summary.push(`L${lineNum}: 已标注 exec 风险`);
          }
        }
        if (lang === 'javascript' || lang === 'typescript') {
          if (/\beval\s*\(/.test(out) && !out.trim().startsWith('//')) {
            out = '// FIXME: 避免使用 eval\n' + out;
            appliedCount++;
            summary.push(`L${lineNum}: 已标注 eval 风险`);
          }
          if (/\binnerHTML\s*=/.test(out) && !out.includes('sanitize') && !out.trim().startsWith('//')) {
            out = '// FIXME: innerHTML XSS 风险，请改用安全 API 或消毒\n' + out;
            appliedCount++;
            summary.push(`L${lineNum}: 已标注 innerHTML 风险`);
          }
        }
        if (lang === 'java') {
          const sqlDynamic =
            /(executeQuery|executeUpdate)\s*\(\s*"[^"]*"[^)]*\+/i.test(out) ||
            (/\+\s*\w+/.test(out) && /"(?:SELECT|INSERT|UPDATE|DELETE)/i.test(out));
          if (sqlDynamic && !out.includes('PreparedStatement')) {
            const indent = /^(\s*)/.exec(out)?.[1] ?? '';
            out = indent + '// FIXME: SQL 拼接注入风险 — 改用 PreparedStatement 绑定参数\n' + out;
            appliedCount++;
            summary.push(`L${lineNum}: 已标注 SQL 拼接风险`);
          }
        }
      }
      if (item.category === 'style' && item.hasQuickFix) {
        if (lang === 'python' && !out.trim().startsWith('#')) {
          out = out.replace(/(\s*)$/, '  # noqa: ' + (item.code || '') + '$1');
          appliedCount++;
          summary.push(`L${lineNum}: 添加 noqa`);
        }
        if ((lang === 'javascript' || lang === 'typescript') && !out.trim().startsWith('//')) {
          out = '// eslint-disable-next-line ' + (item.code || '') + '\n' + out;
          appliedCount++;
          summary.push(`L${lineNum}: 添加 eslint-disable-next-line`);
        }
        if (lang === 'java' && !out.trim().startsWith('//')) {
          out = '// CHECKSTYLE:OFF ' + (item.code || '') + '\n' + out;
          appliedCount++;
          summary.push(`L${lineNum}: 添加 CHECKSTYLE:OFF（请按需收敛）`);
        }
      }
    }
    return out;
  };

  const newLines = lines.map((line, i) => fixLine(line, i + 1));
  let fixedCode = newLines.join('\n');

  if (lang === 'python' && needAstImport.value && !fixedCode.includes('import ast')) {
    const firstImport = fixedCode.match(/^import\s+|^from\s+/m);
    fixedCode = firstImport ? 'import ast\n' + fixedCode : 'import ast\n\n' + fixedCode;
    appliedCount++;
    summary.push('已添加 import ast');
  }

  if (summary.length === 0) summary.push('未进行自动修改，请根据侧边栏建议手动修改');
  return { fixedCode, summary, appliedCount };
}

/** 取当前审查文件的扩展名以判断语言 */
export function getExtension(result: FileReviewResult): string {
  const m = result.filePath.match(/\.(py|js|ts|jsx|tsx|java)$/i);
  return m ? m[1].toLowerCase() : 'txt';
}
