/**
 * 侧边栏视图：按文件或问题类型展示分析结果，支持展示详细说明与示例代码。
 */

import * as vscode from 'vscode';
import { FileReviewResult, MergedReviewItem } from './types';
import { getLastReviewResult } from './reviewCoordinator';
import { getAllCachedResults } from './resultCache';

type TreeItem = FileItem | CategoryItem | IssueItem | PlaceholderItem;

class PlaceholderItem {
  constructor(public readonly label: string) {}
}

class FileItem {
  constructor(
    public readonly label: string,
    public readonly result: FileReviewResult,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {}
}

class CategoryItem {
  constructor(
    public readonly label: string,
    public readonly category: MergedReviewItem['category'],
    public readonly items: MergedReviewItem[],
    public readonly parent: FileItem
  ) {}
}

class IssueItem {
  constructor(
    public readonly item: MergedReviewItem,
    public readonly parent: CategoryItem
  ) {}
}

export class ReviewTreeDataProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private context: vscode.ExtensionContext) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    if (element instanceof FileItem) {
      const ti = new vscode.TreeItem(element.label, element.collapsibleState);
      ti.tooltip = element.result.filePath;
      ti.iconPath = new vscode.ThemeIcon('file-code');
      return ti;
    }
    if (element instanceof CategoryItem) {
      const ti = new vscode.TreeItem(
        `${element.label} (${element.items.length})`,
        vscode.TreeItemCollapsibleState.Expanded
      );
      ti.iconPath = new vscode.ThemeIcon('symbol-misc');
      return ti;
    }
    if (element instanceof IssueItem) {
      const ti = new vscode.TreeItem(
        element.item.line > 0
          ? `L${element.item.line}: ${element.item.message.slice(0, 60)}${element.item.message.length > 60 ? '...' : ''}`
          : element.item.message.slice(0, 80),
        vscode.TreeItemCollapsibleState.None
      );
      ti.tooltip = element.item.message + (element.item.exampleCode ? '\n\n示例:\n' + element.item.exampleCode : '');
      if (element.item.line > 0) {
        ti.command = {
          command: 'smartCodeReview.revealIssue',
          title: 'Go to Line',
          arguments: [element.item.line, element.item.column]
        };
      }
      if (element.item.severity === 'error') ti.iconPath = new vscode.ThemeIcon('error');
      else if (element.item.severity === 'warning') ti.iconPath = new vscode.ThemeIcon('warning');
      else ti.iconPath = new vscode.ThemeIcon('info');
      return ti;
    }
    if (element instanceof PlaceholderItem) {
      const ti = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      ti.iconPath = new vscode.ThemeIcon('info');
      ti.tooltip = '在编辑器中打开 .py / .js / .ts 等文件后，按 Ctrl+Shift+P 运行「Smart Code Review: 全流程审查」';
      return ti;
    }
    return new vscode.TreeItem('unknown');
  }

  getChildren(element?: TreeItem): TreeItem[] {
    if (!element) {
      const last = getLastReviewResult();
      const cached = getAllCachedResults(this.context);
      const toShow = last ? [last] : cached.slice(-5);
      if (toShow.length === 0) {
        return [
          new PlaceholderItem('请先打开 .py / .js / .ts 文件并运行「全流程审查」')
        ];
      }
      return toShow.map(
        r => new FileItem(r.filePath.split(/[/\\]/).pop() || r.filePath, r, vscode.TreeItemCollapsibleState.Expanded)
      );
    }
    if (element instanceof FileItem) {
      const items = element.result.mergedItems;
      if (items.length === 0) {
        const hintItem: MergedReviewItem = {
          id: 'hint',
          source: 'rule',
          category: 'style',
          message: '未检测到问题。若需规范检测：Python 请安装 pylint（pip install pylint）；JS/TS 请安装 eslint。',
          severity: 'info',
          line: 0,
          column: 0
        };
        return [
          new CategoryItem('提示（未发现问题）', 'style', [hintItem], element)
        ];
      }
      const categories: Array<{ label: string; category: MergedReviewItem['category'] }> = [
        { label: '语法', category: 'syntax' },
        { label: '规范/风格', category: 'style' },
        { label: '安全', category: 'security' },
        { label: '性能', category: 'performance' },
        { label: '重构', category: 'refactor' }
      ];
      return categories.map(
        ({ label, category }) =>
          new CategoryItem(
            label,
            category,
            items.filter(i => i.category === category),
            element
          )
      );
    }
    if (element instanceof CategoryItem) {
      return element.items.map(i => new IssueItem(i, element));
    }
    return [];
  }
}

export function registerSidebarView(context: vscode.ExtensionContext): void {
  const provider = new ReviewTreeDataProvider(context);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('smartCodeReviewView', provider)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('smartCodeReview.refreshReviewView', () => provider.refresh())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('smartCodeReview.revealIssue', (line: number, column: number) => {
      const editor = vscode.window.activeTextEditor;
      if (editor && line > 0) {
        const position = new vscode.Position(line - 1, Math.max(0, column));
        editor.revealRange(new vscode.Range(position, position));
        editor.selection = new vscode.Selection(position, position);
      }
    })
  );
}
