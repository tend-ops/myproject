# Smart Code Review — 智能代码审查与优化助手

基于 **Tree-sitter** 解析引擎、**CodeLlama-7B-Instruct** 模型（可选）与 **Pylint/ESLint/Checkstyle** 等 Linter，面向 VS Code 的智能代码审查插件。**严格按五阶段流水线**运行：**语法错误检测 → 代码规范校验 → 安全漏洞识别 → 性能优化建议 → 重构方案生成**，支持 Python、JavaScript、TypeScript、Java。内置安全/性能/重构规则在未安装 Linter、未配置 AI 时仍会产出结果，保证全流程可演示。

---

## 与毕业论文（设计）四部分对应关系

| 论文章节 | 本仓库对应内容 |
|----------|----------------|
| **1. 代码解析引擎搭建与数据集准备** | Tree-sitter 解析（`treeSitterService`、`astExtract`）；多语言支持（Python/JavaScript/TypeScript/Java）；数据集目录与标注说明见 [datasets/README.md](datasets/README.md) |
| **2. 规则引擎构建与第三方工具集成** | Pylint / ESLint / Checkstyle 集成（`lintRunner`）；统一规则引擎与 Tree-sitter 联动；详见 [docs/rule-engine.md](docs/rule-engine.md) |
| **3. CodeLlama-7B-Instruct 模型集成与高级功能** | AI 调用与结果解析（`aiClient`）；输入裁剪与提示词设计；详见 [docs/codellama-integration.md](docs/codellama-integration.md) |
| **4. VS Code 插件开发与功能测试优化** | 整体架构与交互（`extension`、`sidebarView`、`reviewCoordinator`）；全流程前端集成；运行与测试步骤见下方「在 VS Code 内运行」 |

---

## 一、功能与模块（对应开题报告）

### 1. 代码解析模块

- **事件驱动**：监听 `onDidOpenTextDocument`、`onDidChangeTextDocument`，在打开与编辑时触发解析。
- **Tree-sitter**：按语言选择对应语法解析器（Python / JavaScript），生成 AST。
- **统一中间表示（IR）**：从语法树提取函数节点、变量节点、控制结构节点，构建 JSON 格式 IR（见 `src/astExtract.ts`、`src/types.ts`）。
- **缓存**：基于文件内容哈希缓存解析结果，仅在内容变化时重新解析（`src/parseCache.ts`），降低重复计算。

### 2. 规则校验模块

- **工程级集成**：通过 Node 子进程调用外部工具：
  - **Python**：Pylint（JSON 输出）
  - **JavaScript/TypeScript**：ESLint（JSON 输出）
  - **Java**：Checkstyle（XML 输出，需配置 `checkstyleJar` 或 `checkstylePath`）
- **统一数据结构**：将各工具输出转换为 `RuleIssue`（问题类型、描述、位置、严重等级、是否高风险）。
- **DiagnosticCollection**：结果以红线/黄线形式标注在编辑器中，并出现在 **Problems** 面板。
- **高风险标记**：部分安全相关规则（如 eval、exec）标记为 `highRisk`，可配置为仅在此类问题时自动触发模型分析。

### 3. 模型智能分析模块

- **触发条件**：
  - 用户主动执行命令「**Smart Code Review: 智能分析（仅模型）**」；
  - 或执行「全流程审查」时按配置决定是否调用模型（默认调用；可开启「仅高风险时自动触发」）。
- **输入裁剪**：基于 IR 与当前光标行，仅将**当前函数或当前区域**代码片段传给模型，避免整文件导致推理成本过高。
- **上下文增强**：将函数名、变量名、规则检测结果等写入请求体（`context_summary`、`lint_issues`、`syntax_findings`），提高模型针对性。
- **结果解析**：支持后端返回结构化 JSON（`summary`、`syntax_errors`、`style_issues`、`security_issues`、`performance_issues`、`refactor_suggestions` 或统一 `items`），并对纯文本做简单结构化抽取。

