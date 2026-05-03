import hashlib
import os
import subprocess
import json
import time
import re
from pathlib import Path
from typing import Optional, Any
from tree_sitter import Parser
from langchain_openai import OpenAI
from .types import (CodeIntermediateRepresentation, RuleIssue, FileReviewResult, MergedReviewItem,
                    AiAnalysisResult, AiSuggestionItem, AgentReviewInput)
from .vector_store import vector_store

# 自我审查轮次：每轮一次 LLM 调用；默认为 1 以兼顾速度与稳定性（可通过环境变量覆盖）
SELF_REVIEW_MAX_ROUNDS = int(os.environ.get("REVIEW_AGENT_SELF_REVIEW_ROUNDS", "1"))
MAX_CODE_CHARS_MAIN_REVIEW = int(os.environ.get("REVIEW_AGENT_MAX_CODE_CHARS", "12000"))
ENABLE_VECTOR_RAG = os.environ.get("REVIEW_AGENT_ENABLE_RAG", "").strip().lower() in {"1", "true", "yes"}

VALID_AI_CATEGORIES = frozenset({"security", "performance", "refactor", "style", "syntax"})
PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"
DEFAULT_FEWSHOT_PATH = PROMPTS_DIR / "fewshot_review.md"
DEFAULT_SELF_REVIEW_PATH = PROMPTS_DIR / "self_review.md"
DEFAULT_FEW_SHOT_EXAMPLES = """
语言: python
代码:
eval(input("cmd:"))
输出:
[{"category":"security","line":1,"message":"禁止对用户输入使用 eval，应使用白名单或安全解析接口"}]
""".strip()
DEFAULT_SELF_REVIEW_TEMPLATE = (
    "请以 JSON 数组输出新增审查项（无则 []），每项含 category,line,message。\n"
    "语言: {language_id}\n代码:\n{code}\n已有结果:\n{review_summary}\n轮次:{round_index}\n"
)

LANGUAGE_REVIEW_FOCUS: dict[str, str] = {
    "python": (
        "Python：输入校验、eval/exec/subprocess 与 shell=True、Pickle、反序列化、SQL 拼接注入、密钥硬编码、"
        "资源未关闭（with）、裸露 except、可变默认参数、日志敏感信息。"
    ),
    "javascript": (
        "JavaScript 重点：eval/Function构造器、innerHTML/DOM XSS、明文密钥、异步错误未处理"
        "、== 与宽松相等、服务端模板注入前端场景、正则 ReDoS、依赖供应链敏感 API。"
    ),
    "typescript": (
        "TypeScript：除 JS 安全风险外，关注 any 泛滥、断言掩盖空值、非空假设与运行时脱节、"
        "泛型/API 契约错误。"
    ),
    "java": (
        "Java 重点：SQL/JPQL 字符串拼接注入、JNI/反序列化、路径遍历 Files/Paths、"
        "并发可见性、资源未 try-with-resources、equals/hashCode 契约、敏感日志。"
    ),
}


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


def _find_java_sql_concat_line(src: str) -> int:
    for i, line in enumerate(src.splitlines(), start=1):
        if '+' in line and re.search(r'execute(Query|Update)\(', line, re.IGNORECASE):
            return i
    return 1


