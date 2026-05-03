from typing import List, Optional, Dict, Any
from pydantic import BaseModel

class ASTNodeInfo(BaseModel):
    type: str
    name: Optional[str]
    startLine: int
    startColumn: int
    endLine: int
    endColumn: int
    children: Optional[List['ASTNodeInfo']] = None

class FunctionNode(ASTNodeInfo):
    type: str = 'function'
    name: str
    parameters: Optional[List[str]] = None

class VariableNode(ASTNodeInfo):
    type: str = 'variable'
    name: str
    kind: Optional[str] = None

class ControlNode(ASTNodeInfo):
    type: str = 'control'
    kind: str

class CodeIntermediateRepresentation(BaseModel):
    languageId: str
    filePath: str
    contentHash: str
    functions: List[FunctionNode]
    variables: List[VariableNode]
    controlStructures: List[ControlNode]
    errors: List[str]
    rawAstSummary: Optional[Dict[str, Any]] = None

class RuleIssue(BaseModel):
    tool: str
    message: str
    severity: str
    line: int
    column: int
    endLine: Optional[int] = None
    endColumn: Optional[int] = None
    code: Optional[str] = None
    source: Optional[str] = None
    highRisk: Optional[bool] = False

class AiSuggestionItem(BaseModel):
    category: str
    description: str
    line: Optional[int] = None
    suggestion: Optional[str] = None
    exampleCode: Optional[str] = None

class AiAnalysisResult(BaseModel):
    summary: str
    items: List[AiSuggestionItem]
    raw: Optional[str] = None

class MergedReviewItem(BaseModel):
    id: str
    source: str
    category: str
    message: str
    severity: str
    line: int
    column: int
    code: Optional[str] = None
    tool: Optional[str] = None
    exampleCode: Optional[str] = None
    hasQuickFix: Optional[bool] = False

class FileReviewResult(BaseModel):
    uri: str
    filePath: str
    contentHash: str
    timestamp: float
    ir: Optional[CodeIntermediateRepresentation]
    ruleIssues: List[RuleIssue]
    aiResult: Optional[AiAnalysisResult]
    mergedItems: List[MergedReviewItem]

class FixIssuePayload(BaseModel):
    """客户端「生成修复」时传入的问题列表条目（跳过重复全量审查）。"""
    category: str = "style"
    message: str
    line: int = 0
    severity: str = "warning"


class AgentReviewInput(BaseModel):
    languageId: str
    filePath: str
    code: str
    cursorLine: Optional[int] = None
    issues: Optional[List[FixIssuePayload]] = None
