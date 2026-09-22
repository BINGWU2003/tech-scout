import copy
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
import respx
from pydantic import SecretStr

from tech_scout_intelligence.llm import DeepSeek, partial_reply
from tech_scout_intelligence.models import (
    ConversationReply,
    DirectionProposal,
    ResearchError,
)


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
        artifacts={
            "conversation": {"thinking": True},
            "reasoning": None,
            "answer": None,
        }
    )
    snapshots = []
    answers = []

    async def publish(_run_id, **changes):
        state.artifacts = copy.deepcopy(changes["artifacts"])
        if changes["kind"] == "reasoning_progress":
            snapshots.append(copy.deepcopy(state.artifacts["reasoning"]))
        else:
            answers.append(copy.deepcopy(state.artifacts["answer"]))

    store = SimpleNamespace(
        get=AsyncMock(return_value=state),
        reserve=AsyncMock(),
        usage=AsyncMock(),
        publish=publish,
        answers=answers,
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
    assert state.artifacts["answer"]["text"] == "直接回答"
    assert state.artifacts["answer"]["status"] == "completed"


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
    assert state.artifacts["answer"]["status"] == "interrupted"


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
    assert state.artifacts["answer"]["status"] == "interrupted"


@pytest.mark.parametrize(
    "content,expected",
    [
        ('{"reply":"先比较', "先比较"),
        ('{"reply":"第一行\\n第二行\\"引用\\"', '第一行\n第二行"引用"'),
        ('{"reply":"\\u4e2d\\u6587', "中文"),
        ('{"directions":[{"reply":"不要显示"}]}', ""),
        ('{"reply":42}', ""),
        ("{", ""),
    ],
)
def test_partial_json_only_exposes_decoded_reply(content, expected):
    assert partial_reply(content) == expected


@pytest.mark.asyncio
@respx.mock
async def test_streams_intro_before_direction_cards_are_validated(setup_model):
    model, state, _ = setup_model
    respx.post("https://model.test/chat/completions").mock(
        return_value=httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            text=(
                chunk({"reasoning_content": "结合研究需求选择方向。"})
                + chunk({"content": '{"reply":"结合需求，'})
                + chunk({"content": '推荐以下方向。","directions":['})
                + chunk(
                    {
                        "content": '{"domain_id":"d","name":"边缘推理",'
                        '"explanation":"关注轻量化模型","keywords":["边缘推理"]}]}'
                    },
                    "stop",
                )
                + "data: [DONE]\n\n"
            ),
        )
    )
    result = await model.generate(uuid4(), uuid4(), "研究助手", {}, DirectionProposal)
    assert result.reply == "结合需求，推荐以下方向。"
    assert model.store.answers[1]["text"] == "结合需求，"
    assert model.store.answers[1]["status"] == "streaming"
    assert model.store.answers[-1]["text"] == result.reply
    assert model.store.answers[-1]["status"] == "completed"
    assert "directions" not in state.artifacts
