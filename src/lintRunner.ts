import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as path from 'path';
import { RuleIssue } from './types';

/** 视为高风险的规则码（可触发模型智能分析） */
const HIGH_RISK_PYLINT = new Set(['eval-used', 'exec-used', 'dangerous-default-value', 'W0123', 'W0122']);
const HIGH_RISK_ESLINT = new Set(['no-eval', 'no-implied-eval', 'security/detect-eval-with-expression', 'no-new-func']);

function runCommand(command: string, cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    exec(command, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ stdout: stdout || '', stderr: stderr || (error && error.message) || '' });
    });
  });
}

async function runPylint(document: vscode.TextDocument): Promise<RuleIssue[]> {
  const config = vscode.workspace.getConfiguration('smartCodeReview.lint');
  const enabled = config.get<boolean>('enablePylint', true);
  if (!enabled) return [];

  const pythonPath = config.get<string>('pythonPath', 'python');
  const pylintPath = config.get<string>('pylintPath', 'pylint');
  const filePath = document.fileName;
  const cwd = path.dirname(filePath);
  const cmd = `"${pythonPath}" -m "${pylintPath}" --output-format=json "${filePath}"`;
  const { stdout } = await runCommand(cmd, cwd);
  if (!stdout.trim()) return [];

  try {
    const parsed = JSON.parse(stdout) as any[];
    return parsed.map((item: any) => ({
      tool: 'pylint' as const,
      message: item.message,
      severity: item.type === 'error' ? 'error' : item.type === 'warning' ? 'warning' : 'info',
      line: item.line || 1,
      column: item.column || 1,
      code: item.symbol,
      highRisk: HIGH_RISK_PYLINT.has(String(item.symbol || item.message_id))
    }));
  } catch {
    return [];
  }
}

async function runEslint(document: vscode.TextDocument): Promise<RuleIssue[]> {
  const config = vscode.workspace.getConfiguration('smartCodeReview.lint');
  const enabled = config.get<boolean>('enableEslint', true);
  if (!enabled) return [];

  const eslintPath = config.get<string>('eslintPath', 'eslint');
  const filePath = document.fileName;
  const cwd = path.dirname(filePath);
  const cmd = `"${eslintPath}" -f json "${filePath}"`;
  const { stdout } = await runCommand(cmd, cwd);
  if (!stdout.trim()) return [];

  try {
    const parsed = JSON.parse(stdout) as any[];
    const fileResult = parsed[0];
    if (!fileResult || !Array.isArray(fileResult.messages)) return [];
    return fileResult.messages.map((m: any) => ({
      tool: 'eslint' as const,
      message: m.message,
      severity: m.severity === 2 ? 'error' : 'warning',
      line: m.line || 1,
      column: m.column || 1,
      endLine: m.endLine,
      endColumn: m.endColumn,
      code: m.ruleId,
      highRisk: m.ruleId && HIGH_RISK_ESLINT.has(m.ruleId)
    }));
  } catch {
    return [];
  }
}

/** Java：通过 Checkstyle 命令行进行规则校验 */
async function runCheckstyle(document: vscode.TextDocument): Promise<RuleIssue[]> {
  const config = vscode.workspace.getConfiguration('smartCodeReview.lint');
  const enabled = config.get<boolean>('enableCheckstyle', true);
  if (!enabled) return [];

  const checkstylePath = config.get<string>('checkstylePath', '');
  const checkstyleJar = config.get<string>('checkstyleJar', '');
  if (!checkstylePath && !checkstyleJar) return [];

  const filePath = document.fileName;
  const cwd = path.dirname(filePath);
  let cmd: string;
  if (checkstyleJar) {
    cmd = `java -jar "${checkstyleJar}" -f xml "${filePath}"`;
  } else {
    cmd = `"${checkstylePath}" -f xml "${filePath}"`;
  }
  const { stdout } = await runCommand(cmd, cwd);
  if (!stdout.trim() || stdout.includes('Exception')) return [];

  try {
    const issues: RuleIssue[] = [];
    const re = /<error\s+line="(\d+)"\s+column="(\d+)"\s+severity="(error|warning|info)"\s+message="([^"]+)"\s+source="([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stdout)) !== null) {
      issues.push({
        tool: 'checkstyle',
        message: m[4],
        severity: (m[3] as 'error' | 'warning' | 'info'),
        line: parseInt(m[1], 10),
        column: parseInt(m[2], 10),
        code: m[5] || undefined
      });
    }
    return issues;
  } catch {
    return [];
  }
}

export async function runLinters(document: vscode.TextDocument): Promise<RuleIssue[]> {
  const languageId = document.languageId;
  const issues: RuleIssue[] = [];

  if (languageId === 'python') {
    issues.push(...(await runPylint(document)));
  } else if (
    languageId === 'javascript' ||
    languageId === 'javascriptreact' ||
    languageId === 'typescript' ||
    languageId === 'typescriptreact'
  ) {
    issues.push(...(await runEslint(document)));
  } else if (languageId === 'java') {
    issues.push(...(await runCheckstyle(document)));
  }

  return issues;
}

/** 是否存在高风险问题（用于决定是否自动触发模型分析） */
export function hasHighRiskIssues(issues: RuleIssue[]): boolean {
  return issues.some(i => i.highRisk || i.severity === 'error');
}
