"""Read optional test configuration without importing application credentials."""

import os
from pathlib import Path
from urllib.parse import unquote, urlsplit

from dotenv import dotenv_values

for file in (
    Path(__file__).resolve().parents[3] / ".env",
    Path(__file__).resolve().parents[1] / ".env",
):
    for key, value in dotenv_values(file).items():
        if key.startswith("TEST_") and value:
            os.environ.setdefault(key, value)

if (dsn := os.environ.get("TEST_DATABASE_URL")) and not unquote(
    urlsplit(dsn).path
).endswith("_test"):
    raise ValueError("TEST_DATABASE_URL 必须指向名称以 _test 结尾的独立测试库")
