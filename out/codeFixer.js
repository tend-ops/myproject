"use strict";
/**
 * 根据审查结果生成修复后的代码：对安全、部分规范问题做自动修复建议，
 * 并在有 exampleCode 时采用 AI 建议，输出完整「修复后」源码供对比或保存。
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
exports.generateFixedCode = generateFixedCode;
exports.getExtension = getExtension;
const vscode = __importStar(require("vscode"));
/** 按行号分组的审查项 */
function groupByLine(items) {
    const map = new Map();
    for (const item of items) {
        const line = item.line > 0 ? item.line : 1;
        if (!map.has(line))
            map.set(line, []);
        map.get(line).push(item);
    }
    return map;
}
/**
 * 根据上次审查结果生成修复后代码。
 * originalText: 当前文件内容（若未传则从 result.filePath 读取）。
 */
async function generateFixedCode(result, originalText) {
    let source = originalText;
    if (source === undefined) {
        try {
            const uri = vscode.Uri.file(result.filePath);
            const buf = await vscode.workspace.fs.readFile(uri);
            source = Buffer.from(buf).toString('utf-8');
        }
        catch {
            return { fixedCode: '', summary: ['无法读取原文件'], appliedCount: 0 };
        }
    }
    const lines = source.split(/\r?\n/);
    const lang = result.filePath.endsWith('.py') ? 'python' : 'javascript';
    const byLine = groupByLine(result.mergedItems);
    const summary = [];
    let appliedCount = 0;
    const needAstImport = { value: false };
    const fixLine = (lineText, lineNum) => {
        const items = byLine.get(lineNum);
        if (!items || items.length === 0)
            return lineText;
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
                        summary.push(`L${lineNum}: eval → ast.literal_eval`);
                    }
                    if (/\bexec\s*\(/.test(out) && !out.trim().startsWith('#')) {
                        out = '# FIXME: 避免使用 exec\n' + out;
                        appliedCount++;
                        summary.push(`L${lineNum}: 已标注 exec 风险`);
                    }
                }
                if (lang === 'javascript' || result.filePath.endsWith('.ts')) {
                    if (/\beval\s*\(/.test(out) && !out.trim().startsWith('//')) {
                        out = '// FIXME: 避免使用 eval\n' + out;
                        appliedCount++;
                        summary.push(`L${lineNum}: 已标注 eval 风险`);
                    }
                }
            }
            if (item.category === 'style' && item.hasQuickFix) {
                if (lang === 'python' && !out.trim().startsWith('#')) {
                    out = out.replace(/(\s*)$/, '  # noqa: ' + (item.code || '') + '$1');
                    appliedCount++;
                    summary.push(`L${lineNum}: 添加 noqa`);
                }
                if ((lang === 'javascript' || result.filePath.endsWith('.ts')) && !out.trim().startsWith('//')) {
                    out = '// eslint-disable-next-line ' + (item.code || '') + '\n' + out;
                    appliedCount++;
                    summary.push(`L${lineNum}: 添加 eslint-disable-next-line`);
                }
            }
        }
        return out;
    };
    const newLines = lines.map((line, i) => fixLine(line, i + 1));
    let fixedCode = newLines.join('\n');
    if (lang === 'python' && needAstImport.value && !fixedCode.includes('import ast')) {
        const firstImport = fixedCode.match(/^import\s+|^from\s+/m);
        if (firstImport) {
            fixedCode = 'import ast\n' + fixedCode;
        }
        else {
            fixedCode = 'import ast\n\n' + fixedCode;
        }
        appliedCount++;
        summary.push('已添加 import ast');
    }
    if (summary.length === 0)
        summary.push('未进行自动修改，请根据侧边栏建议手动修改');
    return { fixedCode, summary, appliedCount };
}
/** 取当前审查文件的扩展名以判断语言 */
function getExtension(result) {
    const m = result.filePath.match(/\.(py|js|ts|jsx|tsx)$/i);
    return m ? m[1].toLowerCase() : 'txt';
}
//# sourceMappingURL=codeFixer.js.map