def run_builtin_rules(language_id: str, code: str) -> tuple[list[MergedReviewItem], list[MergedReviewItem], list[MergedReviewItem]]:
    security: list[MergedReviewItem] = []
    performance: list[MergedReviewItem] = []
    refactor: list[MergedReviewItem] = []
    lowered = code.lower()

    def add_security(line_hint: int, msg: str, rid: str) -> None:
        security.append(
            MergedReviewItem(
                id=rid, source='rule', category='security', message=msg,
                severity='error', line=line_hint or 1, column=1
            )
        )

    if 'eval(' in code:
        line_no = code[: code.find('eval(')].count('\n') + 1
        add_security(line_no, '检测到 eval(...) 调用，存在任意代码执行风险', 'builtin-security-eval')

    if language_id == 'python' and re.search(r'\bexec\s*\(', code) and not re.search(r'^\s*#.*\bexec\s*\(', code, re.MULTILINE):
        ix = max(code.find('exec('), 0)
        add_security(code[:ix].count('\n') + 1, 'exec 可能被滥用于代码注入，应避免对用户输入或可变字符串执行 exec', 'builtin-py-exec')

    if language_id in {'javascript', 'typescript'}:
        if re.search(r'\binnerHTML\s*=', code):
            refactor.append(MergedReviewItem(
                id='builtin-dom-innerhtml',
                source='rule', category='refactor', message='直接赋值 innerHTML 可能导致 XSS，建议 textContent、DOMPurify 或框架安全绑定',
                severity='warning', line=1, column=1,
            ))
        if 'document.write(' in lowered:
            add_security(1, 'document.write 存在 XSS 与性能隐患，应避免', 'builtin-js-docwrite')

    if language_id == 'java':
        if 'createstatement()' in lowered and re.search(r'execute(Query|Update)\(\s*"[^"]*"\s*\+', code, re.IGNORECASE):
            add_security(
                _find_java_sql_concat_line(code),
                '检测到 Statement 与字符串拼接 SQL，存在注入风险；应使用 PreparedStatement 绑定参数',
                'builtin-java-sql-inject'
            )
        if 'objectinputstream' in lowered:
            security.append(MergedReviewItem(
                id='builtin-java-deser',
                source='rule', category='security', message='反序列化入口需白名单校验与最小权限',
                severity='warning', line=1, column=1,
            ))

    return security, performance, refactor




def _llm(low_temp: float, max_tokens: int) -> OpenAI:
    return OpenAI(
        openai_api_base=os.environ.get("OLLAMA_OPENAI_BASE", "http://localhost:11434/v1"),
        openai_api_key=os.environ.get("OPENAI_API_KEY", "not-needed"),
        model_name=os.environ.get("REVIEW_AGENT_MODEL", "codellama:7b-instruct"),
        temperature=low_temp,
        max_tokens=max_tokens,
    )


def language_focus(language_id: str) -> str:
    return LANGUAGE_REVIEW_FOCUS.get(language_id, LANGUAGE_REVIEW_FOCUS.get("javascript", ""))


def _strip_json_fence(text: str) -> str:
    t = str(text).strip()
    if not t:
        return t
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", t, re.IGNORECASE | re.DOTALL)
    if m:
        return m.group(1).strip()
    return t


def _extract_first_json_array(text: str) -> Optional[list]:
    cleaned = _strip_json_fence(text)
    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        return json.loads(cleaned[start : end + 1])
    except Exception:
        return None


def _items_from_json_array(data: list) -> list[AiSuggestionItem]:
    out: list[AiSuggestionItem] = []
    for entry in data:
        if not isinstance(entry, dict):
            continue
        cat = str(entry.get("category", "style")).lower().strip()
        if cat not in VALID_AI_CATEGORIES:
            cat = "style"
        msg_raw = entry.get("message") or entry.get("description") or ""
        msg = str(msg_raw).strip().replace("\n", " ")
        if len(msg) < 4:
            continue
        line_val = entry.get("line")
        try:
            line_no = int(line_val) if line_val is not None else 0
        except Exception:
            line_no = 0
        out.append(AiSuggestionItem(category=cat, description=msg, line=max(0, line_no)))
    return out


def parse_ai_review_json_first(raw_response: Any) -> list[AiSuggestionItem]:
    txt = raw_response if isinstance(raw_response, str) else str(raw_response)
    data = _extract_first_json_array(txt)
    if data is not None and isinstance(data, list):
        return _items_from_json_array(data)
    return []


def parse_ai_response_line_fallback(raw_response: str) -> list[AiSuggestionItem]:
    items: list[AiSuggestionItem] = []
    cats_zh = {'安全': 'security', '性能': 'performance', '重构': 'refactor', '规范': 'style', '语法': 'syntax'}
    lines = str(raw_response).split('\n')
    current_category = 'style'
    for line in lines:
        line = line.strip()
        if not line:
            continue
        for key, cat in cats_zh.items():
            if key in line:
                current_category = cat
                break
        if line.startswith('-') or line.startswith('•') or line.startswith('*'):
            payload = line[1:].strip()
            bracket_match = re.match(
                r'^\[(security|performance|refactor|style|syntax)\]\s*(.+)$', payload, re.IGNORECASE
            )
            if bracket_match:
                cat = bracket_match.group(1).lower()
                desc = bracket_match.group(2).strip()
                items.append(AiSuggestionItem(category=cat, description=desc))
            else:
                items.append(AiSuggestionItem(category=current_category, description=payload))
    return items


