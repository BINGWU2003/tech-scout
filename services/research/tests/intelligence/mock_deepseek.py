"""Local HTTP provider fixture. Never imported by production runtime."""

import json

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

app = FastAPI()


@app.post("/chat/completions")
async def completions(request: Request):
    body = await request.json()
    payload = json.loads(body["messages"][-1]["content"])
    if "FAIL_MODEL" in payload.get("question", ""):
        return JSONResponse(
            status_code=503, content={"error": {"message": "fixture failure"}}
        )
    if "direction" in payload:
        data = {"keywords": [payload["direction"]["name"]]}
    elif "directions" in payload:
        data = {
            "directions": [
                {
                    "domain_id": d["domain_id"],
                    "excluded_keywords": [],
                    "cpc_prefixes": [],
                }
                for d in payload["directions"]
            ],
            "risks": [],
        }
    elif "companies" not in payload:
        data = {
            "reply": "结合研究需求，推荐以下技术方向。",
            "directions": [
                {
                    "domain_id": "fixture",
                    "name": "测试方向",
                    "explanation": "测试范围",
                    "keywords": ["测试方向"],
                }
            ],
        }
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
    response = {
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
    if not body.get("stream"):
        return response

    async def events():
        def chunk(delta, finish=None):
            return (
                "data: "
                + json.dumps(
                    {
                        "id": "fixture",
                        "object": "chat.completion.chunk",
                        "created": 1,
                        "model": "deepseek-fixture-v1",
                        "choices": [
                            {"index": 0, "delta": delta, "finish_reason": finish}
                        ],
                    },
                    ensure_ascii=False,
                )
                + "\n\n"
            )

        content = json.dumps(data, ensure_ascii=False)
        for offset in range(0, len(content), 40):
            yield chunk({"content": content[offset : offset + 40]})
        yield chunk({}, "stop")
        yield (
            "data: "
            + json.dumps(
                {
                    "id": "fixture",
                    "object": "chat.completion.chunk",
                    "created": 1,
                    "model": "deepseek-fixture-v1",
                    "choices": [],
                    "usage": response["usage"],
                }
            )
            + "\n\n"
        )
        yield "data: [DONE]\n\n"

    return StreamingResponse(events(), media_type="text/event-stream")
