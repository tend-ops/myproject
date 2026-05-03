"""
契约测试：校验 FastAPI Agent 的请求/响应解析与 produce_fix 在带 issues 时跳过全量审查。
运行（仓库根目录）:
  pip install -r requirements-dev.txt
  set PYTHONPATH=.   # PowerShell: $env:PYTHONPATH='.'
  pytest tests/test_agent_contract.py -v
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from review_agent.agent_types import (  # noqa: E402
    AgentReviewInput,
    FileReviewResult,
    FixIssuePayload,
    MergedReviewItem,
)


def test_agent_review_input_parses_optional_issues():
    inp = AgentReviewInput(
        languageId="python",
        filePath="a.py",
        code="x=1",
        issues=[FixIssuePayload(category="security", message="bad", line=3, severity="error")],
    )
    assert inp.issues is not None and len(inp.issues) == 1
    assert inp.issues[0].line == 3


@patch("review_agent.agent_logic.produce_review")
@patch("review_agent.agent_logic.call_ai_fix")
def test_produce_fix_skips_review_when_issues_provided(mock_fix, mock_review):
    from review_agent import agent_logic

    mock_fix.return_value = ("print('ok')\n", {"validated": True})

    inp = AgentReviewInput(
        languageId="python",
        filePath="demo.py",
        code="bad()",
        issues=[
            FixIssuePayload(category="style", message="fix me", line=2, severity="warning"),
        ],
    )
    result = agent_logic.produce_fix(inp)

    mock_review.assert_not_called()
    mock_fix.assert_called_once()
    assert result["fixed_code"] == "print('ok')\n"
    assert len(result["issues"]) == 1
    assert result["issues"][0]["line"] == 2


@patch("review_agent.server.produce_review")
def test_http_review_returns_json_matching_file_review_result(mock_produce):
    from fastapi.testclient import TestClient

    import review_agent.server as srv

    merged = [
        MergedReviewItem(
            id="rule-1",
            source="rule",
            category="security",
            message="eval risk",
            severity="error",
            line=10,
            column=0,
        )
    ]
    mock_produce.return_value = FileReviewResult(
        uri="file:///x/a.py",
        filePath="a.py",
        contentHash="abc",
        timestamp=1710000000.0,
        ir=None,
        ruleIssues=[],
        aiResult=None,
        mergedItems=merged,
    )

    client = TestClient(srv.app)
    r = client.post(
        "/review",
        json={
            "languageId": "python",
            "filePath": "a.py",
            "code": "eval('1')",
        },
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert "mergedItems" in data
    assert len(data["mergedItems"]) == 1
    assert data["mergedItems"][0]["category"] == "security"
    assert data["mergedItems"][0]["line"] == 10


@patch("review_agent.server.produce_fix")
def test_http_fix_accepts_issues_in_body(mock_fix):
    from fastapi.testclient import TestClient

    import review_agent.server as srv

    mock_fix.return_value = {
        "fixed_code": "pass",
        "issues": [{"category": "syntax", "message": "m", "line": 1, "severity": "error"}],
        "fix_meta": {},
        "execution_time": {"total": 1.2},
    }

    client = TestClient(srv.app)
    r = client.post(
        "/fix",
        json={
            "languageId": "python",
            "filePath": "b.py",
            "code": "x",
            "issues": [
                {"category": "syntax", "message": "m", "line": 1, "severity": "error"},
            ],
        },
    )
    assert r.status_code == 200, r.text
    args0 = mock_fix.call_args.args[0]
    assert getattr(args0, "issues", None), "produce_fix must receive parsed issues list"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