def parse_ai_response(raw_response: Any) -> list[AiSuggestionItem]:
    parsed = parse_ai_review_json_first(raw_response)
    if parsed:
        return parsed
    return parse_ai_response_line_fallback(str(raw_response))


def call_ai_agent(language_id: str, file_path: str, code: str, context_summary: str, syntax: list[str], lint_issues: list[RuleIssue]) -> Optional[AiAnalysisResult]:
    try:
        max_review_tokens = min(1536, int(os.environ.get("REVIEW_AGENT_MAX_REVIEW_TOKENS", "1536")))
        llm = _llm(low_temp=0.08, max_tokens=max_review_tokens)

        retrieval_context = ""
        if ENABLE_VECTOR_RAG:
            query = f"审查 {language_id} {file_path} {code[:400]}"
            relevant_docs = vector_store.search(query, k=3)
            if relevant_docs:
                retrieval_context = "检索补充:\n"
                for doc in relevant_docs:
                    retrieval_context += doc.get('content', '')[:220] + "\n"

        lint_str = "; ".join([f"{issue.tool}:{issue.message}(L{issue.line})" for issue in lint_issues[:40]])
        syntax_str = "; ".join(syntax[:20])
        few_shot = get_few_shot_examples()
        code_body = code[:MAX_CODE_CHARS_MAIN_REVIEW]
        focus = language_focus(language_id)

        prompt = f"""你是静态代码审查工具。只输出 JSON 数组；禁止 Markdown、解释、前缀与代码围栏。

规则：
1) JSON 数组元素字段：category（小写 security|performance|refactor|style|syntax）、line（整数，未知为0）、message（单行建议）。
2) 勿虚构行号；无法指向具体行则用 line=0。
3) 不重复 Linter 原句时可补充根因/fix 方向。
4) 仅报告在当前代码中能成立的问题；若没有则输出 []。

语言: {language_id}
文件: {file_path}
该语言侧重点: {focus}

解析/语法摘要: {syntax_str}
Linter: {lint_str}
{retrieval_context}
上下文: {context_summary}

Few-shot（形态必须一致）:
{few_shot}

代码:
{code_body}
"""

        raw = llm.invoke(prompt)
        raw_txt = _ensure_text(raw)
        items = parse_ai_response(raw_txt)
        return AiAnalysisResult(summary="AI JSON 审查完成", items=items, raw=raw_txt)
    except Exception as e:
        print(f"AI call failed: {e}")
        return None


def _ensure_text(raw: Any) -> str:
    """LangChain/OpenAI 兼容：AIMessage.content 可能是 str。"""
    if isinstance(raw, str):
        return raw
    content = getattr(raw, "content", None)
    if isinstance(content, str):
        return content
    return str(raw)


def merge_items(*lists) -> list[MergedReviewItem]:
    seen = {}
    result: list[MergedReviewItem] = []
    for lst in lists:
        for item in lst:
            key = (item.category, item.line, item.message)
            if key not in seen:
                seen[key] = True
                result.append(item)
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
    """单轮反思：补充 JSON 建议；低温 + 短文以降低漂移。"""
    try:
        llm = _llm(low_temp=0.06, max_tokens=768)
        review_summary = "\n".join([f"[{item.category.upper()} L{item.line}] {item.message}" for item in base_items[:60]])
        prompt = render_self_review_prompt(language_id, code[:MAX_CODE_CHARS_MAIN_REVIEW], review_summary, round_index)

        raw = llm.invoke(prompt)
        items = parse_ai_response(_ensure_text(raw))
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

    # 自我审查（轮次由环境变量控制，默认 1）
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
        ai_result.summary = (
            f"{ai_result.summary}（自我审查最多{SELF_REVIEW_MAX_ROUNDS}轮，新增{reflection_total}项）"
        )
    
    result = FileReviewResult(
        uri=f'file://{input.filePath}', filePath=input.filePath, contentHash=ir.contentHash,
        timestamp=time.time(), ir=ir,
        ruleIssues=rule_issues, aiResult=ai_result, mergedItems=merged
    )
    elapsed = (time.time()-start)*1000
    print(f'agent processed in {elapsed:.1f}ms')
    return result



