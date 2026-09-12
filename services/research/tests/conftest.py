"""Read optional test configuration without importing application credentials."""

import os
from pathlib import Path

from dotenv import dotenv_values

for key, value in dotenv_values(Path(__file__).resolve().parents[1] / ".env").items():
    if key.startswith("TEST_") and value:
        os.environ.setdefault(key, value)
