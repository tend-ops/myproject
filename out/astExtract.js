"use strict";
/**
 * 从 Tree-sitter 语法树提取统一中间表示（函数、变量、控制结构）
 * 为规则检测与模型输入裁剪提供结构化数据。
 * 使用 any 表示 tree/node 以支持无 tree-sitter 类型依赖的编译。
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
exports.extractIR = extractIR;
exports.getCodeSnippetAtLine = getCodeSnippetAtLine;
const crypto = __importStar(require("crypto"));
const CONTROL_KINDS = new Set([
    'if_statement', 'else_clause', 'for_statement', 'while_statement',
    'try_statement', 'with_statement', 'switch_statement', 'try_statement'
]);
function getNodeText(node, source) {
    return source.slice(node.startIndex, node.endIndex);
}
function findChild(node, ...types) {
    for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (c && types.includes(c.type))
            return c;
    }
    return null;
}
function findIdentifierName(node, source) {
    const nameNode = findChild(node, 'identifier', 'name', 'property_identifier') || node;
    return nameNode ? getNodeText(nameNode, source).trim() || undefined : undefined;
}
function extractPython(tree, source) {
    const functions = [];
    const variables = [];
    const controlStructures = [];
    const errors = [];
    function walk(node) {
        if (node.hasError()) {
            errors.push(`语法错误 @ (${node.startPosition.row + 1}, ${node.startPosition.column + 1})`);
        }
        if (node.type === 'function_definition') {
            const nameNode = findChild(node, 'identifier');
            const name = nameNode ? getNodeText(nameNode, source) : '<anonymous>';
            functions.push({
                type: 'function',
                name,
                startLine: node.startPosition.row + 1,
                startColumn: node.startPosition.column,
                endLine: node.endPosition.row + 1,
                endColumn: node.endPosition.column
            });
        }
        if (node.type === 'assignment' || node.type === 'typed_parameter') {
            const nameNode = findChild(node, 'identifier', 'pattern');
            if (nameNode) {
                const name = getNodeText(nameNode, source).split('=')[0].trim();
                if (name && !name.startsWith('_')) {
                    variables.push({
                        type: 'variable',
                        name,
                        kind: 'declaration',
                        startLine: node.startPosition.row + 1,
                        startColumn: node.startPosition.column,
                        endLine: node.endPosition.row + 1,
                        endColumn: node.endPosition.column
                    });
                }
            }
        }
        if (node.type === 'if_statement' || node.type === 'for_statement' || node.type === 'while_statement' ||
            node.type === 'try_statement' || node.type === 'with_statement') {
            controlStructures.push({
                type: 'control',
                kind: node.type,
                startLine: node.startPosition.row + 1,
                startColumn: node.startPosition.column,
                endLine: node.endPosition.row + 1,
                endColumn: node.endPosition.column
            });
        }
        for (let i = 0; i < node.childCount; i++) {
            const c = node.child(i);
            if (c)
                walk(c);
        }
    }
    walk(tree.rootNode);
    return { functions, variables, controlStructures, errors };
}
function extractJavaScript(tree, source) {
    const functions = [];
    const variables = [];
    const controlStructures = [];
    const errors = [];
    function walk(node) {
        if (node.hasError()) {
            errors.push(`语法错误 @ (${node.startPosition.row + 1}, ${node.startPosition.column + 1})`);
        }
        const type = node.type;
        if (type === 'function_declaration' || type === 'method_definition' || type === 'arrow_function' || type === 'function') {
            const name = findIdentifierName(node, source) || '<anonymous>';
            functions.push({
                type: 'function',
                name,
                startLine: node.startPosition.row + 1,
                startColumn: node.startPosition.column,
                endLine: node.endPosition.row + 1,
                endColumn: node.endPosition.column
            });
        }
        if (type === 'variable_declarator' || type === 'lexical_declaration') {
            const nameNode = findChild(node, 'identifier', 'property_identifier') || node.child(0);
            if (nameNode) {
                const name = getNodeText(nameNode, source).trim();
                if (name) {
                    variables.push({
                        type: 'variable',
                        name,
                        kind: 'declaration',
                        startLine: node.startPosition.row + 1,
                        startColumn: node.startPosition.column,
                        endLine: node.endPosition.row + 1,
                        endColumn: node.endPosition.column
                    });
                }
            }
        }
        if (CONTROL_KINDS.has(type) || type === 'if_statement' || type === 'for_statement' || type === 'while_statement' || type === 'try_statement') {
            controlStructures.push({
                type: 'control',
                kind: type,
                startLine: node.startPosition.row + 1,
                startColumn: node.startPosition.column,
                endLine: node.endPosition.row + 1,
                endColumn: node.endPosition.column
            });
        }
        for (let i = 0; i < node.childCount; i++) {
            const c = node.child(i);
            if (c)
                walk(c);
        }
    }
    walk(tree.rootNode);
    return { functions, variables, controlStructures, errors };
}
function extractJava(tree, source) {
    const functions = [];
    const variables = [];
    const controlStructures = [];
    const errors = [];
    function walk(node) {
        if (node.hasError()) {
            errors.push(`语法错误 @ (${node.startPosition.row + 1}, ${node.startPosition.column + 1})`);
        }
        const type = node.type;
        if (type === 'method_declaration' || type === 'constructor_declaration') {
            const nameNode = findChild(node, 'identifier');
            const name = nameNode ? getNodeText(nameNode, source) : '<anonymous>';
            functions.push({
                type: 'function',
                name,
                startLine: node.startPosition.row + 1,
                startColumn: node.startPosition.column,
                endLine: node.endPosition.row + 1,
                endColumn: node.endPosition.column
            });
        }
        if (type === 'variable_declarator' || type === 'field_declaration') {
            const nameNode = findChild(node, 'identifier') || node.child(0);
            if (nameNode) {
                const name = getNodeText(nameNode, source).trim();
                if (name) {
                    variables.push({
                        type: 'variable',
                        name,
                        kind: 'declaration',
                        startLine: node.startPosition.row + 1,
                        startColumn: node.startPosition.column,
                        endLine: node.endPosition.row + 1,
                        endColumn: node.endPosition.column
                    });
                }
            }
        }
        if (CONTROL_KINDS.has(type) || type === 'if_statement' || type === 'for_statement' || type === 'while_statement' || type === 'try_statement' || type === 'switch_statement') {
            controlStructures.push({
                type: 'control',
                kind: type,
                startLine: node.startPosition.row + 1,
                startColumn: node.startPosition.column,
                endLine: node.endPosition.row + 1,
                endColumn: node.endPosition.column
            });
        }
        for (let i = 0; i < node.childCount; i++) {
            const c = node.child(i);
            if (c)
                walk(c);
        }
    }
    walk(tree.rootNode);
    return { functions, variables, controlStructures, errors };
}
function extractIR(languageId, filePath, source, tree) {
    const contentHash = crypto.createHash('sha256').update(source).digest('hex').slice(0, 16);
    let base;
    if (languageId === 'python') {
        base = extractPython(tree, source);
    }
    else if (languageId === 'java') {
        base = extractJava(tree, source);
    }
    else {
        base = extractJavaScript(tree, source);
    }
    return {
        languageId,
        filePath,
        contentHash,
        ...base
    };
}
/** 根据光标行号获取所在函数对应的代码片段（用于模型输入裁剪） */
function getCodeSnippetAtLine(ir, source, line) {
    const line1 = line + 1; // 1-based
    const fn = ir.functions.find(f => line1 >= f.startLine && line1 <= f.endLine);
    if (fn) {
        const lines = source.split(/\r?\n/);
        const start = fn.startLine - 1;
        const end = Math.min(fn.endLine, lines.length);
        return lines.slice(start, end).join('\n');
    }
    // 若不在任何函数内，返回前 N 行 + 当前区域，避免整文件
    const lines = source.split(/\r?\n/);
    const maxLines = 80;
    const start = Math.max(0, line - 20);
    const end = Math.min(lines.length, start + maxLines);
    return lines.slice(start, end).join('\n');
}
//# sourceMappingURL=astExtract.js.map