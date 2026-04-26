from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List
from .types import AgentReviewInput, FileReviewResult
from .agent_logic import produce_review, produce_fix
from .vector_store import index_project_files, vector_store
import time
from concurrent.futures import ThreadPoolExecutor

app = FastAPI(title="Smart Code Review AI Agent")


class IndexProjectInput(BaseModel):
    project_path: str

@app.post("/review", response_model=FileReviewResult)
async def review(input: AgentReviewInput):
    try:
        result = produce_review(input)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/batch-review")
async def batch_review(inputs: List[AgentReviewInput]):
    try:
        start_time = time.time()
        results = []
        
        # 使用线程池并行处理
        with ThreadPoolExecutor(max_workers=4) as executor:
            results = list(executor.map(produce_review, inputs))
        
        # 汇总结果
        summary = {
            "total_files": len(results),
            "total_issues": sum(len(r.mergedItems) for r in results),
            "by_category": {}
        }
        
        # 按类别统计
        for result in results:
            for item in result.mergedItems:
                if item.category not in summary["by_category"]:
                    summary["by_category"][item.category] = 0
                summary["by_category"][item.category] += 1
        
        return {
            "results": results,
            "summary": summary,
            "execution_time": {
                "total": time.time() - start_time
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/index-project")
async def index_project(input: IndexProjectInput):
    try:
        index_project_files(input.project_path)
        return {"status": "success", "message": f"Indexed project at {input.project_path}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/clear-index")
async def clear_index():
    try:
        vector_store.clear_collection()
        return {"status": "success", "message": "Index cleared"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# quick health check
@app.get("/ping")
def ping():
    return {"status": "ok"}

@app.get("/status")
def status():
    return {"status": "ok", "message": "AI Agent is running"}

@app.post("/fix")
async def fix(input: AgentReviewInput):
    try:
        # 生成修复后的代码
        result = produce_fix(input)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
