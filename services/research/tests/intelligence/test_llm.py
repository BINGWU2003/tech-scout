import copy
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
import respx
from pydantic import SecretStr

from tech_scout_intelligence.llm import DeepSeek
from tech_scout_intelligence.models import ConversationReply, ResearchError


def chunk(delta=None, finish=None, usage=None):
    return (
        "data: "
        + json.dumps(
            {
                "id": "test",
                "object": "chat.completion.chunk",
                "created": 1,
                "model": "deepseek-test",
                "choices": [{"index": 0, "delta": delta or {}, "finish_reason": finish}]
                if usage is None
                else [],
                "usage": usage,
            }
        )
        + "\n\n"
    )


@pytest.fixture
def setup_model():
    state = SimpleNamespace(
        artifacts={"conversation": {"thinking": True}, "reasoning": None}
    )
    snapshots = []

    async def publish(_run_id, **changes):
        state.artifacts = copy.deepcopy(changes["artifacts"])
        snapshots.append(copy.deepcopy(state.artifacts["reasoning"]))

    store = SimpleNamespace(
        get=AsyncMock(return_value=state),
        reserve=AsyncMock(),
        usage=AsyncMock(),
        publish=publish,
    )
    config = SimpleNamespace(
        deepseek_api_key=SecretStr("test-key"),
        execution_policy=lambda: {
            "model": "deepseek-test",
            "base_url": "https://model.test",
            "timeout_seconds": 10,
            "output_tokens": 4096,
            "input_cny_per_million": 3,
            "output_cny_per_million": 9,
        },
    )
    return DeepSeek(config, store), state, snapshots


@pytest.mark.asyncio
@respx.mock
async def test_streams_real_reasoning_before_validated_answer_and_tracks_usage(
    setup_model,
):
    model, state, snapshots = setup_model
    answer = json.dumps({"intent": "discuss", "reply": "可以比较两种方案。"})
    route = respx.post("https://model.test/chat/completions").mock(
        return_value=httpx.Response(
            200,
            text=(
                chunk({"reasoning_content": "先比较"})
                + chunk({"reasoning_content": "两种技术。"})
                + chunk({"content": answer[:15]})
                + chunk({"content": answer[15:]}, "stop")
                + chunk(
                    usage={
                        "prompt_tokens": 50,
                        "completion_tokens": 80,
                        "total_tokens": 130,
                    }
                )
                + "data: [DONE]\n\n"
            ),
            headers={"content-type": "text/event-stream"},
        )
    )
    result = await model.generate(uuid4(), uuid4(), "研究助手", {}, ConversationReply)
    assert result.reply == "可以比较两种方案。"
    assert snapshots[0]["status"] == "thinking"
    assert snapshots[-2]["status"] == "answering"
    assert snapshots[-2]["text"] == "先比较两种技术。"
    assert snapshots[-1]["status"] == "completed"
    assert state.artifacts["reasoning"]["text"] == "先比较两种技术。"
    request = json.loads(route.calls[0].request.content)
    assert request["thinking"] == {"type": "enabled"}
    assert request["stream"] is True
    assert request["stream_options"]["include_usage"] is True
    model.store.usage.assert_awaited_once()


@pytest.mark.asyncio
@respx.mock
async def test_disabled_mode_does_not_invent_reasoning(setup_model):
    model, state, snapshots = setup_model
    state.artifacts["conversation"]["thinking"] = False
    route = respx.post("https://model.test/chat/completions").mock(
        return_value=httpx.Response(
            200,
            text=chunk(
                {
                    "content": '{"intent":"discuss","reply":"直接回答"}',
                },
                "stop",
            )
            + "data: [DONE]\n\n",
            headers={"content-type": "text/event-stream"},
        )
    )
    await model.generate(uuid4(), uuid4(), "研究助手", {}, ConversationReply)
    assert json.loads(route.calls[0].request.content)["thinking"]["type"] == "disabled"
    assert not snapshots
    assert state.artifacts["reasoning"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("content,finish", [("{", "stop"), ("{}", "length")])
@respx.mock
async def test_invalid_or_truncated_answer_preserves_interrupted_reasoning(
    setup_model, content, finish
):
    model, state, _ = setup_model
    respx.post("https://model.test/chat/completions").mock(
        return_value=httpx.Response(
            200,
            text=(
                chunk({"reasoning_content": "已收到的思考"})
                + chunk({"content": content}, finish)
                + "data: [DONE]\n\n"
            ),
            headers={"content-type": "text/event-stream"},
        )
    )
    with pytest.raises(ResearchError, match="模型输出"):
        await model.generate(uuid4(), uuid4(), "研究助手", {}, ConversationReply)
    assert state.artifacts["reasoning"]["status"] == "interrupted"
    assert state.artifacts["reasoning"]["text"] == "已收到的思考"


@pytest.mark.asyncio
@respx.mock
async def test_provider_failure_is_interrupted_not_success(setup_model):
    model, state, _ = setup_model
    respx.post("https://model.test/chat/completions").mock(
        return_value=httpx.Response(503)
    )
    with pytest.raises(ResearchError, match="DeepSeek 请求失败"):
        await model.generate(uuid4(), uuid4(), "研究助手", {}, ConversationReply)
    assert state.artifacts["reasoning"]["status"] == "interrupted"
