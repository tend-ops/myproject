/**
 * 代码解析模块：Tree-sitter 语法解析，生成 AST 并提取统一中间表示（IR）。
 * 结合 parseCache 实现增量缓存，仅在内容变化时重新解析。
 * 若 tree-sitter 原生模块未安装或加载失败，则降级为仅返回空 IR，不阻塞规则与 AI 流程。
 */

import * as vscode from 'vscode';
import { CodeIntermediateRepresentation } from './types';
import { getCachedParse, setCachedParse } from './parseCache';

type SupportedLanguage = 'python' | 'javascript' | 'typescript' | 'java';

export interface ParseResult {
  ir: CodeIntermediateRepresentation | null;
  errors: string[];
}

let Parser: any = null;
let Python: any = null;
let JavaScript: any = null;
let Java: any = null;

function loadTreeSitter(): boolean {
  if (Parser !== null) return Parser !== undefined;
  try {
    Parser = require('tree-sitter');
    Python = require('tree-sitter-python');
    JavaScript = require('tree-sitter-javascript');
    Java = require('tree-sitter-java');
    return true;
  } catch {
    Parser = undefined as any;
    return false;
  }
}

class TreeSitterService {
  private parser: any = null;

  private ensureParser(): boolean {
    if (this.parser !== null) return this.parser !== undefined;
    if (!loadTreeSitter() || !Parser) return false;
    try {
      this.parser = new Parser();
      return true;
    } catch {
      this.parser = undefined;
      return false;
    }
  }

