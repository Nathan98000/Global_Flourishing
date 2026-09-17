"""Build the synthetic static tier the web tests run against.

`make web-fixtures` writes a small but shape-complete tier — estimates for
a handful of outcomes, plus the full catalog tier (meta.json,
variables.json, per-variable details) — into apps/web/public/data, using
the same synthetic DuckDB the API tests use and the real exporter. Vitest,
Playwright and Lighthouse all consume it, so CI never needs real data and
no file derived from the release is ever committed (CLAUDE.md).

Also drops `_fixtures/export-sample.csv` (a real /v1/export.csv response
over the synthetic data) for the client-side CSV parity test.
"""

from __future__ import annotations

import shutil
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "services" / "api" / "tests"))

from fastapi.testclient import TestClient  # noqa: E402
from flourish_api.config import Settings  # noqa: E402
from flourish_api.main import create_app  # noqa: E402
from flourish_pipeline.aggregate import export_static  # noqa: E402
from synthetic_db import build_synthetic_db  # noqa: E402

#: Enough shapes for every front-end test: a 0-10 item over two waves, a
#: lower_better item, an ordinal item (suppressed proportions), the
#: three-wave item (MY toggle), an MY-only item, a derived score and a
#: derived binary.
FIXTURE_OUTCOMES = ("HAPPY", "LONELY", "ATTEND_SVCS", "BALANCE", "MONEY", "sfi", "phq2_positive")

DATA_VERSION = "synthetic.0.0.1"


def main() -> int:
    target = REPO_ROOT / "apps" / "web" / "public" / "data"
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)

    with tempfile.TemporaryDirectory() as tmp:
        db_path = build_synthetic_db(Path(tmp))
        index = export_static(db_path, target, data_version=DATA_VERSION, only=FIXTURE_OUTCOMES)

        client = TestClient(create_app(Settings(data_path=db_path)))
        sample = client.get(
            "/v1/export.csv", params={"outcome": "HAPPY", "wave": "Y1", "by": "country_code"}
        )
        sample.raise_for_status()
        fixtures = target / "_fixtures"
        fixtures.mkdir()
        (fixtures / "export-sample.csv").write_text(sample.text)

    print(
        f"web-fixtures: {index['file_count']} static files + catalog tier "
        f"under {target.relative_to(REPO_ROOT)} (data {DATA_VERSION})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
