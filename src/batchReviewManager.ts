import * as vscode from 'vscode';
import { runFullReview } from './reviewCoordinator';

/**
 * 批量审查管理器
 * 处理多文件并行审查的核心逻辑
 */
export async function runBatchReview(
  files: vscode.Uri[],
  context: vscode.ExtensionContext
): Promise<void> {
  const output = vscode.window.createOutputChannel('Smart Code Review');
  output.clear();
  output.show(true);
  output.appendLine('=== Smart Code Review 批量审查 ===');
  output.appendLine(`开始审查 ${files.length} 个文件...`);
  
  // 创建进度条
  const progressOptions: vscode.ProgressOptions = {
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
      if (token.isCancellationRequested) break;
      
      const reviewPromises = chunk.map(async (file) => {
        try {
          const document = await vscode.workspace.openTextDocument(file);
          await runFullReview(document, context, { skipAi: false });
          return { fileName: file.fsPath, success: true };
        } catch (error) {
          output.appendLine(`[错误] ${file.fsPath}: ${error}`);
          return { fileName: file.fsPath, success: false, error: error };
        } finally {
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
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * 索引项目到向量数据库
 */
export async function indexProject(projectPath: string): Promise<void> {
  const output = vscode.window.createOutputChannel('Smart Code Review');
  output.appendLine(`开始索引项目: ${projectPath}`);
  
  try {
    const config = vscode.workspace.getConfiguration('smartCodeReview');
    const agentServerUrl = config.get<string>('agent.serverUrl', 'http://localhost:8000');
    const indexUrl = `${agentServerUrl}/index-project`;
    
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
    
    const result = await response.json() as { message: string };
    output.appendLine(`索引完成: ${result.message}`);
    vscode.window.showInformationMessage(`项目索引完成: ${result.message}`);
  } catch (error) {
    output.appendLine(`索引失败: ${error}`);
    vscode.window.showErrorMessage(`项目索引失败: ${error}`);
  }
}
