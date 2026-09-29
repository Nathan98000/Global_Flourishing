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


def test_mean_by_age_band_shows_every_cell_live(built_client: TestClient) -> None:
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
    # ADR-0011: nothing withheld or flagged, even the smallest band; the
    # n rides on every row so a reader can see what a number rests on.
    assert all(not r["flagged"] and not r["suppressed"] for r in rows)
    assert all(r["n"] > 0 and r["estimate"] is not None for r in rows)


@pytest.mark.parametrize(
    ("score", "items"),
    [("phq2_score", ("DEPRESSED", "INTEREST")), ("gad2_score", ("FEEL_ANXIOUS", "CONTROL_WORRY"))],
)
def test_screener_items_align_positively_with_their_score(
    built_client: TestClient, score: str, items: tuple[str, str]
) -> None:
    """The PHQ-2/GAD-2 items are 1 = Nearly every day … 4 = Not at all and
    their score rescores each 4 − code. Served on aligned values
    (ADR-0015), each item runs WITH its own score; the catalog says so
    (polarity descending). Needs the polarity bake (`make data`)."""
    catalog = {v["name"]: v for v in built_client.get("/v1/variables").json()["variables"]}
    assert all(catalog[item]["polarity"] == "descending" for item in items)
    resp = built_client.get(
        "/v1/correlates",
        params={
            "outcome": score,
            "wave": "Y1",
            "against": list(items),
            "filter": "country_code:22",
        },
    )
    assert resp.status_code == 200, resp.text
    rows = {row["predictor"]: row for row in resp.json()["rows"]}
    assert set(rows) == set(items)
    for item in items:
        assert rows[item]["estimate"] is not None and rows[item]["estimate"] > 0.5, item


# --- All countries: the average of the countries (ADR-0020) ----------------

#: A slice of the release's questions for the precompute checks: 0–10,
#: ordered and yes/no items, a derived score and its own question.
PRECOMPUTE_SLICE = [
    "WB_TODAY",
    "INCOME_FEELINGS",
    "HAPPY",
    "LIFE_SAT",
    "sfi",
    "DEPRESSED",
    "phq2_score",
]


def test_all_countries_averages_every_country_of_the_release(built_client: TestClient) -> None:
    meta = built_client.get("/v1/meta").json()
    params = {"outcome": "WB_TODAY", "wave": "Y1", "against": "INCOME_FEELINGS"}
    body = built_client.get("/v1/correlates", params={**params, "pooled": "average"}).json()
    assert body["meta"]["countries"] == sorted(country["code"] for country in meta["countries"])
    row = body["rows"][0]
    assert row["n_countries"] == 23
    dots = built_client.get("/v1/correlates", params={**params, "by": "country_code"}).json()
    shown = [r["estimate"] for r in dots["rows"]]
    assert row["estimate"] == pytest.approx(sum(shown) / len(shown), abs=1e-15)


def test_attendance_and_life_evaluation_average_about_a_tenth(built_client: TestClient) -> None:
    """The review's case (29 Sept): positive in 20 of 23 countries, 0.00
    pooled by population — the plain average reads about +0.10."""
    body = built_client.get(
        "/v1/correlates",
        params={"outcome": "ATTEND_SVCS", "wave": "Y1", "against": "WB_TODAY", "pooled": "average"},
    ).json()
    assert body["rows"][0]["estimate"] == pytest.approx(0.10, abs=0.015)


def test_the_precompute_equals_the_on_demand_estimator_on_the_release(tmp_path: Path) -> None:
    from flourish_api import country_correlations
    from flourish_api.config import Settings
    from flourish_api.data import DataStore
    from flourish_api.main import create_app

    data = REPO_ROOT / "data" / "flourish.duckdb"
    file = tmp_path / "country_slice.parquet"
    store = DataStore(Settings(data_path=data))
    assert country_correlations.write(store, file, only=PRECOMPUTE_SLICE) > 0
    store.close()
    served = TestClient(
        create_app(Settings(data_path=data, country_correlations_path=file, cache_size=0))
    )
    assert served.app.state.country_correlations is not None  # type: ignore[attr-defined]
    fresh = TestClient(
        create_app(
            Settings(
                data_path=data,
                country_correlations_path=tmp_path / "absent.parquet",
                cache_size=0,
            )
        )
    )
    for method in ("pearson", "spearman"):
        params = {"vars": PRECOMPUTE_SLICE[:5], "wave": "Y1", "method": method, "pooled": "average"}
        got = served.get("/v1/correlations", params=params).json()
        want = fresh.get("/v1/correlations", params=params).json()
        assert got["meta"] == want["meta"]
        for a, b in zip(got["pairs"], want["pairs"], strict=True):
            assert (a["a"], a["b"], a["shares_answers"]) == (b["a"], b["b"], b["shares_answers"])
            if b["correlation"] is None:
                assert a["correlation"] is None
                continue
            assert abs(a["correlation"]["estimate"] - b["correlation"]["estimate"]) <= 1e-12
            assert a["correlation"]["n"] == b["correlation"]["n"]
            assert a["correlation"]["n_countries"] == b["correlation"]["n_countries"]
            assert a["correlation"]["sum_w"] == pytest.approx(b["correlation"]["sum_w"], rel=1e-12)
        against = {"outcome": "DEPRESSED", "wave": "Y1", "against": ["HAPPY", "WB_TODAY"]}
        for extra in ({"pooled": "average"}, {"by": "country_code"}):
            query = {**against, "method": method, **extra}
            got_rows = served.get("/v1/correlates", params=query).json()["rows"]
            want_rows = fresh.get("/v1/correlates", params=query).json()["rows"]
            for a, b in zip(got_rows, want_rows, strict=True):
                assert a["group"] == b["group"] and a["n"] == b["n"]
                if b["estimate"] is None:
                    assert a["estimate"] is None
                else:
                    assert abs(a["estimate"] - b["estimate"]) <= 1e-12


