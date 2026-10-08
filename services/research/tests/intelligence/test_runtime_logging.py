from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from structlog.testing import capture_logs

from tech_scout_intelligence.models import ResearchError
from tech_scout_intelligence.runtime import Runtime


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("error", "code"),
    [
        (RuntimeError("checkpoint connection lost"), "NODE_FAILED"),
        (
            ResearchError("MODEL_OUTPUT_INVALID", "invalid output"),
            "MODEL_OUTPUT_INVALID",
        ),
        (TimeoutError("execution timed out"), "NODE_FAILED"),
    ],
)
async def test_failure_logs_traceback_without_changing_public_error(error, code):
    run_id = uuid4()
    current = SimpleNamespace(
        node=None,
    )
    store = SimpleNamespace(
        claim=AsyncMock(
            return_value={
                "command": None,
                "question": "test question",
                "artifacts": {},
            }
        ),
        get=AsyncMock(return_value=current),
        publish=AsyncMock(),
        heartbeat=AsyncMock(),
    )
    graph = SimpleNamespace(aget_state=AsyncMock(side_effect=error))
    runtime = Runtime(graph, store, SimpleNamespace())

    with capture_logs() as logs:
        await runtime.execute(run_id)

    failure = next(entry for entry in logs if entry["event"] == "research_failed")
    assert failure["log_level"] == "error"
    assert failure["exc_info"] is True
    assert failure["run_id"] == str(run_id)
    assert failure["code"] == code
    published = store.publish.await_args_list[0].kwargs
    assert published["status"] == "failed"
    assert published["error"]["code"] == code
    assert "traceback" not in published["error"]
    if isinstance(error, ResearchError):
        assert published["error"]["message"] == error.message
    else:
        assert str(error) not in published["error"]["message"]
    assert store.publish.await_args_list[-1].kwargs["kind"] == "execution_stopped"