### 4. 优化与重构建议模块

- **结果合并与去重**：规则结果与 AI 结果合并为 `MergedReviewItem`，按类别与位置去重。
- **CodeAction 一键修复**：对部分简单问题（如未使用变量）提供「忽略本行」（Python `# noqa`、JS/TS `eslint-disable-next-line`）的 Quick Fix。
- **侧边栏**：在「Smart Code Review」视图容器下展示「审查结果」树：按文件 → 按类别（语法/规范/安全/性能/重构）→ 单条建议，点击可定位到对应行；复杂建议的示例代码通过 tooltip 展示。

### 5. 插件配置与项目管理

- **Configuration API**：所有配置项通过 `settings.json` 或设置 UI 修改，包括：
  - 启用/禁用 Tree-sitter、Pylint、ESLint、Checkstyle；
  - 各工具路径（`pythonPath`、`pylintPath`、`eslintPath`、`checkstylePath`、`checkstyleJar`）；
  - AI 服务地址、API Key、`maxTokens`；
  - 是否「仅在高风险时自动触发模型」等。
- **分析结果缓存**：最近审查结果以轻量 JSON 存入 `globalState`，用于侧边栏展示与历史回溯，避免重复分析（见 `src/resultCache.ts`）。

---

## 二、UI 与交互

- **Problems 面板**：集中展示所有诊断（语法 + 规则）。
- **行内波浪线与悬浮**：问题详情在代码行内与 hover 中显示。
- **侧边栏**：活动栏中「Smart Code Review」→「审查结果」树，按文件与问题类型分类，支持定位到行。
- **异步与防抖**：规则校验在文档变更时防抖（约 800ms）执行，不阻塞输入；大文件仅对当前区域做模型输入裁剪，保证交互流畅。

---

## 三、目录结构

```text
smart-code-review-vscode/
  package.json
  tsconfig.json
  .vscode/
    launch.json            # 运行扩展（F5）配置
    tasks.json             # 编译 / watch 任务
  resources/
    icon.svg
  datasets/                # 多语言代码样本与标注（论文数据集准备）
    README.md              # 数据集分类与标注维度说明
    python/, javascript/   # 按语言与类型放置样本
  docs/
    rule-engine.md         # 规则引擎与 Pylint/ESLint/Checkstyle 集成说明
    codellama-integration.md  # CodeLlama 集成与提示词设计说明
  src/
    extension.ts           # 入口：命令、文档事件、侧边栏与 CodeAction 注册
    types.ts               # 统一类型：IR、RuleIssue、AiAnalysisResult、MergedReviewItem 等
    treeSitterService.ts   # Tree-sitter 解析与 IR 产出（含可选加载与缓存）
    astExtract.ts          # AST → 函数/变量/控制结构 IR，及按行裁剪片段
    parseCache.ts          # 解析结果哈希缓存
    lintRunner.ts          # Pylint / ESLint / Checkstyle 调用与 RuleIssue 统一
    builtinRules.ts       # 内置安全/性能/重构规则（无 Linter/AI 时仍产出）
    aiClient.ts            # AI 服务 HTTP 调用与结果解析
    reviewCoordinator.ts   # 五阶段全流程编排：语法→规范→安全→性能→重构
    codeActionProvider.ts  # CodeAction 一键修复
    sidebarView.ts         # 侧边栏 TreeDataProvider
    resultCache.ts         # 审查结果持久化
```

---

## 四、在 VS Code 内运行的详细步骤

### 4.1 环境准备

1. **安装 Node.js**  
   确保本机已安装 Node.js（建议 LTS），终端执行 `node -v`、`npm -v` 能正常输出版本号。