  private setLanguage(languageId: SupportedLanguage): boolean {
    if (!this.parser) return false;
    try {
      if (languageId === 'python' && Python) this.parser.setLanguage(Python);
      else if ((languageId === 'javascript' || languageId === 'typescript') && JavaScript) this.parser.setLanguage(JavaScript);
      else if (languageId === 'java' && Java) this.parser.setLanguage(Java);
      else return false;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 解析文档：优先使用缓存，否则解析并提取 IR（函数、变量、控制结构）。
   */
  // 简单的Python语法错误检测器（作为Tree-sitter的备用）
  private detectPythonSyntaxErrors(text: string): string[] {
    const errors: string[] = [];
    const lines = text.split(/\r?\n/);
    
    // 检查缩进
    // let indentLevel = 0;
    lines.forEach((line, lineNum) => {
      const trimmed = line.trim();
      if (trimmed === '') return;
      
      // 检查冒号
      if (trimmed.endsWith(':')) {
        // 函数定义、条件语句等需要冒号
      } else if (trimmed.startsWith('def ') || trimmed.startsWith('class ') || 
                 trimmed.startsWith('if ') || trimmed.startsWith('elif ') || 
                 trimmed.startsWith('else') || trimmed.startsWith('for ') || 
                 trimmed.startsWith('while ') || trimmed.startsWith('try') || 
                 trimmed.startsWith('except ') || trimmed.startsWith('finally')) {
        errors.push(`语法错误: 缺少冒号 @ (${lineNum + 1}, ${line.length})`);
      }
      
      // 检查字符串闭合
      let inSingleQuote = false;
      let inDoubleQuote = false;
      for (let i = 0; i < trimmed.length; i++) {
        const char = trimmed[i];
        if (char === '\'' && !inDoubleQuote) {
          inSingleQuote = !inSingleQuote;
        } else if (char === '"' && !inSingleQuote) {
          inDoubleQuote = !inDoubleQuote;
        }
      }
      if (inSingleQuote) {
        errors.push(`语法错误: 单引号未闭合 @ (${lineNum + 1}, ${trimmed.length})`);
      }
      if (inDoubleQuote) {
        errors.push(`语法错误: 双引号未闭合 @ (${lineNum + 1}, ${trimmed.length})`);
      }
      
      // 检查括号匹配
      const openParens = (trimmed.match(/\(/g) || []).length;
      const closeParens = (trimmed.match(/\)/g) || []).length;
      if (openParens > closeParens) {
        errors.push(`语法错误: 右括号缺失 @ (${lineNum + 1}, ${trimmed.length})`);
      }
      if (openParens < closeParens) {
        errors.push(`语法错误: 左括号缺失 @ (${lineNum + 1}, ${trimmed.length})`);
      }
      
      // 检查关键字拼写
      const keywords = ['while', 'def', 'class', 'if', 'elif', 'else', 'for', 'try', 'except', 'finally', 'import', 'from', 'global', 'nonlocal'];
      for (const keyword of keywords) {
        const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
        if (!regex.test(trimmed)) {
          // 检查常见拼写错误
          const commonMisspellings: Record<string, string> = {
            'whil': 'while',
            'func': 'def',
            'el': 'else',
            'iff': 'if'
          };
          for (const [misspelling, correct] of Object.entries(commonMisspellings)) {
            if (trimmed.includes(misspelling)) {
              errors.push(`语法错误: 关键字拼写错误，"${misspelling}" 应该是 "${correct}" @ (${lineNum + 1}, ${trimmed.indexOf(misspelling) + 1})`);
            }
          }
        }
      }
      
      // 检查赋值运算符
      if (trimmed.includes('==') && !trimmed.includes('if') && !trimmed.includes('elif') && !trimmed.includes('while') && !trimmed.includes('for')) {
        const parts = trimmed.split('==');
        if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
          errors.push(`语法错误: 赋值应该用 =，== 是比较运算符 @ (${lineNum + 1}, ${trimmed.indexOf('==') + 1})`);
        }
      }
    });
    
    return errors;
  }

  public parse(document: vscode.TextDocument): ParseResult {
    const config = vscode.workspace.getConfiguration('smartCodeReview');
    const enabled = config.get<boolean>('enableTreeSitter', true);
    if (!enabled) {
      // 如果禁用Tree-sitter，使用备用语法错误检测
      const text = document.getText();
      const errors = document.languageId === 'python' ? this.detectPythonSyntaxErrors(text) : [];
      return { ir: null, errors };
    }

    const languageId = document.languageId as SupportedLanguage;
    if (!['python', 'javascript', 'typescript', 'java'].includes(languageId)) {
      // 对不支持的语言，使用备用语法错误检测
      const text = document.getText();
      const errors = languageId === 'python' ? this.detectPythonSyntaxErrors(text) : [];
      return { ir: null, errors };
    }

    const text = document.getText();
    const uri = document.uri.toString();
    const cached = getCachedParse(uri, text);
    if (cached) return { ir: cached, errors: cached.errors };

    if (!this.ensureParser() || !this.setLanguage(languageId)) {
      // Tree-sitter初始化失败，使用备用语法错误检测
      const errors = languageId === 'python' ? this.detectPythonSyntaxErrors(text) : [];
      return { ir: null, errors };
    }

    try {
      const { extractIR } = require('./astExtract') as typeof import('./astExtract');
      const tree = this.parser.parse(text);
      const errors: string[] = [];
      function visit(node: any) {
        if (node.hasError()) {
          errors.push(`语法错误: ${node.type} @ (${node.startPosition.row + 1}, ${node.startPosition.column + 1})`);
        }
        for (let i = 0; i < node.childCount; i++) {
          const c = node.child(i);
          if (c) visit(c);
        }
      }
      visit(tree.rootNode);

      // 如果Tree-sitter没有检测到错误，使用备用检测器
      if (errors.length === 0 && languageId === 'python') {
        const backupErrors = this.detectPythonSyntaxErrors(text);
        errors.push(...backupErrors);
      }

      const ir = extractIR(languageId, document.fileName, text, tree);
      ir.errors = errors;
      setCachedParse(uri, text, ir);
      return { ir, errors };
    } catch (err) {
      console.error('Tree-sitter parse error', err);
      // 解析失败，使用备用语法错误检测
      const errors = languageId === 'python' ? this.detectPythonSyntaxErrors(text) : [];
      return { ir: null, errors };
    }
  }
}

export const treeSitterService = new TreeSitterService();
