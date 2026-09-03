"""Database configuration and connection helpers for offline tooling."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row


class DatabaseConfigError(ValueError):
    """Raised when a local database configuration is invalid."""


def read_database_config(path: Path) -> dict[str, str | int]:
    """Read Chinese label, .env-style, JSON, or PostgreSQL URL config."""
    if not path.is_file():
        raise DatabaseConfigError(f"Database config does not exist: {path}")
    text = path.read_text(encoding="utf-8-sig").strip()
    if not text:
        raise DatabaseConfigError("Database config is empty")
    if text.startswith("postgres://") or text.startswith("postgresql://"):
        return {"conninfo": text}
    if text.startswith("{"):
        raw = json.loads(text)
        values = {str(key).lower(): value for key, value in raw.items()}
    else:
        values: dict[str, str] = {}
        labels = {
            "主机": "host",
            "端口": "port",
            "数据库": "dbname",
            "用户名": "user",
            "用户": "user",
            "密码": "password",
            "host": "host",
            "port": "port",
            "database": "dbname",
            "dbname": "dbname",
            "username": "user",
            "user": "user",
            "password": "password",
        }
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            separator = "：" if "：" in line else "=" if "=" in line else ":"
            if separator not in line:
                raise DatabaseConfigError(
                    "Database config contains an unsupported line"
                )
            label, value = line.split(separator, 1)
            key = labels.get(label.strip().lower())
            if key:
                values[key] = value.strip().strip('"').strip("'")
    aliases = {
        "hostname": "host",
        "database": "dbname",
        "username": "user",
    }
    normalized = {aliases.get(key, key): value for key, value in values.items()}
    required = {"host", "port", "dbname", "user", "password"}
    missing = sorted(required - normalized.keys())
    if missing:
        raise DatabaseConfigError(f"Database config is missing: {', '.join(missing)}")
    try:
        normalized["port"] = int(normalized["port"])
    except (TypeError, ValueError) as error:
        raise DatabaseConfigError("Database port must be an integer") from error
    return normalized


def connect_database(config_path: Path) -> psycopg.Connection[Any]:
    """Open a dict-row PostgreSQL connection from a local config file."""
    config = read_database_config(config_path)
    if "conninfo" in config:
        return psycopg.connect(str(config["conninfo"]), row_factory=dict_row)
    return psycopg.connect(**config, row_factory=dict_row)
