"use strict";
/**
 * 内置规则：在未配置 CodeLlama 或 Linter 不可用时，仍能产出
 * 安全漏洞识别、性能优化建议、重构方案生成 三类结果，保证全流程可演示。
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
exports.runSecurityRules = runSecurityRules;
exports.runPerformanceRules = runPerformanceRules;
exports.runRefactorRules = runRefactorRules;
const vscode = __importStar(require("vscode"));
const MAX_FUNCTION_LINES = 40;
const DUPLICATE_BLOCK_MIN_LINES = 3;
function lineToItem(line, category, message, severity = 'warning') {
    return {
        id: `builtin-${category}-${line}-${message.slice(0, 20).replace(/\s/g, '_')}`,
        source: 'rule',
        category,
        message: `[内置规则] ${message}`,
        severity,
        line,
        column: 0,
        tool: 'builtin'
    };
}
/** 安全：危险函数/模式（Python + JavaScript 通用） */
const SECURITY_PATTERNS = [
    { pattern: /\beval\s*\(/, message: '使用 eval() 可能执行任意代码，存在安全风险', severity: 'error' },
    { pattern: /\bexec\s*\(/, message: '使用 exec() 可能执行任意代码，存在安全风险', severity: 'error' },
    { pattern: /__import__\s*\(/, message: '动态 __import__ 可能加载恶意模块', severity: 'warning' },
    { pattern: /pickle\.loads\s*\(/, message: 'pickle.loads 反序列化不可信数据可能导致代码执行', severity: 'error' },
    { pattern: /os\.system\s*\(/, message: 'os.system 执行 shell 命令，需避免用户输入拼接', severity: 'warning' },
    { pattern: /subprocess\.(call|run|Popen)\s*\(/, message: 'subprocess 执行外部命令，需校验输入来源', severity: 'warning' },
    { pattern: /\.execute\s*\([^)]*%s|\.execute\s*\([^)]*\+|\.execute\s*\([^)]*f["']/, message: 'SQL/命令拼接可能导致注入，建议使用参数化', severity: 'error' },
    { pattern: /new\s+Function\s*\(/, message: 'new Function() 类似 eval，存在安全风险', severity: 'error' },
    { pattern: /document\.write\s*\(/, message: 'document.write 可能引入 XSS', severity: 'warning' },
    { pattern: /innerHTML\s*=/, message: '直接赋值 innerHTML 可能引入 XSS，建议使用 textContent 或消毒', severity: 'warning' }
];
function runSecurityRules(document) {
    console.log('Running security rules...');
    const config = vscode.workspace.getConfiguration('smartCodeReview.rules');
    const enableBuiltin = config.get('enableBuiltin', true);
    console.log('enableBuiltin:', enableBuiltin);
    if (!enableBuiltin)
        return [];
    const items = [];
    const text = document.getText();
    const lang = document.languageId;
    const lines = text.split(/\r?\n/);
    console.log('Language:', lang);
    console.log('Lines:', lines.length);
    lines.forEach((line, i) => {
        const lineNum = i + 1;
        for (const { pattern, message, severity } of SECURITY_PATTERNS) {
            if (pattern.test(line)) {
                console.log('Match found:', pattern.source, 'at line', lineNum);
                if (lang === 'python' && /document\.|innerHTML|new\s+Function/.test(pattern.source))
                    continue;
                if ((lang === 'javascript' || lang === 'typescript') && /pickle|__import__|os\.system|subprocess/.test(pattern.source))
                    continue;
                items.push(lineToItem(lineNum, 'security', message, severity || 'warning'));
                break;
            }
        }
    });
    console.log('Security items found:', items.length);
    return items;
}
/** 性能：按行检测常见低效写法 */
function runPerformanceRules(document) {
    console.log('Running performance rules...');
    const config = vscode.workspace.getConfiguration('smartCodeReview.rules');
    const enableBuiltin = config.get('enableBuiltin', true);
    console.log('enableBuiltin:', enableBuiltin);
    if (!enableBuiltin)
        return [];
    const items = [];
    const lang = document.languageId;
    const lines = document.getText().split(/\r?\n/);
    console.log('Language:', lang);
    console.log('Lines:', lines.length);
    lines.forEach((line, i) => {
        const lineNum = i + 1;
        if (lang === 'python') {
            if (/\blen\s*\([^)]+\)\s*(==|!=|>|<|in\s)/.test(line)) {
                items.push(lineToItem(lineNum, 'performance', '重复成员/长度检查建议使用 set 或缓存 len() 结果', 'info'));
            }
            if (/\.append\s*\(/.test(line) && line.trimStart().startsWith('.append')) {
                items.push(lineToItem(lineNum, 'performance', '循环内 append 可考虑列表推导式 [x for ...]', 'info'));
            }
            if (/if\s+.*\s+in\s+\[[^\]]{20,}\]/.test(line)) {
                items.push(lineToItem(lineNum, 'performance', '多次 in 列表检查建议改为 set 提升查找效率', 'info'));
            }
        }
        if (lang === 'javascript' || lang === 'typescript') {
            if (/=\s*['\"][^'\"]*['\"]\s*\+/.test(line) && /for\s*\(|while\s*\(/.test(document.getText())) {
                items.push(lineToItem(lineNum, 'performance', '循环内字符串拼接建议用数组 push 后 join 或模板字符串', 'info'));
            }
        }
    });
    console.log('Performance items found:', items.length);
    return items;
}
/** 重构：长函数、重复块 */
function runRefactorRules(document, ir) {
    console.log('Running refactor rules...');
    const config = vscode.workspace.getConfiguration('smartCodeReview.rules');
    const enableBuiltin = config.get('enableBuiltin', true);
    console.log('enableBuiltin:', enableBuiltin);
    if (!enableBuiltin)
        return [];
    const items = [];
    const text = document.getText();
    const lines = text.split(/\r?\n/);
    console.log('Lines:', lines.length);
    console.log('IR available:', ir !== null);
    if (ir)
        console.log('Functions:', ir.functions.length);
    if (ir && ir.functions.length) {
        for (const fn of ir.functions) {
            const lineCount = fn.endLine - fn.startLine + 1;
            if (lineCount > MAX_FUNCTION_LINES) {
                items.push(lineToItem(fn.startLine, 'refactor', `函数 "${fn.name}" 过长（${lineCount} 行），建议拆分为更小函数或提取子逻辑`, 'info'));
            }
        }
    }
    for (let i = 0; i <= lines.length - DUPLICATE_BLOCK_MIN_LINES; i++) {
        const block = lines.slice(i, i + DUPLICATE_BLOCK_MIN_LINES).join('\n').trim();
        if (block.length < 20)
            continue;
        for (let j = i + DUPLICATE_BLOCK_MIN_LINES; j <= lines.length - DUPLICATE_BLOCK_MIN_LINES; j++) {
            const other = lines.slice(j, j + DUPLICATE_BLOCK_MIN_LINES).join('\n').trim();
            if (block === other) {
                items.push(lineToItem(i + 1, 'refactor', `第 ${i + 1}–${i + DUPLICATE_BLOCK_MIN_LINES} 行与第 ${j + 1}–${j + DUPLICATE_BLOCK_MIN_LINES} 行重复，建议提取为公共函数或常量`, 'info'));
                break;
            }
        }
    }
    console.log('Refactor items found:', items.length);
    return items;
}
//# sourceMappingURL=builtinRules.js.map