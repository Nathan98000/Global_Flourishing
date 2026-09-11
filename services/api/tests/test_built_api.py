"""End-to-end against the real built data (marked `built`; skipped in CI).

The API must reproduce, through HTTP, what the engine proved in Phase 2:
the committed Wave-1 SFI table and the R-parity reference values.
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.built

REPO_ROOT = Path(__file__).resolve().parents[3]

# From data/validation_report.md ("Wave 1 SFI by country"): top and bottom.
SFI_EXPECTATIONS = [
    ("Indonesia", 7, 8.10, 6_965),
    ("Israel", 8, 7.87, 3_667),
    ("Türkiye", 19, 6.32, 1_473),
    ("Japan", 9, 5.89, 20_500),
]


def rows_by_country(body: dict) -> dict[int, dict]:
    return {row["group"]["country_code"]: row for row in body["rows"]}


def test_sfi_by_country_reproduces_the_validation_report(built_client: TestClient) -> None:
    resp = built_client.get(
        "/v1/aggregate", params={"outcome": "sfi", "wave": "Y1", "by": "country_code"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["meta"]["weight"] == "w_c1"
    assert body["meta"]["data_version"] == built_client.get("/health").json()["data_version"]
    by_country = rows_by_country(body)
    assert len(by_country) == 23
    for _, code, mean, n in SFI_EXPECTATIONS:
        row = by_country[code]
        assert row["estimate"] == pytest.approx(mean, abs=0.005)
        assert row["n"] == n
        assert not row["suppressed"]
        assert row["se_method"] == "taylor" and row["se"] is not None


def test_change_matches_the_r_parity_reference(built_client: TestClient) -> None:
    """/v1/change on Hong Kong HAPPY equals the committed R value."""
    reference = json.loads((REPO_ROOT / "stats" / "verify" / "reference.json").read_text())
    case = next(c for c in reference["cases"] if c["id"] == "change_happy_y1y2_hongkong")
    resp = built_client.get(
        "/v1/change",
        params={"outcome": "HAPPY", "from": "Y1", "to": "Y2", "filter": "country_code:24"},
    )
    assert resp.status_code == 200
    row = next(r for r in resp.json()["rows"] if r["stat"] == "change")
    assert row["estimate"] == pytest.approx(case["expect"]["estimate"], abs=1e-9)
    assert row["se"] == pytest.approx(case["expect"]["se"], rel=1e-6)
    assert row["n"] == case["expect"]["n"]
    assert resp.json()["meta"]["weight"] == "w_l2"


def test_states_serves_the_us_states(built_client: TestClient) -> None:
    resp = built_client.get("/v1/states", params={"outcome": "HAPPY", "wave": "Y1"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["meta"]["weight"] == "w_state_c1"
    states = {row["group"]["state"] for row in body["rows"]}
    assert 40 <= len(states) <= 60  # 50 states + DC and poolings
    assert "CA" in states


def test_mean_by_age_band_shows_suppression_machinery_live(built_client: TestClient) -> None:
    resp = built_client.get(
        "/v1/aggregate",
        params={
            "outcome": "HAPPY",
            "wave": "Y1",
            "by": "age_band",
            "filter": "country_code:19",  # Türkiye, n=1,473: small cells exist
        },
    )
    body = resp.json()
    rows = [r for r in body["rows"] if r["group"]["age_band"] is not None]
    assert any(r["flagged"] or r["suppressed"] for r in rows)
    assert all(r["n"] > 0 for r in rows)