2. **（可选）安装各语言 Linter，以便规则校验生效**  
   - **Python**：`pip install pylint` 或 `py -m pip install pylint`，保证命令行可执行 `pylint --version`。  
   - **JavaScript/TypeScript**：在待审查项目或本插件目录执行 `npm install -g eslint`，或项目内 `npm install eslint` 并配置好 `eslintPath`。  
   - **Java**：若需 Checkstyle，下载 Checkstyle JAR，在设置中填写 `smartCodeReview.lint.checkstyleJar`。
3. **（可选）Python AI Agent 服务**  
   本项目新增了一个独立的 Python 进程，用以承载 AI Agent 智能管控逻辑。既可在本机启动，也可部署到远端：  
   - 进入 `review_agent` 子目录，创建并激活虚拟环境（例如 `python -m venv .venv && .\.venv\Scripts\activate`）。
   - 安装依赖：`pip install -r requirements.txt`。  
   - 启动服务：`uvicorn server:app --host 0.0.0.0 --port 5000`。  
   - 默认提供 `POST /review` 接口，接受与 `agentClient.AgentReviewInput` 对应的 JSON，返回与 `FileReviewResult` 一致的结构。  
   - 在 VS Code 插件设置中配置 `smartCodeReview.agent.serverUrl` 为如 `http://localhost:5000/review`，即可将审查请求委托给该 Agent。  
   - 服务内部同时支持 Tree-sitter 解析、Pylint/ESLint 调用，以及基于 **LangChain 框架**的 AI 模型推理；若未安装或出现错误，Agent 会回退到本地 TS 逻辑。  
   - LangChain 集成提供了结构化提示、链式执行和灵活的模型支持，使 AI 分析更加专业和可扩展。  

3. **（可选）AI 服务**  
   若使用「全流程审查」或「智能分析」且希望调用模型，需先在本机或服务器部署符合接口约定的 CodeLlama 服务（如通过 Ollama、vLLM 等），并配置 `smartCodeReview.ai.serverUrl`。不配置时插件仍可运行，仅 AI 部分会提示连接失败。

### 4.2 打开插件工程

1. 启动 **VS Code**（或 Cursor）。
2. 菜单栏选择 **文件 → 打开文件夹**。
3. 选择本插件所在目录：**`smart-code-review-vscode`**（即包含 `package.json`、`src/` 的文件夹），点击「选择文件夹」。

### 4.3 安装依赖与编译

