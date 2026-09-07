import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
import respx

from tech_scout_intelligence.config import Settings
from tech_scout_intelligence.llm import DeepSeek
from tech_scout_intelligence.models import Plan, ResearchError


def config(**overrides):
    return Settings(
        _env_file=None,  # pyright: ignore[reportCallIssue]
        intelligence_database_url="postgresql://unused",
        intelligence_catalog_database_url="postgresql://unused",
        intelligence_internal_token="test-token-" * 4,
        deepseek_api_key="test-key",
        **overrides,
    )


@pytest.mark.asyncio
@respx.mock
async def test_resume_uses_persisted_model_and_limits():
    current = config(deepseek_model="new-environment-model")
    policy = current.execution_policy()
    policy.update(model="original-run-model", output_tokens=1024)
    plan = {
        "directions": [{"domain_id": "d", "name": "方向", "explanation": "依据"}],
        "from_year": 2019,
        "to_year": 2025,
    }
    route = respx.post("https://api.deepseek.com/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "fixture",
                "object": "chat.completion",
                "created": 1,
                "model": "original-resolved-model",
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": json.dumps(plan)},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": 20,
                    "completion_tokens": 10,
                    "total_tokens": 30,
                },
            },
        )
    )
    store = AsyncMock()
    store.get.return_value = SimpleNamespace(artifacts={"execution_config": policy})
    await DeepSeek(current, store).generate(uuid4(), uuid4(), "规划", {}, Plan)
    request = json.loads(route.calls.last.request.content)
    assert request["model"] == "original-run-model"
    assert request["max_tokens"] == 1024
    assert request["thinking"] == {"type": "disabled"}


@pytest.mark.asyncio
@respx.mock
async def test_model_error_is_not_retried_or_exposed():
    route = respx.post("https://api.deepseek.com/chat/completions").mock(
        return_value=httpx.Response(
            503, json={"error": {"message": "secret-provider-error"}}
        )
    )
    store = AsyncMock()
    store.get.return_value = SimpleNamespace(artifacts={})
    with pytest.raises(ResearchError) as failure:
        await DeepSeek(config(), store).generate(uuid4(), uuid4(), "生成计划", {}, Plan)
    assert failure.value.code == "MODEL_REQUEST_FAILED"
    assert "secret" not in failure.value.message
    assert route.call_count == 1
    store.reserve.assert_awaited_once()


@pytest.mark.asyncio
@respx.mock
@pytest.mark.parametrize(
    "content,reason", [("", "stop"), ("{}", "stop"), ('{"x":', "length")]
)
async def test_empty_truncated_or_schema_invalid_output_fails(content, reason):
    respx.post("https://api.deepseek.com/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "mock",
                "object": "chat.completion",
                "created": 1,
                "model": "deepseek-v4-flash-test",
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": content},
                        "finish_reason": reason,
                    }
                ],
                "usage": {
                    "prompt_tokens": 20,
                    "completion_tokens": 10,
                    "total_tokens": 30,
                },
            },
        )
    )
    store = AsyncMock()
    store.get.return_value = SimpleNamespace(artifacts={})
    with pytest.raises(ResearchError) as failure:
        await DeepSeek(config(), store).generate(uuid4(), uuid4(), "计划", {}, Plan)
    assert failure.value.code == "MODEL_OUTPUT_INVALID"
    store.usage.assert_awaited_once()