def produce_fix(input: AgentReviewInput) -> dict:
    """生成修复代码：若请求体含 issues，则跳过重复审查以提速。"""
    start = time.time()
    detected_language = resolve_language(input.languageId, input.filePath, input.code)

    if input.issues and len(input.issues) > 0:
        issues: list[dict[str, Any]] = [
            {
                "category": it.category or "style",
                "message": it.message or "",
                "line": int(it.line or 0),
                "severity": it.severity or "warning",
            }
            for it in input.issues
        ]
    else:
        review_result = produce_review(input)
        issues = [
            {
                "category": item.category,
                "message": item.message,
                "line": item.line,
                "severity": item.severity,
            }
            for item in review_result.mergedItems
        ]

    fixed_code, fix_meta = call_ai_fix(detected_language, input.filePath, input.code, issues)
    elapsed = (time.time() - start) * 1000
    return {
        "fixed_code": fixed_code,
        "issues": issues,
        "fix_meta": fix_meta,
        "execution_time": {"total": elapsed},
    }


def _fence_tag(language_id: str) -> str:
    return {
        "python": "python",
        "javascript": "javascript",
        "typescript": "typescript",
        "java": "java",
    }.get(language_id, "text")


def _extract_code_from_llm(text: Any, language_id: str) -> str:
    s = text if isinstance(text, str) else str(text)
    tag = _fence_tag(language_id)
    patterns = [
        rf"```{tag}\s*([\s\S]*?)```",
        r"```(?:py|python|javascript|typescript|tsx|jsx|java)\s*([\s\S]*?)```",
        r"```\s*([\s\S]*?)```",
    ]
    for p in patterns:
        m = re.search(p, s, re.IGNORECASE | re.DOTALL)
        if m:
            body = m.group(1).strip()
            if len(body) >= 8:
                return body
    return s.strip()


def _python_compiles(snippet: str) -> bool:
    try:
        compile(snippet, "<fixed>", "exec")
        return True
    except SyntaxError:
        return False


def _fix_plausible(orig: str, fixed: str) -> tuple[bool, str]:
    o, f = orig.strip(), fixed.strip()
    if not f:
        return False, "empty"
    if len(o) > 48 and len(f) < len(o) * 0.22:
        return False, "too_short_vs_original"
    ratio = len(f) / max(len(o), 1)
    if ratio > 4.5 and len(o) > 400:
        return False, "likely_truncated_or_verbose"
    return True, ""


def _severity_key(issue: dict) -> tuple:
    s = str(issue.get("severity") or "info").lower()
    sr = {"error": 0, "warning": 1, "info": 2}.get(s, 2)
    cat = issue.get("category") or ""
    ck = {"security": 0, "syntax": 1, "performance": 2, "refactor": 3, "style": 4}.get(cat, 5)
    return sr, ck


def apply_deterministic_fixes(code: str, language_id: str, issues: list[dict]) -> tuple[str, list[str]]:
    """模型不可靠时的保守改写（注释/占位/明显替换）。"""
    notes: list[str] = []
    lines = code.splitlines()
    per_line: dict[int, str] = {}
    for it in issues:
        try:
            ln = int(it.get("line") or 0)
        except Exception:
            ln = 0
        if ln < 1:
            continue
        per_line[ln] = per_line.get(ln, "") + " " + str(it.get("message") or "")

    for lineno in sorted(per_line.keys(), reverse=True):
        if lineno > len(lines):
            continue
        msg_l = per_line[lineno].lower()
        line = lines[lineno - 1]

        if language_id == "python":
            if ("eval" in msg_l or "eval(" in line) and "literal_eval" not in line and "eval(" in line:
                lines[lineno - 1] = re.sub(r"\beval\s*\(", "ast.literal_eval(", line, count=1)
                notes.append(f"L{lineno}: eval→literal_eval（仅适用于可信字面量）")
        elif language_id in {"javascript", "typescript"}:
            if "eval(" in line and not line.strip().startswith("//"):
                lines[lineno - 1] = "// FIXME: avoid eval — replace with safe API\n" + line
                notes.append(f"L{lineno}: 标注 eval")
        elif language_id == "java":
            if "preparedstatement" in msg_l or "注入" in msg_l or ("sql" in msg_l and "+" in line):
                if "// TODO: use PreparedStatement" not in line:
                    indent = re.match(r"^(\s*)", line)
                    ind = indent.group(1) if indent else ""
                    lines[lineno - 1] = ind + "// TODO: use PreparedStatement + bound parameters\n" + line
                    notes.append(f"L{lineno}: SQL 占位注释")

    out = "\n".join(lines)
    if language_id == "python" and "literal_eval(" in out and not re.search(r"^(\s*)import\s+ast\b", out, re.MULTILINE):
        out = "import ast\n\n" + out
        notes.append("inserted import ast")
    return out, notes