1. 打开集成终端：**终端 → 新建终端**（或 `` Ctrl+` ``）。
2. 在终端中执行（当前工作目录应为 `smart-code-review-vscode`）：

   ```bash
   npm install
   ```

3. 再执行编译：

   ```bash
   npm run compile
   ```

   若无报错，会在项目下生成 `out/` 目录，其中为编译后的 JS 文件。

### 4.4 以调试方式运行插件（Extension Development Host）

1. 在左侧活动栏点击 **运行和调试** 图标（或按 `Ctrl+Shift+D`）。
2. 在运行配置下拉框中选择 **「运行扩展 (Run Extension)”**（若没有该项，确认已存在 `.vscode/launch.json`，见本仓库已提供配置）。
3. 点击绿色 **启动** 按钮（或按 **F5**）。  
   - 首次运行会先执行 `npm run watch`（持续编译），等待几秒直至无报错。  
   - 随后会弹出一个新的 VS Code 窗口，标题栏通常带有 **「[扩展开发主机]」** 或类似字样，表示插件已在该窗口中加载。

### 4.5 在新窗口中体验插件功能

1. 在 **扩展开发主机** 窗口中，打开待审查的代码目录或文件：  
   **文件 → 打开文件夹** 或 **打开文件**，选择你的项目（如毕业设计工程）或任意 Python / JavaScript / TypeScript / Java 文件。
2. 打开或切换到一个支持的语言文件（如 `.py`、`.js`、`.ts`、`.java`）。
3. 使用命令面板执行审查：  
   - 按 **Ctrl+Shift+P**（或 **F1**）打开命令面板。  
   - 输入并选择下列命令之一：  
     - **Smart Code Review: 全流程审查** — 执行「语法错误检测 → 规则校验 →（可选）AI 分析」，结果出现在 **问题（Problems）** 面板、**输出** 通道的 “Smart Code Review” 以及侧边栏。  
     - **Smart Code Review: 智能分析（仅模型）** — 仅调用 AI，输入为当前光标所在函数/区域。  
     - **Smart Code Review: 显示审查结果面板** — 聚焦侧边栏「Smart Code Review」下的「审查结果」视图。
4. 查看结果：  
   - **问题面板**：底部或侧边「问题」中可见语法与规则诊断，点击可跳转到对应行。  
   - **侧边栏**：左侧活动栏点击「Smart Code Review」图标，在「审查结果」树中按文件/类别查看，点击条目可定位到代码行。  
   - **输出**：底部「输出」中选择「Smart Code Review」可查看全流程日志与 AI 总结。

### 4.6 若使用「仅编译一次」再运行

- 在 **运行和调试** 配置中选择 **「运行扩展（仅编译一次）」**，再按 F5。  
- 将先执行 `npm run compile`，再启动扩展开发主机，适合不想开 watch 时使用。

### 4.7 注意事项

- Tree-sitter 相关包为 `optionalDependencies`。若在 Windows 上安装或编译失败（如缺少 Python/构建工具），插件仍可运行，仅语法解析与 IR 降级为空，**规则校验与 AI 分析照常可用**。
- 修改 `src/` 下 TypeScript 后，若使用「运行扩展 (Run Extension)」，`watch` 会自动重新编译；若使用「仅编译一次」，需手动执行 `npm run compile` 后重新 F5。
- 功能测试时可用 `datasets/` 下按类型整理的样本（见 [datasets/README.md](datasets/README.md)）进行多语言、语法/规范/安全/重构等场景验证，便于撰写论文中的功能准确性测试与实验结果。

---

## 五、配置项示例

```json
{
  "smartCodeReview.enableTreeSitter": true,
  "smartCodeReview.lint.enablePylint": true,
  "smartCodeReview.lint.enableEslint": true,
  "smartCodeReview.lint.enableCheckstyle": true,
  "smartCodeReview.lint.pythonPath": "python",
  "smartCodeReview.lint.pylintPath": "pylint",
  "smartCodeReview.lint.eslintPath": "eslint",
  "smartCodeReview.lint.checkstylePath": "",
  "smartCodeReview.lint.checkstyleJar": "",
  "smartCodeReview.ai.serverUrl": "http://localhost:8000/v1/code-review",
  "smartCodeReview.ai.apiKey": "",
  "smartCodeReview.ai.maxTokens": 2048,
  "smartCodeReview.ai.autoTriggerOnHighRisk": false
}
```

---

## 六、AI 服务接口约定

- **方法**：`POST` 到 `smartCodeReview.ai.serverUrl`（如 `http://localhost:8000/v1/code-review`）。
- **请求体**：JSON，包含 `model`、`max_tokens`、`input`。`input` 中建议包含：
  - `language`、`file_path`
  - `code_snippet`（裁剪后的代码）
  - `full_code`（可选）
  - `syntax_findings`、`lint_issues`、`context_summary`
- **响应体**：需包含 `summary`，以及下列数组至少其一（或统一用 `items`）：
  - `syntax_errors`、`style_issues`、`security_issues`、`performance_issues`、`refactor_suggestions`

可使用 Ollama、vLLM、llama.cpp 等部署 CodeLlama-7B-Instruct，并封装为符合上述约定的 HTTP 服务。

---

## 七、技术选型（与开题一致）

- **VS Code Extension API** + **TypeScript**
- **Tree-sitter**：语法解析
- **Pylint / ESLint / Checkstyle**：规则校验
- **CodeLlama-7B-Instruct 等**：智能分析  
各技术由插件统一调度，形成完整代码审查流程。
