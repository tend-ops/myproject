# 规则引擎构建与第三方工具集成说明

对应毕业论文「规则引擎构建与第三方工具集成」部分。插件已集成 Pylint（Python）、ESLint（JavaScript/TypeScript）、Checkstyle（Java），并实现与 Tree-sitter 解析结果的联动。

---

## 一、已集成工具与核心规则

| 语言           | 工具        | 输出格式 | 核心校验能力 |
|----------------|-------------|----------|--------------|
| Python         | Pylint      | JSON     | 命名、复杂度、未使用变量、安全（eval/exec）、代码风格 |
| JavaScript/TS  | ESLint      | JSON     | 语法、风格、安全（no-eval 等）、最佳实践 |
| Java           | Checkstyle  | XML      | 命名、缩进、复杂度、Javadoc、编码规范 |

各工具在插件中通过 `src/lintRunner.ts` 以**子进程**方式调用，输出被解析为统一结构 `RuleIssue`（见 `src/types.ts`），包含：`tool`、`message`、`severity`、`line`、`column`、`code`、`highRisk` 等。

---

## 二、统一规则引擎行为

- **整合**：多工具结果合并为同一列表，写入 `DiagnosticCollection` 与侧边栏数据源。
- **自定义配置**：通过 VS Code 配置项开关各工具（`enablePylint`、`enableEslint`、`enableCheckstyle`）及路径（`pylintPath`、`eslintPath`、`checkstyleJar` 等）。
- **优先级**：展示时按 `severity`（error > warning > info）与行号排序；部分规则码（如 Pylint 的 `eval-used`、ESLint 的 `no-eval`）标记为 `highRisk`，可配置为仅在此类问题时自动触发模型分析（`smartCodeReview.ai.autoTriggerOnHighRisk`）。
- **规则与 Tree-sitter 联动**：全流程审查时先执行 Tree-sitter 解析得到语法错误与 IR，再将 IR 与规则结果一并作为模型输入的上下文（`syntax_findings`、`lint_issues`、`context_summary`），实现「解析结果 → 规则引擎 → 模型」的串联。

---

## 三、规则适配接口

- **输入**：当前文档 `vscode.TextDocument`，以及（由上层传入的）解析结果 IR。
- **输出**：`RuleIssue[]`，保证行号、列号、消息、严重程度、规则码统一，便于 Problems 面板与侧边栏展示，以及后续与 AI 结果合并去重。
- **扩展**：若需增加新语言或新工具，只需在 `lintRunner.ts` 中新增对应 `runXxx(document)` 函数，并在 `runLinters` 中按 `document.languageId` 分支调用即可，无需改动其他模块。

上述设计满足「规则的整合、自定义配置与优先级排序」以及「规则引擎与 Tree-sitter 解析结果的联动」，并输出标准化的错误提示。
