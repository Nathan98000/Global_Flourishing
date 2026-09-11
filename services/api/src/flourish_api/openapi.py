"""Deterministic OpenAPI export: ``python -m flourish_api.openapi``.

Prints the schema as sorted, indented JSON — the committed
``apps/web/openapi.json`` is generated from this and CI diffs both halves
of the client chain (schema export here, ``pnpm gen:api`` on the web
side), so the TypeScript client can never drift from the server.

The schema is independent of any data file: routes and models are static,
so this runs in CI with no data present.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def openapi_json() -> str:
    from flourish_api.config import Settings
    from flourish_api.main import create_app

    # A path that never exists: schema generation must not touch data.
    app = create_app(Settings(data_path=Path("/nonexistent/flourish.duckdb")))
    return json.dumps(app.openapi(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    sys.stdout.write(openapi_json())
