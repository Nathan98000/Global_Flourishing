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

import json
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
#: the Correlates view's two shapes for the questions journey 10's old
#: links visit — the ranked list for Testland and the cross-country sweep
#: (the page never asks for the adjusted models, ADR-0018). The rest of
#: that journey's responses are planned below.
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

#: Journey 10's path (ADR-0019), in the synthetic data: it lands on
#: Compare two's default pair, picks HAPPY as the first question, swaps
#: the two, looks in every country, opens Compare several (the pair and
#: the first question's top four), adds two questions, removes the first
#: of them, orders the table "similar together" and opens its first cell;
#: then Find related for that cell's first question, whose top row opens
#: Compare two again. The plan is written beside the fixtures
#: (journey-10.json) so the spec needn't repeat the server's choices.
DEFAULT_PAIR = ("WB_TODAY", "INCOME_FEELINGS")
JOURNEY_PICKED = "HAPPY"
#: Added in Compare several: the first two of these not already there.
JOURNEY_ADD_FROM = ("BALANCE", "CHILD_MEM", "LONELY", "ATTEND_SVCS", "WB_TODAY")
BASE = {"wave": "Y1", "filter": "country_code:1"}


def correlation_fixtures(
    client: TestClient,
) -> tuple[list[tuple[str, str, dict[str, object]]], dict[str, object]]:
    """(file, path, params) for every request journey 10 makes beyond the
    shared API fixtures — each named from the request itself, so the
    journey finds it by it — and the plan the journey follows."""
    fixtures: list[tuple[str, str, dict[str, object]]] = []

    def pair(y: str, x: str) -> None:
        fixtures.append(
            (f"correlations-pair-{y}-{x}.json", "/v1/correlations/pair", {"y": y, "x": x, **BASE})
        )

    def ranked(outcome: str) -> list[str]:
        params = {"outcome": outcome, **BASE}
        fixtures.append((f"correlates-{outcome}-Y1-ranked.json", "/v1/correlates", params))
        response = client.get("/v1/correlates", params=params)
        response.raise_for_status()
        return [row["predictor"] for row in response.json()["rows"]]

    def table(names: list[str]) -> dict[str, object]:
        params = {"vars": names, **BASE}
        fixtures.append((f"correlations-table-{'-'.join(names)}.json", "/v1/correlations", params))
        response = client.get("/v1/correlations", params=params)
        response.raise_for_status()
        return response.json()

    def display(name: str) -> str:
        response = client.get(f"/v1/variables/{name}")
        response.raise_for_status()
        return str(response.json()["display_name"])

    a, b = DEFAULT_PAIR
    pair(b, a)
    # Pick the first question; swap the two; the swapped pair everywhere.
    pair(b, JOURNEY_PICKED)
    first, second = b, JOURNEY_PICKED
    pair(second, first)
    fixtures.append(
        (
            f"correlates-{first}-Y1-across-{second}.json",
            "/v1/correlates",
            {"outcome": first, "wave": "Y1", "against": second, "by": "country_code"},
        )
    )
    # Compare several: the pair and the first question's top four.
    top = [name for name in ranked(first) if name != second][:4]
    default = [first, second, *top]
    added = [name for name in JOURNEY_ADD_FROM if name not in default][:2]
    grown = [*default, *added]
    kept = [name for name in grown if name != added[0]]
    table(default)
    table(grown)
    order = [str(name) for name in table(kept)["similar_order"]]  # type: ignore[union-attr]
    # Its first cell: the second question shown on the row, the first on the column.
    pair(order[1], order[0])
    # Find related for that first question; its top row opens a pair.
    related = ranked(order[0])[0]
    pair(related, order[0])
    plan: dict[str, object] = {
        "picked": {"name": JOURNEY_PICKED, "display_name": display(JOURNEY_PICKED)},
        "default": default,
        "added": [{"name": name, "display_name": display(name)} for name in added],
        "kept": kept,
        "order": order,
        "cell": [{"name": name, "display_name": display(name)} for name in order[:2]],
        "related": {"name": related, "display_name": display(related)},
    }
    return fixtures, plan


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
        journey, plan = correlation_fixtures(client)
        for name, path, params in (*API_FIXTURES, *journey):
            response = client.get(path, params=params)
            response.raise_for_status()
            (fixtures / name).write_text(response.text)
        (fixtures / "journey-10.json").write_text(json.dumps(plan, indent=2) + "\n")

    print(
        f"web-fixtures: {index['file_count']} static files + catalog tier "
        f"under {target.relative_to(REPO_ROOT)} (data {DATA_VERSION})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
