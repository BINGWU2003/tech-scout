import copy
import json
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
import respx
from pydantic import SecretStr

from tech_scout_intelligence.config import Settings
from tech_scout_intelligence.llm import ResearchLLM
from tech_scout_intelligence.models import DirectionProposal, Keywords, ResearchError


def setup(provider="openai", method="json_schema"):
    config = SimpleNamespace(
        openai_api_key=SecretStr("openai-test"),
        anthropic_api_key=SecretStr("anthropic-test"),
    )
    policy = {
        "provider": provider,
        "model": "gpt-6.1-sol" if provider == "openai" else "claude-test",
        "base_url": "https://model.test/v1"
        if provider == "openai"
        else "https://model.test",
        "structured_method": method,
        "reasoning_effort": "low" if provider == "openai" else None,
        "use_responses_api": True,
        "timeout_seconds": 10,
        "output_tokens": 2048,
    }
    state = SimpleNamespace(artifacts={"execution_config": policy})
    answers = []

    async def get(*args):
        return state

    async def heartbeat(*args):
        pass

    async def publish(*args, **changes):
        state.artifacts = copy.deepcopy(changes["artifacts"])
        answers.append(state.artifacts["answer"])

    store = SimpleNamespace(get=get, heartbeat=heartbeat, publish=publish)
    return ResearchLLM(config, store), answers


def response(text, status="completed"):
    return {
        "id": "resp_test",
        "object": "response",
        "created_at": 1,
        "model": "gpt-6.1-sol",
        "status": status,
        "output": [
            {
                "id": "msg_test",
                "type": "message",
                "role": "assistant",
                "status": "completed",
                "content": [{"type": "output_text", "text": text, "annotations": []}],
            }
        ],
    }


def sse(event):
    return f"event: {event['type']}\ndata: {json.dumps(event)}\n\n"


@pytest.mark.asyncio
@respx.mock
async def test_responses_stream_preserves_reply_and_enforces_schema():
    model, answers = setup()
    text = json.dumps(
        {
            "reply": "建议研究工业视觉。",
            "directions": [
                {
                    "domain_id": "vision",
                    "name": "工业视觉",
                    "explanation": "缺陷检测",
                    "keywords": ["缺陷检测"],
                }
            ],
        },
        ensure_ascii=False,
    )
    events = [
        {
            "type": "response.created",
            "response": {
                **response("", "in_progress"),
                "output": [],
            },
        }
    ]
    split = text.index(",")
    for part in (text[:split], text[split:]):
        events.append(
            {
                "type": "response.output_text.delta",
                "item_id": "msg_test",
                "output_index": 0,
                "content_index": 0,
                "delta": part,
            }
        )
    events.append({"type": "response.completed", "response": response(text)})
    route = respx.post("https://model.test/v1/responses").mock(
        return_value=httpx.Response(
            200,
            text="".join(
                sse({**event, "sequence_number": i}) for i, event in enumerate(events)
            ),
            headers={"content-type": "text/event-stream"},
        )
    )
    result = await model.generate(uuid4(), uuid4(), "研究", {}, DirectionProposal)
    assert result.directions[0].domain_id == "vision"
    assert any(
        a["text"] == result.reply and a["status"] == "streaming" for a in answers
    )
    assert answers[-1]["status"] == "completed"
    request = json.loads(route.calls.last.request.content)
    assert request["reasoning"] == {"effort": "low"}
    assert request["max_output_tokens"] == 2048
    assert request["stream"] is True
    assert request["text"]["format"]["strict"] is True
    assert (
        request["text"]["format"]["schema"]["properties"]["directions"]["maxItems"] == 3
    )
    assert "thinking" not in request


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["completed", "incomplete"])
@respx.mock
async def test_responses_nonstream_requires_completion(status):
    model, _ = setup()
    respx.post("https://model.test/v1/responses").mock(
        return_value=httpx.Response(
            200,
            json=response('{"keywords":["vision"]}', status),
        )
    )
    if status == "completed":
        result = await model.generate(uuid4(), uuid4(), "关键词", {}, Keywords)
        assert result.keywords == ["vision"]
    else:
        with pytest.raises(ResearchError) as exc:
            await model.generate(uuid4(), uuid4(), "关键词", {}, Keywords)
        assert exc.value.code == "MODEL_OUTPUT_INVALID"


@pytest.mark.asyncio
async def test_anthropic_tool_output_uses_provider_key_and_contract(monkeypatch):
    from anthropic.types import Message
    from langchain_anthropic import ChatAnthropic

    model, _ = setup("anthropic", "function_calling")
    captured = {}

    async def create(client, payload):
        captured.update(payload)
        assert client.anthropic_api_key.get_secret_value() == "anthropic-test"
        message = Message.model_validate(
            {
                "id": "msg_test",
                "type": "message",
                "role": "assistant",
                "model": "claude-test",
                "stop_reason": "tool_use",
                "stop_sequence": None,
                "content": [
                    {
                        "type": "tool_use",
                        "id": "tool_test",
                        "name": "Keywords",
                        "input": {"keywords": ["vision"]},
                    }
                ],
                "usage": {"input_tokens": 10, "output_tokens": 10},
            }
        )
        return SimpleNamespace(parse=lambda: message)

    # Stub only the transport; exercise LangChain's provider formatting and parsing.
    monkeypatch.setattr(ChatAnthropic, "_acreate", create)
    result = await model.generate(uuid4(), uuid4(), "keywords", {}, Keywords)
    assert result.keywords == ["vision"]
    assert captured["tool_choice"]["name"] == "Keywords"
    assert "reasoning_effort" not in captured
    assert "thinking" not in captured


def test_policy_never_persists_credentials():
    config = Settings(
        _env_file=None,  # pyright: ignore[reportCallIssue]
        database_url="postgresql://unused",
        intelligence_internal_token="x" * 32,
        openai_api_key="private-test-key",
    )
    policy = config.execution_policy()
    assert policy["model"] == "gpt-6.1-sol"
    assert policy["reasoning_effort"] == "low"
    assert "private-test-key" not in json.dumps(policy)
