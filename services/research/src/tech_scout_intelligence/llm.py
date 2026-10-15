import asyncio
import json
import time
from contextlib import suppress
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from langchain.chat_models import init_chat_model
from langchain_core.callbacks import AsyncCallbackHandler
from langchain_core.runnables.utils import AddableDict
from langchain_core.utils.function_calling import convert_to_openai_tool
from openai import ContentFilterFinishReasonError, LengthFinishReasonError
from pydantic import ValidationError
from pydantic_core import from_json

from .models import ConversationReply, DirectionProposal, ResearchError
from .prompts import EVIDENCE_BOUNDARY, INPUT_BOUNDARY


def partial_reply(content: str) -> str:
    """Decode only the public prose field; never expose partial JSON/card data."""
    try:
        value = from_json(content, allow_partial="trailing-strings")
    except ValueError:
        return ""
    reply = value.get("reply") if isinstance(value, dict) else None
    return reply[:4000] if isinstance(reply, str) else ""


def structured_model(config, policy, schema):
    """Keep provider-specific parameters outside the research workflow.

    Policies without a provider are persisted runs from the old DeepSeek client.
    Credentials stay in settings and are never persisted with the policy.
    """
    provider = policy.get("provider", "deepseek")
    key = getattr(config, f"{provider}_api_key").get_secret_value()
    if not key:
        raise ResearchError(
            "MODEL_NOT_CONFIGURED", f"请在服务端配置 {provider.upper()}_API_KEY"
        )
    options: dict[str, Any] = {
        "api_key": key,
        "max_retries": 0,
        "timeout": policy["timeout_seconds"],
        "max_tokens": policy["output_tokens"],
    }
    if policy.get("base_url"):
        options["base_url"] = policy["base_url"]
    method = policy.get("structured_method", "json_mode")
    effort = policy.get("reasoning_effort")
    if provider == "openai":
        options["use_responses_api"] = policy.get("use_responses_api", True)
        options["stream_usage"] = False
        if effort:
            options["reasoning_effort"] = effort
    elif provider == "deepseek":
        options["extra_body"] = {"thinking": {"type": "disabled"}}
        options["stream_usage"] = False
    elif provider == "anthropic" and effort:
        options["reasoning_effort"] = effort
    model = init_chat_model(policy["model"], model_provider=provider, **options)
    # Parse once after the stream ends; partial objects need not satisfy validators.
    definition = convert_to_openai_tool(schema, strict=True)["function"]
    shape = definition["parameters"]
    kwargs: dict[str, Any] = {"method": method, "include_raw": True}
    if method == "json_schema" and provider != "anthropic":
        kwargs["strict"] = True
    return model.with_structured_output({"title": schema.__name__, **shape}, **kwargs)


class ResearchLLM:
    def __init__(self, config, store):
        self.config = config
        self.store = store

    async def generate(self, run_id, lease, instruction, payload, schema):
        state = await self.store.get(run_id)
        policy = state.artifacts["execution_config"]
        visible = schema in (ConversationReply, DirectionProposal)
        messages = [
            {
                "role": "system",
                "content": instruction
                + INPUT_BOUNDARY
                + ("" if visible else EVIDENCE_BOUNDARY)
                + "\n只输出符合以下 JSON schema 的 JSON 对象："
                + json.dumps(schema.model_json_schema()),
            },
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ]
        await self.store.heartbeat(run_id, lease)
        answer = {
            "id": str(uuid4()),
            "startedAt": datetime.now(UTC).isoformat(),
            "status": "streaming",
            "text": "",
        }

        async def publish_answer(status):
            answer["status"] = status
            current = await self.store.get(run_id)
            await self.store.publish(
                run_id,
                lease=lease,
                kind="answer_progress",
                artifacts={**current.artifacts, "answer": dict(answer)},
            )

        if visible:
            await publish_answer("streaming")
        content = ""
        last_answer_publish = time.monotonic()

        class AnswerStream(AsyncCallbackHandler):
            raise_error = True

            async def on_llm_new_token(self, token, *, chunk=None, **kwargs):
                nonlocal content, last_answer_publish
                if chunk is None:
                    return
                message = chunk.message
                if message.tool_call_chunks:
                    content += "".join(
                        item.get("args") or ""
                        for item in message.tool_call_chunks
                        if item.get("index", 0) == 0
                    )
                else:
                    content += message.text
                reply = partial_reply(content)
                if reply and reply != answer["text"]:
                    first_answer = not answer["text"]
                    answer["text"] = reply
                    if first_answer or time.monotonic() - last_answer_publish >= 0.3:
                        await publish_answer("streaming")
                        last_answer_publish = time.monotonic()

        try:
            runnable = structured_model(self.config, policy, schema)
            if visible:
                # astream drives model token callbacks while retaining the final raw
                # response and parser error, including tool-call based providers.
                output = AddableDict()
                async for part in runnable.astream(
                    messages, config={"callbacks": [AnswerStream()]}
                ):
                    output = output + part
            else:
                output = await runnable.ainvoke(messages)
        except (Exception, asyncio.CancelledError) as exc:
            if visible:
                with suppress(Exception):
                    await publish_answer("interrupted")
            if isinstance(exc, (ResearchError, asyncio.CancelledError)):
                raise
            if isinstance(
                exc, (LengthFinishReasonError, ContentFilterFinishReasonError)
            ):
                raise ResearchError(
                    "MODEL_OUTPUT_INVALID", "模型输出未完整结束"
                ) from exc
            raise ResearchError(
                "MODEL_REQUEST_FAILED", "模型请求失败，请主动重试"
            ) from exc
        raw = output.get("raw")
        metadata = raw.response_metadata if raw else {}
        finish = metadata.get("finish_reason") or metadata.get("stop_reason")
        status = metadata.get("status")
        invalid = (
            raw is None
            or output.get("parsing_error") is not None
            or output.get("parsed") is None
            or finish not in (None, "stop", "tool_calls", "end_turn", "tool_use")
            or status not in (None, "completed")
            or (finish is None and status != "completed")
            or bool(raw.additional_kwargs.get("refusal"))
        )
        try:
            if invalid or raw is None:
                raise ValueError("Incomplete or invalid structured output")
            result = (
                schema.model_validate(output["parsed"])
                if raw.tool_calls
                else schema.model_validate_json(raw.text)
            )
        except (ValidationError, ValueError) as exc:
            if visible:
                await publish_answer("interrupted")
            raise ResearchError(
                "MODEL_OUTPUT_INVALID", "模型输出不符合结构化契约或未完整结束"
            ) from exc
        if visible:
            answer["text"] = result.reply
            await publish_answer("completed")
        return result
