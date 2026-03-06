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
exports.runLinters = runLinters;
exports.hasHighRiskIssues = hasHighRiskIssues;
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
/** 视为高风险的规则码（可触发模型智能分析） */
const HIGH_RISK_PYLINT = new Set(['eval-used', 'exec-used', 'dangerous-default-value', 'W0123', 'W0122']);
const HIGH_RISK_ESLINT = new Set(['no-eval', 'no-implied-eval', 'security/detect-eval-with-expression', 'no-new-func']);
function runCommand(command, cwd) {
    return new Promise((resolve) => {
        (0, child_process_1.exec)(command, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            resolve({ stdout: stdout || '', stderr: stderr || (error && error.message) || '' });
        });
    });
}
async function runPylint(document) {
    const config = vscode.workspace.getConfiguration('smartCodeReview.lint');
    const enabled = config.get('enablePylint', true);
    if (!enabled)
        return [];
    const pythonPath = config.get('pythonPath', 'python');
    const pylintPath = config.get('pylintPath', 'pylint');
    const filePath = document.fileName;
    const cwd = path.dirname(filePath);
    const cmd = `"${pythonPath}" -m "${pylintPath}" --output-format=json "${filePath}"`;
    const { stdout } = await runCommand(cmd, cwd);
    if (!stdout.trim())
        return [];
    try {
        const parsed = JSON.parse(stdout);
        return parsed.map((item) => ({
            tool: 'pylint',
            message: item.message,
            severity: item.type === 'error' ? 'error' : item.type === 'warning' ? 'warning' : 'info',
            line: item.line || 1,
            column: item.column || 1,
            code: item.symbol,
            highRisk: HIGH_RISK_PYLINT.has(String(item.symbol || item.message_id))
        }));
    }
    catch {
        return [];
    }
}
async function runEslint(document) {
    const config = vscode.workspace.getConfiguration('smartCodeReview.lint');
    const enabled = config.get('enableEslint', true);
    if (!enabled)
        return [];
    const eslintPath = config.get('eslintPath', 'eslint');
    const filePath = document.fileName;
    const cwd = path.dirname(filePath);
    const cmd = `"${eslintPath}" -f json "${filePath}"`;
    const { stdout } = await runCommand(cmd, cwd);
    if (!stdout.trim())
        return [];
    try {
        const parsed = JSON.parse(stdout);
        const fileResult = parsed[0];
        if (!fileResult || !Array.isArray(fileResult.messages))
            return [];
        return fileResult.messages.map((m) => ({
            tool: 'eslint',
            message: m.message,
            severity: m.severity === 2 ? 'error' : 'warning',
            line: m.line || 1,
            column: m.column || 1,
            endLine: m.endLine,
            endColumn: m.endColumn,
            code: m.ruleId,
            highRisk: m.ruleId && HIGH_RISK_ESLINT.has(m.ruleId)
        }));
    }
    catch {
        return [];
    }
}
/** Java：通过 Checkstyle 命令行进行规则校验 */
async function runCheckstyle(document) {
    const config = vscode.workspace.getConfiguration('smartCodeReview.lint');
    const enabled = config.get('enableCheckstyle', true);
    if (!enabled)
        return [];
    const checkstylePath = config.get('checkstylePath', '');
    const checkstyleJar = config.get('checkstyleJar', '');
    if (!checkstylePath && !checkstyleJar)
        return [];
    const filePath = document.fileName;
    const cwd = path.dirname(filePath);
    let cmd;
    if (checkstyleJar) {
        cmd = `java -jar "${checkstyleJar}" -f xml "${filePath}"`;
    }
    else {
        cmd = `"${checkstylePath}" -f xml "${filePath}"`;
    }
    const { stdout } = await runCommand(cmd, cwd);
    if (!stdout.trim() || stdout.includes('Exception'))
        return [];
    try {
        const issues = [];
        const re = /<error\s+line="(\d+)"\s+column="(\d+)"\s+severity="(error|warning|info)"\s+message="([^"]+)"\s+source="([^"]*)"/g;
        let m;
        while ((m = re.exec(stdout)) !== null) {
            issues.push({
                tool: 'checkstyle',
                message: m[4],
                severity: m[3],
                line: parseInt(m[1], 10),
                column: parseInt(m[2], 10),
                code: m[5] || undefined
            });
        }
        return issues;
    }
    catch {
        return [];
    }
}
async function runLinters(document) {
    const languageId = document.languageId;
    const issues = [];
    if (languageId === 'python') {
        issues.push(...(await runPylint(document)));
    }
    else if (languageId === 'javascript' ||
        languageId === 'javascriptreact' ||
        languageId === 'typescript' ||
        languageId === 'typescriptreact') {
        issues.push(...(await runEslint(document)));
    }
    else if (languageId === 'java') {
        issues.push(...(await runCheckstyle(document)));
    }
    return issues;
}
/** 是否存在高风险问题（用于决定是否自动触发模型分析） */
function hasHighRiskIssues(issues) {
    return issues.some(i => i.highRisk || i.severity === 'error');
}
//# sourceMappingURL=lintRunner.js.map