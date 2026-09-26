"""Build the synthetic static tier the web tests run against.

`make web-fixtures` writes a small but shape-complete tier — estimates for
a handful of outcomes, plus the full catalog tier (meta.json,
variables.json, per-variable details) — into apps/web/public/data, using
the same synthetic DuckDB the API tests use and the real exporter. Vitest,
Playwright and Lighthouse all consume it, so CI never needs real data and
no file derived from the release is ever committed (CLAUDE.md).

Also drops `_fixtures/export-sample.csv` (a real /v1/export.csv response
over the synthetic data) for the client-side CSV parity test, and — for
the Phase 5/6 views, which the static tier never precomputes — real
/v1/change, /v1/states and /v1/correlates responses the Playwright
journeys serve back through route interception (no API process runs in
that suite).
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

#: API-only responses for the Phase 5/6 journeys: a 0-10 pair (change +
#: histogram), an ordinal pair (adds the transition matrix), the
#: three-point panel, two state cross-sections (plain and adjusted) with
#: the US overall on the state weight beside them, and
#: the Correlates view's two shapes for the outcomes journey 10 visits —
#: the ranked list for Testland and the cross-country sweep (the page
#: never asks for the adjusted models, ADR-0018). The Compare two and
#: Compare several responses that journey needs are planned below.
API_FIXTURES: tuple[tuple[str, str, dict[str, str]], ...] = (
    (
        "change-HAPPY-Y1-Y2.json",
        "/v1/change",
        {"outcome": "HAPPY", "from": "Y1", "to": "Y2", "by": "country_code"},
    ),
    (
        "change-ATTEND_SVCS-Y1-Y2.json",
        "/v1/change",
        {"outcome": "ATTEND_SVCS", "from": "Y1", "to": "Y2", "by": "country_code"},
    ),
    (
        "change-BALANCE-Y1-MY-Y2.json",
        "/v1/change",
        {"outcome": "BALANCE", "from": "Y1", "via": "MY", "to": "Y2", "by": "country_code"},
    ),
    ("states-HAPPY-Y1.json", "/v1/states", {"outcome": "HAPPY", "wave": "Y1", "stat": "mean"}),
    # The whole US on the state weight: the reference the states are read against.
    (
        "states-HAPPY-Y1-overall.json",
        "/v1/aggregate",
        {"outcome": "HAPPY", "wave": "Y1", "stat": "mean", "scope": "us_state"},
    ),
    (
        "states-HAPPY-Y2-adj.json",
        "/v1/states",
        {"outcome": "HAPPY", "wave": "Y2", "stat": "mean", "adj": "true"},
    ),
    *(
        (
            f"correlates-{outcome}-Y1-{shape}.json",
            "/v1/correlates",
            {
                "outcome": outcome,
                "wave": "Y1",
                **({"filter": "country_code:1"} if shape == "ranked" else {"by": "country_code"}),
            },
        )
        for outcome in ("sfi", "HAPPY", "LONELY", "gad2_score")
        for shape in ("ranked", "across")
    ),
)

#: Journey 10's path through Compare two and Compare several, in the
#: synthetic data: HAPPY's "Loneliness" row opens the pair, Swap turns it
#: round, Compare several starts from LONELY and its top five, the
#: journey adds BALANCE ("Life balance"), removes phq2_score, and opens
#: the table's first cell (its second question beside its first).
JOURNEY_ADDED = "BALANCE"
JOURNEY_REMOVED = "phq2_score"


def correlation_fixtures(client: TestClient) -> list[tuple[str, str, dict[str, object]]]:
    """(file, path, params) for journey 10's pair and table requests,
    named from the request itself so the journey finds them by it."""
    ranked = client.get(
        "/v1/correlates", params={"outcome": "LONELY", "wave": "Y1", "filter": "country_code:1"}
    )
    ranked.raise_for_status()
    top = [row["predictor"] for row in ranked.json()["rows"]][:5]
    default = ["LONELY", *top]
    added = [*default, JOURNEY_ADDED]
    kept = [name for name in added if name != JOURNEY_REMOVED]
    pairs = [("HAPPY", "LONELY"), ("LONELY", "HAPPY"), (kept[1], kept[0])]
    base = {"wave": "Y1", "filter": "country_code:1"}
    return [
        *(
            (f"correlations-pair-{y}-{x}.json", "/v1/correlations/pair", {"y": y, "x": x, **base})
            for y, x in pairs
        ),
        *(
            (
                f"correlations-table-{'-'.join(names)}.json",
                "/v1/correlations",
                {"vars": names, **base},
            )
            for names in (default, added, kept)
        ),
    ]


def main() -> int:
    target = REPO_ROOT / "apps" / "web" / "public" / "data"
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)

    with tempfile.TemporaryDirectory() as tmp:
        db_path = build_synthetic_db(Path(tmp))
        index = export_static(db_path, target, data_version=DATA_VERSION, only=FIXTURE_OUTCOMES)

        # 60 synthetic people per country: rank at a lower floor than the
        # serving default (100) so the fixtures carry a ranked list.
        client = TestClient(create_app(Settings(data_path=db_path, correlates_min_n=20)))
        sample = client.get(
            "/v1/export.csv", params={"outcome": "HAPPY", "wave": "Y1", "by": "country_code"}
        )
        sample.raise_for_status()
        fixtures = target / "_fixtures"
        fixtures.mkdir()
        (fixtures / "export-sample.csv").write_text(sample.text)
        for name, path, params in (*API_FIXTURES, *correlation_fixtures(client)):
            response = client.get(path, params=params)
            response.raise_for_status()
            (fixtures / name).write_text(response.text)

    print(
        f"web-fixtures: {index['file_count']} static files + catalog tier "
        f"under {target.relative_to(REPO_ROOT)} (data {DATA_VERSION})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
