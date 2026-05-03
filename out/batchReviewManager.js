"use strict";
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
exports.runBatchReview = runBatchReview;
exports.indexProject = indexProject;
const vscode = __importStar(require("vscode"));
const reviewCoordinator_1 = require("./reviewCoordinator");
const agentClient_1 = require("./agentClient");
/**
 * 批量审查管理器
 * 处理多文件并行审查的核心逻辑
 */
async function runBatchReview(files, context) {
    const output = vscode.window.createOutputChannel('Smart Code Review');
    output.clear();
    output.show(true);
    output.appendLine('=== Smart Code Review 批量审查 ===');
    output.appendLine(`开始审查 ${files.length} 个文件...`);
    // 创建进度条
    const progressOptions = {
        location: vscode.ProgressLocation.Notification,
        title: 'Smart Code Review',
        cancellable: true
    };
    await vscode.window.withProgress(progressOptions, async (progress, token) => {
        let completed = 0;
        const total = files.length;
        // 并行处理文件，限制并发数
        const concurrencyLimit = 4;
        const fileChunks = chunkArray(files, concurrencyLimit);
        for (const chunk of fileChunks) {
            if (token.isCancellationRequested)
                break;
            const reviewPromises = chunk.map(async (file) => {
                try {
                    const document = await vscode.workspace.openTextDocument(file);
                    await (0, reviewCoordinator_1.runFullReview)(document, context, { skipAi: false });
                    return { fileName: file.fsPath, success: true };
                }
                catch (error) {
                    output.appendLine(`[错误] ${file.fsPath}: ${error}`);
                    return { fileName: file.fsPath, success: false, error: error };
                }
                finally {
                    completed++;
                    progress.report({
                        message: `审查中: ${completed}/${total}`,
                        increment: (100 / total)
                    });
                }
            });
            await Promise.all(reviewPromises);
        }
    });
    output.appendLine('\n=== 批量审查完成 ===');
    output.appendLine('所有文件审查已完成');
}
/**
 * 辅助函数：将数组分块
 */
function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}
/**
 * 索引项目到向量数据库
 */
async function indexProject(projectPath) {
    const output = vscode.window.createOutputChannel('Smart Code Review');
    output.appendLine(`开始索引项目: ${projectPath}`);
    try {
        const origin = (0, agentClient_1.getNormalizedAgentOrigin)();
        if (!origin) {
            vscode.window.showErrorMessage('请先在设置中配置 smartCodeReview.agent.serverUrl');
            return;
        }
        const indexUrl = `${origin}/index-project`;
        const response = await fetch(indexUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ project_path: projectPath })
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const result = await response.json();
        output.appendLine(`索引完成: ${result.message}`);
        vscode.window.showInformationMessage(`项目索引完成: ${result.message}`);
    }
    catch (error) {
        output.appendLine(`索引失败: ${error}`);
        vscode.window.showErrorMessage(`项目索引失败: ${error}`);
    }
}
//# sourceMappingURL=batchReviewManager.js.map