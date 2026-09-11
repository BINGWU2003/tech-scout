"""Local HTTP provider fixture. Never imported by production runtime."""

import json

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

app = FastAPI()


@app.post("/chat/completions")
async def completions(request: Request):
    body = await request.json()
    payload = json.loads(body["messages"][-1]["content"])
    if "FAIL_MODEL" in payload.get("question", ""):
        return JSONResponse(
            status_code=503, content={"error": {"message": "fixture failure"}}
        )
    if "context" in payload:
        context = payload["context"]
        directions = (
            payload.get("directions")
            or [
                {
                    "domain_id": d["domain_id"],
                    "name": d["name"],
                    "explanation": "固定测试方向描述",
                }
                for d in context.get("domains", [])[:2]
            ]
            or [{"domain_id": "fixture", "name": "测试方向", "explanation": "测试范围"}]
        )
        data = {"directions": directions}
        if "directions" in payload:
            data.update(
                from_year=context.get("period_from_year", 1800),
                to_year=context.get("period_to_year", 2026),
                risks=[],
            )
            data["directions"] = [
                {**d, "keywords": [], "excluded_keywords": [], "cpc_prefixes": []}
                for d in directions
            ]
    else:
        data = {
            "companies": [
                {
                    "company_id": c["company_id"],
                    "summary": "基于提供的标题与 CPC 推断相关性",
                    "patent_ids": [p["patent_id"] for p in c["patents"]],
                }
                for c in payload["companies"]
            ]
        }
    return {
        "id": "fixture",
        "object": "chat.completion",
        "created": 1,
        "model": "deepseek-fixture-v1",
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": json.dumps(data, ensure_ascii=False),
                },
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 100, "completion_tokens": 100, "total_tokens": 200},
    }
