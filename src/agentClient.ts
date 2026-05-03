/**
 * AI Agent 客户端
 * 与Python AI Agent服务通信，获取智能代码审查结果
 */

import * as vscode from 'vscode';
import { RuleIssue, CodeIntermediateRepresentation } from './types';

const fetch = globalThis.fetch;
const KNOWN_AGENT_PATHS = new Set(['/review', '/status', '/batch-review', '/fix', '/index-project', '/ping', '/clear-index']);

function getAgentBaseUrl(): string | null {
  const config = vscode.workspace.getConfiguration('smartCodeReview');
  const raw = (config.get<string>('agent.serverUrl', '') || '').trim();
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    const normalizedPath = parsed.pathname.replace(/\/+$/, '');
    if (KNOWN_AGENT_PATHS.has(normalizedPath)) {
      parsed.pathname = '';
    }
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** 供索引等其它模块使用，与 buildAgentUrl 同源归一化 */
export function getNormalizedAgentOrigin(): string | null {
  return getAgentBaseUrl();
}

function buildAgentUrl(path: string): string | null {
  const base = getAgentBaseUrl();
  if (!base) return null;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/** 审查/修复等长请求超时；配置异常时回退 120s，并限制在 [5s, 10min] */
function getAgentLongTimeoutMs(): number {
  const c = vscode.workspace.getConfiguration('smartCodeReview');
  const raw = c.get<number>('agent.timeout', 120000);
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return 120000;
  }
  return Math.min(Math.max(raw, 5000), 600000);
}

async function fetchWithTimeout(endpoint: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(endpoint, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function requestAgentReview(
  document: vscode.TextDocument,
  _syntaxErrors: string[],
  _ruleIssues: RuleIssue[],
  _ir: CodeIntermediateRepresentation | null
): Promise<any> {
  const endpoint = buildAgentUrl('/review');
  if (!endpoint) return null;

  try {
    const response = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          languageId: document.languageId,
          filePath: document.fileName,
          code: document.getText()
        })
      },
      getAgentLongTimeoutMs()
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('AI Agent调用失败:', error);
    return null;
  }
}

export async function checkAgentStatus(): Promise<boolean> {
  const endpoint = buildAgentUrl('/status');
  if (!endpoint) return false;

  try {
    const response = await fetchWithTimeout(endpoint, { method: 'GET' }, 8000);
    return response.ok;
  } catch (error) {
    console.error('AI Agent服务状态检查失败:', error);
    return false;
  }
}

export async function requestBatchReview(documents: vscode.TextDocument[]): Promise<any> {
  const endpoint = buildAgentUrl('/batch-review');
  if (!endpoint) return null;

  try {
    const inputs = documents.map(doc => ({
      languageId: doc.languageId,
      filePath: doc.fileName,
      code: doc.getText()
    }));

    const response = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inputs)
      },
      getAgentLongTimeoutMs()
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('批量审查请求失败:', error);
    return null;
  }
}

export async function requestAgentFix(document: vscode.TextDocument, issues: any[]): Promise<any> {
  const endpoint = buildAgentUrl('/fix');
  if (!endpoint) return null;

  try {
    const response = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          languageId: document.languageId,
          filePath: document.fileName,
          code: document.getText(),
          issues
        })
      },
      getAgentLongTimeoutMs()
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('AI Agent修复请求失败:', error);
    return null;
  }
}
