"""Export/check the internal contract without loading credentials or connecting."""

import argparse
import json
from pathlib import Path

from .app import app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    path = Path(__file__).resolve().parents[2] / "openapi.json"
    content = json.dumps(app.openapi(), ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if not path.exists() or path.read_text(encoding="utf-8") != content:
            raise SystemExit("内部 OpenAPI 有漂移，请重新生成契约及 NestJS 客户端")
        print("OpenAPI contract is current")
    else:
        path.write_text(content, encoding="utf-8")


if __name__ == "__main__":
    main()
