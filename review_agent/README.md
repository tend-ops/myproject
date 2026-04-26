# Review Agent for Smart Code Review

This directory contains a lightweight FastAPI-based agent service that performs
code review logic and can be used by the VS Code extension.

## Setup

```bash
cd review_agent
python -m venv .venv
source .venv/bin/activate       # or `.\.venv\Scripts\activate` on Windows
pip install -r requirements.txt
```

## Running

```bash
uvicorn server:app --host 0.0.0.0 --port 5000
```

The service listens for POST requests at `/review` with a JSON body matching
`AgentReviewInput` (see `types.py`). It returns a `FileReviewResult` object.

Example using `curl`:

```bash
curl -X POST http://localhost:5000/review -H "Content-Type: application/json" -d '{"languageId":"python","filePath":"/tmp/foo.py","code":"print(\"hi\")"}'
```

## LangChain Integration

The agent now uses LangChain for AI model interactions, providing:

- **Structured Prompting**: Uses `PromptTemplate` for consistent, context-aware prompts
- **Chain-based Execution**: Leverages `LLMChain` for reliable model calls
- **Output Parsing**: Employs `PydanticOutputParser` to automatically translate model responses into typed `AiSuggestionItem` instances, with schema validation and a fallback parser for robustness
- **Flexible Model Support**: Configured for local CodeLlama via Ollama, but can be adapted for OpenAI or other providers
- **Response Parsing**: Intelligent parsing of AI responses into categorized suggestions

To use different models, modify the `llm` configuration in `agent_logic.py`:

```python
# For OpenAI
llm = OpenAI(model_name="gpt-4", openai_api_key="your-key")

# For local Ollama
llm = OpenAI(openai_api_base="http://localhost:11434/v1", model_name="codellama:7b-instruct")
```

## Internal logic

- **Parsing**: optionally uses `tree_sitter` to generate an IR and collect syntax errors.
- **Linters**: calls external commands (`pylint`, `eslint` via `npx`) and
  normalizes output.
- **Builtin rules**: simple heuristics implemented in `agent_logic.py`.
- **AI analysis**: uses LangChain to call the configured LLM and parse responses.
- **Few-shot templates**: review examples are loaded from `review_agent/prompts/fewshot_review.md`.
- **Self-review templates**: iterative self-check prompt is loaded from `review_agent/prompts/self_review.md`.

## Prompt templates

- Edit `review_agent/prompts/fewshot_review.md` to customize few-shot examples.
- Edit `review_agent/prompts/self_review.md` to customize self-review prompt.
- Keep output examples in this format for best parsing stability:
  `- [security|performance|refactor|style|syntax] 建议内容`
- Self-review template placeholders: `{round_index}`, `{language_id}`, `{code}`, `{review_summary}`.

If the agent service is unavailable or returns an error, the VS Code extension
will fall back to its built-in TypeScript implementation.