# --- midyear pairs (ADR-0020) ----------------------------------------------


@pytest.mark.parametrize(
    ("other", "people", "weight"), [("Y1", 131_487, "w_l1m"), ("Y2", 116_038, "w_l1m2")]
)
def test_each_midyear_pairing_is_its_own_frame_on_the_release(
    built_client: TestClient, other: str, people: int, weight: str
) -> None:
    body = built_client.get(
        "/v1/correlations/pair",
        params={
            "y": "WB_TODAY",
            "x": "TIME_MEDIA",
            "wave": "MY",
            "other_wave": other,
            "pooled": "average",
        },
    ).json()
    meta = body["shares"]["meta"]
    assert meta["n_frame"] == people
    assert meta["weight"] == weight
    assert meta["answer_waves"] == {"TIME_MEDIA": "MY", "WB_TODAY": other}


def test_six_countries_answer_the_2024_pairing_in_one_interview(built_client: TestClient) -> None:
    """ADR-0020's note: in China, Hong Kong, Israel, Japan, Sweden and the
    United States every midyear respondent who also did Wave 2 answered
    the midyear items in the Wave 2 interview (midyear_type 2); two in
    three of the 116,038 did overall."""
    store = built_client.app.state.store  # type: ignore[attr-defined]
    rows = store.con.execute(
        "SELECT c.iso3, count(*) FILTER (WHERE midyear_type = 2), count(*) "
        "FROM respondents r JOIN countries c ON c.code = r.country_code "
        "WHERE has_midyear AND retained_y2 GROUP BY 1"
    ).fetchall()
    same_day = {iso3 for iso3, type_2, total in rows if type_2 == total}
    assert same_day == {"CHN", "HKG", "ISR", "JPN", "SWE", "USA"}
    share = sum(type_2 for _, type_2, _ in rows) / sum(total for _, _, total in rows)
    assert 0.64 < share < 0.68


def test_the_midyear_timing_the_page_words_on_the_release(built_client: TestClient) -> None:
    """The review's facts (M4), as /v1/meta serves them: with 2024 answers,
    six countries took the midyear items inside the Wave 2 interview, ten
    in a standalone interview about six months before it, seven both ways;
    two in three people in all, the All countries wording."""
    meta = built_client.get("/v1/meta").json()
    names = {row["code"]: row["name"] for row in meta["countries"]}
    rows = [row for row in meta["midyear_timing"] if row["other_wave"] == "Y2"]
    same = {names[row["country_code"]] for row in rows if row["type_1"] == 0}
    separate = {names[row["country_code"]] for row in rows if row["type_2"] == 0}
    assert same == {"China", "Hong Kong", "Israel", "Japan", "Sweden", "United States"}
    assert separate == {
        "Australia",
        "Egypt",
        "India",
        "Indonesia",
        "Kenya",
        "Philippines",
        "Poland",
        "South Africa",
        "Tanzania",
        "Türkiye",
    }
    assert len(rows) == 23
    share = sum(row["type_2"] for row in rows) / sum(row["type_1"] + row["type_2"] for row in rows)
    assert 0.64 < share < 0.68


def test_no_displayed_wording_carries_a_codebook_placeholder(built_client: TestClient) -> None:
    """Review H2: every wording the page shows — the summaries and the
    codebook entries alike — reads as a question, never "[EXAMPLE]"."""
    variables = built_client.get("/v1/variables").json()["variables"]
    bracketed = [row["name"] for row in variables if "[" in (row["wording"] or "")]
    assert bracketed == []
    detail = built_client.get("/v1/variables/TIME_MEDIA").json()
    assert detail["wording"].endswith("(the survey named popular ones in each country)?")
