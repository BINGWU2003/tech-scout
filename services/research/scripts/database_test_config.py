"""Require an explicitly supplied test connection for destructive acceptance tools."""

import os
from urllib.parse import unquote, urlsplit, urlunsplit


def require_test_database_url():
    value = os.environ.get("TEST_DATABASE_URL")
    if not value:
        raise SystemExit("未配置独立 TEST_DATABASE_URL；不创建测试库，也不使用业务库。")
    parsed = urlsplit(value)
    if parsed.scheme not in ("postgres", "postgresql") or not unquote(
        parsed.path
    ).endswith("_test"):
        raise SystemExit(
            "TEST_DATABASE_URL 必须指向名称以 _test 结尾的独立 PostgreSQL 测试库。"
        )
    return value


def with_database(dsn, database):
    if not database.endswith("_test"):
        raise ValueError("验收数据库名称必须以 _test 结尾")
    return urlunsplit(urlsplit(dsn)._replace(path="/" + database))
