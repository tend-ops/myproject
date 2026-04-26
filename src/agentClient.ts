/**
 * AI Agent 客户端
 * 与Python AI Agent服务通信，获取智能代码审查结果
 */

import * as vscode from 'vscode';
import { RuleIssue, CodeIntermediateRepresentation } from './types';

// 使用 Node.js 内置的 fetch API
const fetch = globalThis.fetch;
const KNOWN_AGENT_PATHS = new Set(['/review', '/status', '/batch-review', '/fix', '/index-project']);

function getAgentBaseUrl(): string | null {
  const config = vscode.workspace.getConfiguration('smartCodeReview');
  const raw = (config.get<string>('agent.serverUrl', '') || '').trim();
  if (!raw) return null;

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
  } catch {
    return null;
  }
}

function buildAgentUrl(path: string): string | null {
  const base = getAgentBaseUrl();
  if (!base) return null;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * 调用AI Agent进行代码审查
 */
export async function requestAgentReview(
  document: vscode.TextDocument,
  _syntaxErrors: string[],
  _ruleIssues: RuleIssue[],
  _ir: CodeIntermediateRepresentation | null
): Promise<any> {
  const endpoint = buildAgentUrl('/review');
  if (!endpoint) return null;
  
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
  } catch (error) {
    console.error('AI Agent调用失败:', error);
    return null;
  }
}

/**
 * 检查AI Agent服务状态
 */
export async function checkAgentStatus(): Promise<boolean> {
  const endpoint = buildAgentUrl('/status');
  if (!endpoint) return false;
  
  try {
    const response = await fetch(endpoint);
    return response.ok;
  } catch (error) {
    console.error('AI Agent服务状态检查失败:', error);
    return false;
  }
}

/**
 * 批量审查多个文件
 */
export async function requestBatchReview(
  documents: vscode.TextDocument[]
): Promise<any> {
  const endpoint = buildAgentUrl('/batch-review');
  if (!endpoint) return null;
  
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
  } catch (error) {
    console.error('批量审查请求失败:', error);
    return null;
  }
}

/**
 * 请求Agent生成修复代码
 */
export async function requestAgentFix(
  document: vscode.TextDocument,
  issues: any[]
): Promise<any> {
  const endpoint = buildAgentUrl('/fix');
  if (!endpoint) return null;
  
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
  } catch (error) {
    console.error('AI Agent修复请求失败:', error);
    return null;
  }
}