import hashlib
import subprocess
import json
import time
import re
from pathlib import Path
from typing import Optional
from tree_sitter import Parser
from langchain_openai import OpenAI
from .types import (CodeIntermediateRepresentation, RuleIssue, FileReviewResult, MergedReviewItem,
                    AiAnalysisResult, AiSuggestionItem, AgentReviewInput)
from .vector_store import vector_store

SELF_REVIEW_MAX_ROUNDS = 3
PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"
DEFAULT_FEWSHOT_PATH = PROMPTS_DIR / "fewshot_review.md"
DEFAULT_SELF_REVIEW_PATH = PROMPTS_DIR / "self_review.md"
DEFAULT_FEW_SHOT_EXAMPLES = """
[示例]
语言: python
代码:
eval(input("cmd:"))
输出:
- [security] 避免直接执行用户输入，建议使用白名单或安全解析
""".strip()
DEFAULT_SELF_REVIEW_TEMPLATE = """
你是一个专业的代码审查助手，现在需要对已有审查结果进行第 {round_index} 轮自我审查和改进。

语言: {language_id}

代码片段（可能被截断）:
{code}

当前审查结果:
{review_summary}

请执行：
1) 指出遗漏的重要问题（优先安全、性能、语法、重构）
2) 删除明显误报（如果有）
3) 输出“新增或修正”的问题，不要重复已有项

输出格式严格为每行一个问题：
- [security|performance|refactor|style|syntax] 具体建议
""".strip()


def load_prompt_template(file_name: str, fallback: str) -> str:
    prompt_path = PROMPTS_DIR / file_name
    try:
        content = prompt_path.read_text(encoding="utf-8").strip()
        if content:
            return content
    except Exception:
        pass
    return fallback


def get_few_shot_examples() -> str:
    return load_prompt_template(DEFAULT_FEWSHOT_PATH.name, DEFAULT_FEW_SHOT_EXAMPLES)


def get_self_review_template() -> str:
    return load_prompt_template(DEFAULT_SELF_REVIEW_PATH.name, DEFAULT_SELF_REVIEW_TEMPLATE)


def render_self_review_prompt(language_id: str, code: str, review_summary: str, round_index: int) -> str:
    template = get_self_review_template()
    try:
        return template.format(
            language_id=language_id,
            code=code,
            review_summary=review_summary,
            round_index=round_index,
        )
    except Exception:
        return DEFAULT_SELF_REVIEW_TEMPLATE.format(
            language_id=language_id,
            code=code,
            review_summary=review_summary,
            round_index=round_index,
        )

# NOTE: if tree_sitter_languages is unavailable, parsing falls back gracefully.
try:
    from tree_sitter_languages import get_language
    SUPPORTED_LANGUAGES = {
        "python": get_language("python"),
        "javascript": get_language("javascript"),
        "typescript": get_language("typescript"),
        "java": get_language("java"),
    }
    parser = Parser()
except Exception:
    SUPPORTED_LANGUAGES = {}
    parser = None



