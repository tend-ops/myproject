"use strict";
/**
 * 侧边栏视图：按文件或问题类型展示分析结果，支持展示详细说明与示例代码。
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
exports.ReviewTreeDataProvider = void 0;
exports.registerSidebarView = registerSidebarView;
const vscode = __importStar(require("vscode"));
const reviewCoordinator_1 = require("./reviewCoordinator");
const resultCache_1 = require("./resultCache");
class PlaceholderItem {
    constructor(label) {
        this.label = label;
    }
}
class FileItem {
    constructor(label, result, collapsibleState) {
        this.label = label;
        this.result = result;
        this.collapsibleState = collapsibleState;
    }
}
class CategoryItem {
    constructor(label, category, items, parent) {
        this.label = label;
        this.category = category;
        this.items = items;
        this.parent = parent;
    }
}
class IssueItem {
    constructor(item, parent) {
        this.item = item;
        this.parent = parent;
    }
}
class ReviewTreeDataProvider {
    constructor(context) {
        this.context = context;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        if (element instanceof FileItem) {
            const ti = new vscode.TreeItem(element.label, element.collapsibleState);
            ti.tooltip = element.result.filePath;
            ti.iconPath = new vscode.ThemeIcon('file-code');
            return ti;
        }
        if (element instanceof CategoryItem) {
            const ti = new vscode.TreeItem(`${element.label} (${element.items.length})`, vscode.TreeItemCollapsibleState.Expanded);
            ti.iconPath = new vscode.ThemeIcon('symbol-misc');
            return ti;
        }
        if (element instanceof IssueItem) {
            const ti = new vscode.TreeItem(element.item.line > 0
                ? `L${element.item.line}: ${element.item.message.slice(0, 60)}${element.item.message.length > 60 ? '...' : ''}`
                : element.item.message.slice(0, 80), vscode.TreeItemCollapsibleState.None);
            ti.tooltip = element.item.message + (element.item.exampleCode ? '\n\n示例:\n' + element.item.exampleCode : '');
            if (element.item.line > 0) {
                ti.command = {
                    command: 'smartCodeReview.revealIssue',
                    title: 'Go to Line',
                    arguments: [element.item.line, element.item.column]
                };
            }
            if (element.item.severity === 'error')
                ti.iconPath = new vscode.ThemeIcon('error');
            else if (element.item.severity === 'warning')
                ti.iconPath = new vscode.ThemeIcon('warning');
            else
                ti.iconPath = new vscode.ThemeIcon('info');
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
    getChildren(element) {
        if (!element) {
            const last = (0, reviewCoordinator_1.getLastReviewResult)();
            const cached = (0, resultCache_1.getAllCachedResults)(this.context);
            const toShow = last ? [last] : cached.slice(-5);
            if (toShow.length === 0) {
                return [
                    new PlaceholderItem('请先打开 .py / .js / .ts 文件并运行「全流程审查」')
                ];
            }
            return toShow.map(r => new FileItem(r.filePath.split(/[/\\]/).pop() || r.filePath, r, vscode.TreeItemCollapsibleState.Expanded));
        }
        if (element instanceof FileItem) {
            const items = element.result.mergedItems;
            if (items.length === 0) {
                const hintItem = {
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
            const categories = [
                { label: '语法', category: 'syntax' },
                { label: '规范/风格', category: 'style' },
                { label: '安全', category: 'security' },
                { label: '性能', category: 'performance' },
                { label: '重构', category: 'refactor' }
            ];
            return categories.map(({ label, category }) => new CategoryItem(label, category, items.filter(i => i.category === category), element));
        }
        if (element instanceof CategoryItem) {
            return element.items.map(i => new IssueItem(i, element));
        }
        return [];
    }
}
exports.ReviewTreeDataProvider = ReviewTreeDataProvider;
function registerSidebarView(context) {
    const provider = new ReviewTreeDataProvider(context);
    context.subscriptions.push(vscode.window.registerTreeDataProvider('smartCodeReviewView', provider));
    context.subscriptions.push(vscode.commands.registerCommand('smartCodeReview.refreshReviewView', () => provider.refresh()));
    context.subscriptions.push(vscode.commands.registerCommand('smartCodeReview.revealIssue', (line, column) => {
        const editor = vscode.window.activeTextEditor;
        if (editor && line > 0) {
            const position = new vscode.Position(line - 1, Math.max(0, column));
            editor.revealRange(new vscode.Range(position, position));
            editor.selection = new vscode.Selection(position, position);
        }
    }));
}
//# sourceMappingURL=sidebarView.js.map