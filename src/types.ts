/**
 * 智能代码审查插件 - 统一数据类型定义
 * 各模块通过该文件中的结构进行通信，避免强耦合。
 */

/** 语法树节点在统一中间表示中的描述 */
export interface ASTNodeInfo {
  type: string;
  name?: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  children?: ASTNodeInfo[];
}

/** 函数节点 */
export interface FunctionNode extends ASTNodeInfo {
  type: 'function';
  name: string;
  parameters?: string[];
}

/** 变量/标识符节点（声明或引用） */
export interface VariableNode extends ASTNodeInfo {
  type: 'variable';
  name: string;
  kind?: 'declaration' | 'reference';
}

/** 控制结构节点（if/for/while/try 等） */
export interface ControlNode extends ASTNodeInfo {
  type: 'control';
  kind: string;
}

/** 代码解析模块产出的统一中间表示（JSON） */
export interface CodeIntermediateRepresentation {
  languageId: string;
  filePath: string;
  contentHash: string;
  functions: FunctionNode[];
  variables: VariableNode[];
  controlStructures: ControlNode[];
  errors: string[];
  rawAstSummary?: Record<string, unknown>;
}

/** 规则校验模块 - 统一问题结构 */
export interface RuleIssue {
  tool: 'pylint' | 'eslint' | 'checkstyle';
  message: string;
  severity: 'info' | 'warning' | 'error';
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  code?: string;
  source?: string;
  /** 是否视为高风险（可触发模型分析） */
  highRisk?: boolean;
}

/** 模型智能分析 - 单条建议 */
export interface AiSuggestionItem {
  category: 'syntax' | 'style' | 'security' | 'performance' | 'refactor';
  description: string;
  line?: number;
  suggestion?: string;
  exampleCode?: string;
}

/** 模型智能分析 - 响应结构 */
export interface AiAnalysisResult {
  summary: string;
  items: AiSuggestionItem[];
  raw?: string;
}

/** 合并后的单条审查项（规则 + 模型，去重后） */
export interface MergedReviewItem {
  id: string;
  source: 'rule' | 'ai';
  category: 'syntax' | 'style' | 'security' | 'performance' | 'refactor';
  message: string;
  severity: 'info' | 'warning' | 'error';
  line: number;
  column: number;
  code?: string;
  tool?: string;
  exampleCode?: string;
  /** 是否提供 CodeAction 一键修复 */
  hasQuickFix?: boolean;
}

/** 单文件完整审查结果（用于缓存与侧边栏） */
export interface FileReviewResult {
  uri: string;
  filePath: string;
  contentHash: string;
  timestamp: number;
  ir: CodeIntermediateRepresentation | null;
  ruleIssues: RuleIssue[];
  aiResult: AiAnalysisResult | null;
  mergedItems: MergedReviewItem[];
}