def compute_hash(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def normalize_language_id(language_id: Optional[str]) -> Optional[str]:
    if not language_id:
        return None
    normalized = language_id.lower()
    aliases = {
        "py": "python",
        "python": "python",
        "js": "javascript",
        "javascript": "javascript",
        "javascriptreact": "javascript",
        "ts": "typescript",
        "typescript": "typescript",
        "typescriptreact": "typescript",
        "java": "java",
    }
    return aliases.get(normalized)


def detect_language_heuristic(file_path: str, code: str) -> str:
    lower_path = file_path.lower()
    if lower_path.endswith(".py"):
        return "python"
    if lower_path.endswith((".ts", ".tsx")):
        return "typescript"
    if lower_path.endswith((".js", ".jsx")):
        return "javascript"
    if lower_path.endswith(".java"):
        return "java"

    trimmed = code.strip()
    if re.search(r'^\s*import\s+java\.', trimmed, re.MULTILINE) or "public class " in code:
        return "java"
    if re.search(r'^\s*def\s+\w+\s*\(', code, re.MULTILINE):
        return "python"
    if re.search(r'interface\s+\w+|:\s*(string|number|boolean)\b', code):
        return "typescript"
    return "javascript"


def detect_language_with_llm(file_path: str, code: str) -> Optional[str]:
    try:
        llm = OpenAI(
            openai_api_base="http://localhost:11434/v1",
            openai_api_key="not-needed",
            model_name="codellama:7b-instruct",
            temperature=0,
            max_tokens=8
        )
        prompt = (
            "请判断下面代码的语言，只返回一个小写单词：python、java、javascript、typescript。\n"
            f"文件路径: {file_path}\n"
            f"代码片段:\n{code[:1500]}"
        )
        raw = str(llm.invoke(prompt)).strip().lower()
        for candidate in ("python", "java", "javascript", "typescript"):
            if candidate in raw:
                return candidate
    except Exception:
        return None
    return None


def resolve_language(language_id: Optional[str], file_path: str, code: str) -> str:
    normalized = normalize_language_id(language_id)
    if normalized in {"python", "java", "javascript", "typescript"}:
        return normalized
    llm_detected = detect_language_with_llm(file_path, code)
    if llm_detected:
        return llm_detected
    return detect_language_heuristic(file_path, code)


def parse_code(language_id: str, code: str) -> CodeIntermediateRepresentation:
    ir = CodeIntermediateRepresentation(
        languageId=language_id,
        filePath='',
        contentHash=compute_hash(code),
        functions=[],
        variables=[],
        controlStructures=[],
        errors=[]
    )
    if parser is None:
        # fallback: no parsing available
        return ir
    try:
        language = SUPPORTED_LANGUAGES.get(language_id)
        if language is None:
            ir.errors.append(f'Unsupported language {language_id}')
            return ir
        parser.set_language(language)
        tree = parser.parse(bytes(code, 'utf8'))
        if tree and tree.root_node and tree.root_node.has_error:
            ir.errors.append(f"Tree-sitter 发现语法问题 ({language_id})")
    except Exception as e:
        ir.errors.append(str(e))
    return ir


def run_pylint(code: str) -> list[RuleIssue]:
    try:
        # write to temp file
        import tempfile
        with tempfile.NamedTemporaryFile('w', suffix='.py', delete=False) as f:
            f.write(code)
            path = f.name
        proc = subprocess.run(['pylint', path, '-f', 'json'], capture_output=True, text=True, timeout=4)
        data = json.loads(proc.stdout) if proc.stdout else []
        issues: list[RuleIssue] = []
        for entry in data:
            issues.append(RuleIssue(
                tool='pylint',
                message=entry.get('message', ''),
                severity=entry.get('type', 'warning'),
                line=entry.get('line', 0),
                column=entry.get('column', 0),
                code=entry.get('symbol', ''),
                highRisk='eval' in entry.get('message', '').lower()
            ))
        return issues
    except Exception:
        return []


def run_eslint(code: str, is_typescript: bool = False) -> list[RuleIssue]:
    try:
        import tempfile
        suffix = '.ts' if is_typescript else '.js'
        with tempfile.NamedTemporaryFile('w', suffix=suffix, delete=False) as f:
            f.write(code)
            path = f.name
        proc = subprocess.run(['npx', 'eslint', path, '-f', 'json'], capture_output=True, text=True, timeout=4)
        data = json.loads(proc.stdout) if proc.stdout else []
        issues: list[RuleIssue] = []
        for entry in data[0].get('messages', []):
            issues.append(RuleIssue(
                tool='eslint',
                message=entry.get('message', ''),
                severity='error' if entry.get('severity', 2) == 2 else 'warning',
                line=entry.get('line', 0),
                column=entry.get('column', 0),
                code=entry.get('ruleId', ''),
                highRisk=entry.get('ruleId', '') in ('no-eval', 'no-implied-eval')
            ))
        return issues
    except Exception:
        return []


def run_checkstyle(code: str) -> list[RuleIssue]:
    try:
        import tempfile
        with tempfile.NamedTemporaryFile('w', suffix='.java', delete=False, encoding='utf-8') as f:
            f.write(code)
            path = f.name
        proc = subprocess.run(['checkstyle', '-f', 'xml', path], capture_output=True, text=True, timeout=6)
        xml_text = proc.stdout or ""
        issues: list[RuleIssue] = []
        for line, col, severity, message, source in re.findall(
            r'<error\s+line="(\d+)"\s+column="(\d+)"\s+severity="(error|warning|info)"\s+message="([^"]+)"\s+source="([^"]*)"',
            xml_text
        ):
            issues.append(RuleIssue(
                tool='checkstyle',
                message=message,
                severity=severity,
                line=int(line),
                column=int(col),
                code=source
            ))
        return issues
    except Exception:
        return []


def run_linters(language_id: str, code: str) -> list[RuleIssue]:
    if language_id == 'python':
        return run_pylint(code)
    if language_id == 'javascript':
        return run_eslint(code, is_typescript=False)
    if language_id == 'typescript':
        return run_eslint(code, is_typescript=True)
    if language_id == 'java':
        return run_checkstyle(code)
    return []


def run_builtin_rules(language_id: str, code: str) -> tuple[list[MergedReviewItem], list[MergedReviewItem], list[MergedReviewItem]]:
    # simple placeholder; real rules could inspect AST
    security = []
    performance = []
    refactor = []
    # example: if "eval" in code -> security
    if 'eval(' in code:
        security.append(MergedReviewItem(
            id='builtin-security-eval',
            source='rule',
            category='security',
            message='使用 eval 可能导致安全问题',
            severity='error',
            line=1,
            column=1
        ))
    return security, performance, refactor





def call_ai_agent(language_id: str, file_path: str, code: str, context_summary: str, syntax: list[str], lint_issues: list[RuleIssue]) -> Optional[AiAnalysisResult]:
    # 直接使用 OpenAI 调用模型
    try:
        # 配置 LLM - 这里假设使用本地 CodeLlama 服务，或可替换为 OpenAI
        llm = OpenAI(
            openai_api_base="http://localhost:11434/v1",  # Ollama 默认地址
            openai_api_key="not-needed",  # Ollama 不需要 key
            model_name="codellama:7b-instruct",
            temperature=0.7,
            max_tokens=2048
        )

        # 构建检索查询
        query = f"代码审查: {language_id} 文件 {file_path} 内容: {code[:500]}..."
        # 搜索相关文档
        relevant_docs = vector_store.search(query, k=3)
        
        # 构建检索上下文
        retrieval_context = ""
        if relevant_docs:
            retrieval_context = "检索到的相关信息:\n"
            for doc in relevant_docs:
                source = doc.get('metadata', {}).get('source', 'unknown')
                path = doc.get('metadata', {}).get('path', 'unknown')
                content = doc.get('content', '')[:300]  # 限制内容长度
                retrieval_context += f"[来源: {source} - {path}]\n{content}...\n\n"

        # 准备输入
        lint_str = "; ".join([f"[{issue.tool}] {issue.message}" for issue in lint_issues])
        syntax_str = "; ".join(syntax)

        few_shot_examples = get_few_shot_examples()

        # 构建提示（Few-shot）
        prompt = f"""
        你是一个专业的代码审查助手，需要对以下代码进行全面分析：

        下面是高质量输出示例（few-shot），请严格参考其风格、粒度和类别标注方式：
        {few_shot_examples}

        语言: {language_id}
        文件路径: {file_path}

        上下文信息: {context_summary}

        语法错误: {syntax_str}

        规范问题: {lint_str}

        {retrieval_context}

        代码片段:
        {code}

        请按照以下维度进行分析：
        1. 安全漏洞识别：检测潜在的安全问题，如注入攻击、XSS、命令执行等
        2. 性能优化建议：识别性能瓶颈，如循环效率、内存使用等
        3. 重构方案生成：提出代码结构改进建议，如长函数拆分、重复代码提取等
        4. 代码规范检查：确保代码符合最佳实践和编码规范

        请提供详细的分析结果，包括问题位置、原因分析和改进建议。对于每个问题，请指明具体的行号（如果可能）和修复方案。
        输出时请尽量使用以下格式逐行给出：
        - [security|performance|refactor|style|syntax] 具体建议
        """

        # 直接调用模型
        raw = llm.invoke(prompt)
        # 解析结果
        items = parse_ai_response(raw)
        return AiAnalysisResult(summary="AI 分析完成", items=items, raw=raw)

    except Exception as e:
        print(f"AI call failed: {e}")
        return None


def parse_ai_response(raw_response: str) -> list[AiSuggestionItem]:
    # 简单的解析逻辑，可以扩展为更智能的解析
    items = []
    categories = {
        '安全': 'security',
        '性能': 'performance',
        '重构': 'refactor',
        '规范': 'style',
        '语法': 'syntax'
    }

    lines = str(raw_response).split('\n')
    current_category = 'style'
    for line in lines:
        line = line.strip()
        if not line:
            continue
        # 检查是否是类别标题
        for key, cat in categories.items():
            if key in line:
                current_category = cat
                break
        # 如果是建议行
        if line.startswith('-') or line.startswith('•') or line.startswith('*'):
            payload = line[1:].strip()
            bracket_match = re.match(r'^\[(security|performance|refactor|style|syntax)\]\s*(.+)$', payload, re.IGNORECASE)
            if bracket_match:
                cat = bracket_match.group(1).lower()
                desc = bracket_match.group(2).strip()
                items.append(AiSuggestionItem(category=cat, description=desc))
            else:
                items.append(AiSuggestionItem(category=current_category, description=payload))
    return items


def merge_items(*lists) -> list[MergedReviewItem]:
    seen = {}
    result: list[MergedReviewItem] = []
    for lst in lists:
        for item in lst:
            key = (item.category, item.line, item.message)
            if key not in seen:
                seen[key] = True
                result.append(item)
    # no priority sort for simplicity
    return result


def linter_issue_to_item(issue: RuleIssue, idx: int) -> MergedReviewItem:
    text = (issue.message or "").lower()
    category = "style"
    if issue.highRisk or "security" in text or "injection" in text or "eval" in text:
        category = "security"
    elif "performance" in text or "inefficient" in text:
        category = "performance"
    return MergedReviewItem(
        id=f'rule-{idx}',
        source='rule',
        category=category,
        message=issue.message,
        severity=issue.severity,
        line=issue.line,
        column=issue.column,
        tool=issue.tool
    )


def ai_items_to_merged(ai_items: list[AiSuggestionItem], prefix: str) -> list[MergedReviewItem]:
    converted: list[MergedReviewItem] = []
    for i, item in enumerate(ai_items):
        converted.append(MergedReviewItem(
            id=f'{prefix}-{i}',
            source='ai',
            category=item.category,
            message=item.description,
            severity='error' if item.category == 'security' else 'warning',
            line=item.line or 0,
            column=0,
            exampleCode=item.exampleCode
        ))
    return converted


def reflect_on_review(language_id: str, code: str, base_items: list[MergedReviewItem], round_index: int) -> Optional[list[MergedReviewItem]]:
    """单轮反思：让AI评估当前审查结果并补充/修正建议"""
    try:
        llm = OpenAI(
            openai_api_base="http://localhost:11434/v1",
            openai_api_key="not-needed",
            model_name="codellama:7b-instruct",
            temperature=0.3,
            max_tokens=2048
        )

        review_summary = "\n".join([f"[{item.category.upper()}] {item.message}" for item in base_items[:80]])

        prompt = render_self_review_prompt(language_id, code, review_summary, round_index)

        raw = llm.invoke(prompt)
        items = parse_ai_response(raw)
        return ai_items_to_merged(items, f'reflected-r{round_index}')
    except Exception as e:
        print(f"Reflection failed: {e}")
        return None


def produce_review(input: AgentReviewInput) -> FileReviewResult:
    start = time.time()
    detected_language = resolve_language(input.languageId, input.filePath, input.code)
    ir = parse_code(detected_language, input.code)
    rule_issues = run_linters(detected_language, input.code)
    security, performance, refactor = run_builtin_rules(detected_language, input.code)
    ai_result = call_ai_agent(detected_language, input.filePath, input.code, '', ir.errors, rule_issues)
    ai_items = ai_items_to_merged(ai_result.items, 'ai') if ai_result else []
    
    # 初始审查结果
    initial_items = merge_items(
        [MergedReviewItem(id=f'syntax-{i}', source='rule', category='syntax', message=e, severity='error', line=0, column=0) for i, e in enumerate(ir.errors)],
        [linter_issue_to_item(ri, i) for i, ri in enumerate(rule_issues)],
        security, performance, refactor, ai_items
    )

    # 最多 3 轮自我审查
    merged = initial_items
    reflection_total = 0
    for round_index in range(1, SELF_REVIEW_MAX_ROUNDS + 1):
        reflected_items = reflect_on_review(detected_language, input.code[:12000], merged, round_index)
        if not reflected_items:
            continue
        before = len(merged)
        merged = merge_items(merged, reflected_items)
        added = len(merged) - before
        if added > 0:
            reflection_total += added
            if ai_result:
                ai_result.items.extend([AiSuggestionItem(category=item.category, description=item.message, line=item.line) for item in reflected_items])
        # 连续轮次没有新增时提前收敛
        if added == 0:
            break

    if ai_result:
        ai_result.summary = f"{ai_result.summary} (few-shot + 自我审查{SELF_REVIEW_MAX_ROUNDS}轮, 新增{reflection_total}项)"
    
    result = FileReviewResult(
        uri=f'file://{input.filePath}', filePath=input.filePath, contentHash=ir.contentHash,
        timestamp=time.time(), ir=ir,
        ruleIssues=rule_issues, aiResult=ai_result, mergedItems=merged
    )
    elapsed = (time.time()-start)*1000
    print(f'agent processed in {elapsed:.1f}ms')
    return result

def produce_fix(input: AgentReviewInput) -> dict:
    """生成修复后的代码"""
    start = time.time()
    
    # 首先进行审查，获取问题列表
    review_result = produce_review(input)
    
    # 构建修复提示
    issues = []
    for item in review_result.mergedItems:
        issues.append({
            'category': item.category,
            'message': item.message,
            'line': item.line,
            'severity': item.severity
        })
    
    # 调用AI生成修复代码
    fixed_code = call_ai_fix(input.languageId, input.filePath, input.code, issues)
    
    elapsed = (time.time()-start)*1000
    
    return {
        'fixed_code': fixed_code,
        'issues': issues,
        'execution_time': {
            'total': elapsed
        }
    }

def call_ai_fix(language_id: str, file_path: str, code: str, issues: list) -> str:
    """调用AI生成修复代码"""
    try:
        # 配置LLM
        llm = OpenAI(
            openai_api_base="http://localhost:11434/v1",
            openai_api_key="not-needed",
            model_name="codellama:7b-instruct",
            temperature=0.7,
            max_tokens=4096
        )
        
        # 构建问题描述
        issues_description = "\n".join([f"- [{item['category']}] {item['message']} (第{item['line']}行)" for item in issues])
        
        # 构建修复提示
        prompt = f"""
        你是一个专业的代码修复助手，需要根据以下问题列表修复代码：
        
        语言: {language_id}
        文件路径: {file_path}
        
        问题列表:
        {issues_description}
        
        原始代码:
        {code}
        
        请生成修复后的完整代码，确保：
        1. 修复所有列出的问题
        2. 保持代码的原始功能不变
        3. 代码风格一致
        4. 修复后的代码应该可以直接运行
        
        只返回修复后的完整代码，不要包含任何其他说明。
        """
        
        # 调用模型
        raw = llm.invoke(prompt)
        
        # 提取修复后的代码
        # 尝试从响应中提取代码块
        import re
        code_match = re.search(r'```[a-zA-Z0-9]*\n(.*?)```', raw, re.DOTALL)
        if code_match:
            return code_match.group(1).strip()
        else:
            # 如果没有代码块，返回整个响应
            return raw.strip()
            
    except Exception as e:
        print(f"AI fix call failed: {e}")
        # 失败时返回原始代码
        return code
