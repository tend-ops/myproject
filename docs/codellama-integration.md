# CodeLlama-7B-Instruct 模型集成与高级功能说明

对应毕业论文「CodeLlama-7B-Instruct 模型集成与高级功能开发」部分。

---

## 一、模型部署与调用方式

- **部署**：CodeLlama-7B-Instruct 可通过 **Ollama**、**vLLM**、**llama.cpp** 等在本机或服务器部署，暴露 HTTP API。
- **插件侧**：插件不直接依赖具体部署方式，仅通过配置项 `smartCodeReview.ai.serverUrl` 向指定 URL 发送 POST 请求；可选 `smartCodeReview.ai.apiKey` 用于鉴权。
- **接口约定**：见主 README「AI 服务接口约定」；请求体包含 `model`、`max_tokens`、`input`（含 `language`、`file_path`、`code_snippet`、`full_code`、`syntax_findings`、`lint_issues`、`context_summary`）。

---

## 二、提示词与输入设计

- **输入裁剪**：为避免上下文窗口限制，插件不直接发送整文件。基于 Tree-sitter 的 IR，提取**当前光标所在函数或当前区域**的代码片段（`getCodeSnippetAtLine`），仅将该片段与必要上下文传给模型；若 IR 不可用则截取前 8000 字符。
- **上下文增强**：请求体中的 `syntax_findings`（Tree-sitter 解析错误）、`lint_issues`（规则引擎结果）、`context_summary`（函数名、变量名等）用于引导模型聚焦「安全漏洞识别、性能瓶颈分析、重构方案生成」。
- **服务端提示词建议**：服务端收到上述 JSON 后，可组装类似 prompt：
  - 角色：你是一个代码审查助手，结合静态分析结果进行安全、性能与重构建议。
  - 输入：当前语言、文件路径、代码片段、语法/规则检测结果、上下文摘要。
  - 输出要求：按「语法 / 规范 / 安全 / 性能 / 重构」分类，返回结构化 JSON（`summary`、`syntax_errors`、`style_issues`、`security_issues`、`performance_issues`、`refactor_suggestions`，或统一 `items` 数组），便于插件解析与展示。

---

## 三、自动化流程

- **解析结果 → 模型输入**：`reviewCoordinator` 在全流程审查或「智能分析」时，先调用 Tree-sitter 与规则引擎，再将 IR、规则结果与裁剪后的代码通过 `aiClient.requestAiReview` 批量传入模型。
- **模型推理结果解析**：`aiClient` 支持多种响应格式：  
  - 标准结构化 JSON（`summary` + 各分类数组或 `items`）；  
  - 若无结构化字段则对 `raw` 文本做关键词/正则抽取，映射到 `syntax` / `style` / `security` / `performance` / `refactor`。
- **格式化展示**：解析后的 `AiAnalysisResult` 与规则结果在 `reviewCoordinator.mergeResults` 中合并为 `MergedReviewItem`，写入侧边栏与输出通道，支持按类别查看与定位到行；示例代码通过 `exampleCode` 在 UI 中展示。

以上实现满足「模型在插件系统中的集成与适配」「提示词设计与优化」「解析结果向模型输入的转换、推理结果解析与格式化展示」，并支撑安全漏洞识别、性能优化建议与重构方案生成等高级功能。
