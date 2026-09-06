import os

import pytest

from tech_scout_intelligence.catalog import Catalog
from tech_scout_intelligence.models import ResearchError


@pytest.mark.asyncio
@pytest.mark.skipif(
    not os.environ.get("TEST_CATALOG_DATABASE_URL"), reason="未配置独立 Catalog 测试库"
)
async def test_real_catalog_release_boundary_and_source_snapshot():
    catalog = Catalog(os.environ["TEST_CATALOG_DATABASE_URL"])
    context = await catalog.read()
    assert context["release"]["release_id"] == "test-v1"
    snapshot = await catalog.read("test-v1")
    assert snapshot["patents"]
    assert all(not p["source_path"].startswith("D:") for p in snapshot["patents"])
    with pytest.raises(ResearchError) as failure:
        await catalog.read("test-v2")
    assert failure.value.code == "RELEASE_CHANGED"