def _build_fix_prompt(language_id: str, file_path: str, orig: str, issues_block: str, reminder: str) -> str:
    tag = _fence_tag(language_id)
    fence = "```"
    nl = "\n"
    return (
        "你是源代码修复引擎。输出必须能被正则直接提取。\n\n"
        "硬性要求：\n"
        f"1) 第一行必须为：{fence}{tag}\n"
        "2) 接着输出修正后的完整源文件正文（不要用「省略」占位整段删除）\n"
        "3) 最后一行必须为：单独一行闭合围栏（三个反引号）\n"
        "4) 围栏之外禁止任何其它字符。\n"
        f"5) 语言 {language_id}；保持语义、入口签名与导出不变。\n"
        f"{reminder}\n\n"
        f"待处理问题：\n{issues_block}\n\n"
        f"文件路径: {file_path}\n\n--- ORIGINAL ---{nl}{orig}{nl}"
    )


def call_ai_fix(language_id: str, file_path: str, code: str, issues: list) -> tuple[str, dict[str, Any]]:
    meta: dict[str, Any] = {"attempts": [], "validated": False, "deterministic_notes": []}
    if not issues:
        return code, meta

    sorted_issues = sorted([dict(i) for i in issues], key=_severity_key)[:40]
    issues_block = "\n".join(
        f"- [{i.get('category')}] sev={i.get('severity')} L{i.get('line')} :: {i.get('message')}"
        for i in sorted_issues
    )
    orig = code[:80000]

    prompts = (
        _build_fix_prompt(language_id, file_path, orig, issues_block, ""),
        _build_fix_prompt(
            language_id,
            file_path,
            orig,
            issues_block,
            reminder="上一轮若失败：严守单围栏输出；仍需完整文件。"
        ),
    )

    llm = _llm(low_temp=0.12, max_tokens=min(6144, int(os.environ.get("REVIEW_AGENT_MAX_FIX_TOKENS", "6144"))))

    best = ""
    for i, prompt in enumerate(prompts, start=1):
        try:
            raw = llm.invoke(prompt)
            candidate = _extract_code_from_llm(_ensure_text(raw), language_id)
            ok, why = _fix_plausible(orig, candidate)
            py_ok = language_id != "python" or _python_compiles(candidate)
            meta["attempts"].append({"n": i, "plausible": ok, "reason": why, "python_ok": py_ok})

            if ok and py_ok:
                meta["validated"] = True
                best = candidate
                break
            if not best:
                best = candidate
            elif (
                language_id == "python"
                and py_ok
                and (not best or not _python_compiles(best))
            ):
                best = candidate
        except Exception as e:
            meta["attempts"].append({"n": i, "error": str(e)})

    if not best:
        det, notes = apply_deterministic_fixes(orig, language_id, sorted_issues)
        meta["deterministic_notes"] = notes
        return det if det != orig else orig, meta

    if meta["validated"]:
        return best, meta

    det_overlay, overlay_notes = apply_deterministic_fixes(best, language_id, sorted_issues)
    meta["deterministic_notes"].extend(overlay_notes)

    if language_id == "python" and not _python_compiles(best):
        det_orig, n2 = apply_deterministic_fixes(orig, language_id, sorted_issues)
        meta["deterministic_notes"].extend(n2)
        return det_orig if det_orig != orig else best, meta

    return det_overlay, meta
