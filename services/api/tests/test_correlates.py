"""GET /v1/correlates against the synthetic data."""

import polars as pl
import pytest
from fastapi.testclient import TestClient
from flourish_api.config import Settings
from flourish_api.data import DataStore
from flourish_api.frames import assemble_correlates_frame
from flourish_api.main import create_app
from flourish_api.queries import parse_correlates_query
from flourish_api.routes.correlates import candidate_predictors
from flourish_stats import Design, adjusted_association, weighted_correlation
from flourish_stats.correlations import DEFAULT_CONTROLS

#: Every other servable ordered item at Y1 in the synthetic catalog, minus
#: the two scores built from HAPPY (sfi, sfi_happiness); nominal items
#: (GENDER, EMPLOYMENT, …), the country-specific INCOME and the MY-only
#: MONEY never qualify. EDUCATION_3 is in the catalog but has no rows.
HAPPY_Y1_PREDICTORS = {
    "LONELY",
    "ATTEND_SVCS",
    "CHILD_MEM",
    "BALANCE",
    "EDUCATION_3",
    "sfi_health",
    "sfi_meaning",
    "sfi_character",
    "sfi_relationships",
    "sfi_financial",
    "phq2_score",
    "phq2_positive",
    "gad2_score",
    "gad2_positive",
}


def get_correlates(client: TestClient, **params) -> tuple[dict, list[dict]]:
    resp = client.get("/v1/correlates", params=params)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    return body["meta"], body["rows"]


def test_ranked_sweep_covers_every_other_ordered_item(client: TestClient) -> None:
    meta, rows = get_correlates(client, outcome="HAPPY", wave="Y1", filter="country_code:1")
    assert {r["predictor"] for r in rows} == HAPPY_Y1_PREDICTORS
    assert meta["stat"] == "pearson_r" and meta["adjusted"] is False
    assert meta["weight_key"] == "y1" and meta["weight"] == "w_c1"
    assert meta["controls"] == [] and meta["model"] is None
    # Ranked by |r|, strongest first; the item with no data sorts last.
    strengths = [abs(r["estimate"]) for r in rows if r["estimate"] is not None]
    assert strengths == sorted(strengths, reverse=True)
    assert rows[-1]["predictor"] == "EDUCATION_3" and rows[-1]["n"] == 0


def test_unadjusted_rows_claim_no_interval(client: TestClient) -> None:
    _, rows = get_correlates(client, outcome="HAPPY", wave="Y1", filter="country_code:1")
    for row in rows:
        assert row["ci_method"] == "none" and row["se_method"] == "none"
        assert row["se"] is None and row["ci_lo"] is None and row["ci_hi"] is None
        assert row["weight"] == "w_c1" and row["measure"] is None
    assert all(-1 <= r["estimate"] <= 1 for r in rows if r["estimate"] is not None)


def test_limit_cuts_predictors_not_rows(client: TestClient) -> None:
    _, rows = get_correlates(
        client, outcome="HAPPY", wave="Y1", by="country_code", limit=3, method="spearman"
    )
    assert len({r["predictor"] for r in rows}) == 3
    assert len(rows) == 6  # 3 predictors × 2 countries
    assert all(r["stat"] == "spearman_r" for r in rows)


def test_ranking_with_groups_uses_the_median_strength(client: TestClient) -> None:
    from statistics import median

    _, everything = get_correlates(client, outcome="HAPPY", wave="Y1", by="country_code")
    _, top = get_correlates(client, outcome="HAPPY", wave="Y1", by="country_code", limit=2)
    strength: dict[str, list[float]] = {}
    for row in everything:
        strength.setdefault(row["predictor"], [])
        if row["estimate"] is not None:
            strength[row["predictor"]].append(abs(row["estimate"]))
    ranked = sorted(
        (name for name, values in strength.items() if values),
        key=lambda name: (-median(strength[name]), name),
    )
    assert [r["predictor"] for r in top[::2]] == ranked[:2]


def test_single_predictor_matches_the_engine(client: TestClient, store: DataStore) -> None:
    _, rows = get_correlates(
        client, outcome="HAPPY", wave="Y1", against="LONELY", by="country_code"
    )
    assert store.catalog is not None
    query = parse_correlates_query(
        store.catalog,
        outcome="HAPPY",
        wave="Y1",
        against=["LONELY"],
        method="pearson",
        adjusted=False,
        by=["country_code"],
        filters=[],
        limit=20,
    )
    assembled = assemble_correlates_frame(store, query, list(query.against))
    engine = {
        r["country_code"]: r
        for r in weighted_correlation(
            assembled.frame,
            "HAPPY",
            "LONELY",
            Design(weight="w_c1", strata="strata", psu="psu"),
            by=["country_code"],
        ).to_pylist()
    }
    assert len(rows) == 2
    for row in rows:
        expected = engine[row["group"]["country_code"]]
        assert row["estimate"] == pytest.approx(expected["estimate"])
        assert row["n"] == expected["n"] and row["predictor"] == "LONELY"


def test_named_predictors_keep_their_order_and_ignore_the_limit(client: TestClient) -> None:
    _, rows = get_correlates(
        client,
        outcome="HAPPY",
        wave="Y1",
        against=["gad2_score", "LONELY", "BALANCE"],
        by="country_code",
        limit=1,
    )
    assert [r["predictor"] for r in rows] == ["gad2_score"] * 2 + ["LONELY"] * 2 + ["BALANCE"] * 2


def test_adjusted_routes_to_the_model(client: TestClient, store: DataStore) -> None:
    meta, rows = get_correlates(
        client, outcome="HAPPY", wave="Y1", against="LONELY", adjusted="true", by="country_code"
    )
    assert meta["stat"] == "beta" and meta["adjusted"] is True and meta["model"] == "continuous"
    # Grouped by country: the country fixed effect leaves the control set.
    assert meta["controls"] == ["age_band", "gender", "education_3", "employment", "marital_status"]
    assert meta["se_method"] == "taylor"
    assert {r["measure"] for r in rows} == {"beta", "beta_per_sd"}
    for row in rows:
        assert row["ci_method"] == "normal" and row["se_method"] == "taylor"
        assert row["estimate"] is not None and row["se"] is not None
        assert row["ci_lo"] < row["estimate"] < row["ci_hi"]
    assert store.catalog is not None
    query = parse_correlates_query(
        store.catalog,
        outcome="HAPPY",
        wave="Y1",
        against=["LONELY"],
        method="pearson",
        adjusted=True,
        by=["country_code"],
        filters=[],
        limit=20,
    )
    assembled = assemble_correlates_frame(store, query, list(query.against))
    engine = {
        (r["country_code"], r["measure"]): r
        for r in adjusted_association(
            assembled.frame,
            "HAPPY",
            "LONELY",
            Design(weight="w_c1", strata="strata", psu="psu"),
            controls=DEFAULT_CONTROLS,
            by=["country_code"],
        ).to_pylist()
    }
    for row in rows:
        expected = engine[(row["group"]["country_code"], row["measure"])]
        assert row["estimate"] == pytest.approx(expected["estimate"])
        assert row["se"] == pytest.approx(expected["se"])


def test_binary_outcome_takes_the_logistic_model(client: TestClient) -> None:
    meta, rows = get_correlates(
        client,
        outcome="phq2_positive",
        wave="Y1",
        against="LONELY",
        adjusted="true",
        filter="country_code:1",
    )
    assert meta["model"] == "binary" and meta["stat"] == "beta"
    # One country in the frame: no country fixed effect either.
    assert "country_code" not in meta["controls"]
    assert all(r["estimate"] is not None for r in rows)


def test_adjusted_ranked_sweep(client: TestClient) -> None:
    _, rows = get_correlates(
        client, outcome="HAPPY", wave="Y1", adjusted="true", filter="country_code:1", limit=4
    )
    predictors = [r["predictor"] for r in rows[::2]]
    assert len(predictors) == 4 and len(rows) == 8
    per_sd = [abs(r["estimate"]) for r in rows if r["measure"] == "beta_per_sd"]
    assert per_sd == sorted(per_sd, reverse=True)


def test_filters_apply_as_domains(client: TestClient) -> None:
    meta_all, _ = get_correlates(client, outcome="HAPPY", wave="Y1", filter="country_code:1")
    meta_men, rows = get_correlates(
        client, outcome="HAPPY", wave="Y1", filter=["country_code:1", "gender:1"]
    )
    assert meta_men["n_frame"] == meta_all["n_frame"]  # design kept
    assert meta_men["n_valid"] < meta_all["n_valid"]
    assert meta_men["filters"] == {"country_code": [1], "gender": [1]}
    assert all(r["n"] <= meta_men["n_valid"] for r in rows)


def test_correlates_validation(client: TestClient) -> None:
    def detail(**params) -> list[str]:
        resp = client.get("/v1/correlates", params=params)
        assert resp.status_code == 422, resp.text
        return resp.json()["detail"]

    assert any(
        "unknown or non-servable" in m for m in detail(outcome="NOPE", wave="Y1", by="country_code")
    )
    assert any(
        "has no order" in m for m in detail(outcome="URBAN_RURAL", wave="Y1", by="country_code")
    )
    assert any(
        "not asked at MY" in m for m in detail(outcome="HAPPY", wave="MY", by="country_code")
    )
    assert any("wave must be" in m for m in detail(outcome="HAPPY", wave="Y9", by="country_code"))
    assert any(
        "not a servable variable" in m
        for m in detail(outcome="HAPPY", wave="Y1", against="INCOME", by="country_code")
    )
    assert any(
        "has no order" in m
        for m in detail(outcome="HAPPY", wave="Y1", against="URBAN_RURAL", by="country_code")
    )
    assert any(
        "cannot be the outcome" in m
        for m in detail(outcome="HAPPY", wave="Y1", against="HAPPY", by="country_code")
    )
    assert any(
        "duplicate against" in m
        for m in detail(outcome="HAPPY", wave="Y1", against=["LONELY", "LONELY"], by="country_code")
    )
    assert any(
        "not asked at Y1" in m
        for m in detail(outcome="HAPPY", wave="Y1", against="MONEY", by="country_code")
    )
    assert any(
        "method must be" in m
        for m in detail(outcome="HAPPY", wave="Y1", method="kendall", by="country_code")
    )
    assert any(
        "limit must be" in m for m in detail(outcome="HAPPY", wave="Y1", limit=0, by="country_code")
    )
    assert any(
        "limit must be" in m
        for m in detail(outcome="HAPPY", wave="Y1", limit=500, by="country_code")
    )
    assert any(
        "not a demographic breakdown" in m
        for m in detail(outcome="HAPPY", wave="Y1", by=["country_code", "ATTEND_SVCS"])
    )
    assert any(
        "duplicate" in m
        for m in detail(outcome="HAPPY", wave="Y1", by=["country_code", "country_code"])
    )
    assert any("group by country" in m for m in detail(outcome="HAPPY", wave="Y1"))
    assert any("column:value" in m for m in detail(outcome="HAPPY", wave="Y1", filter="gender"))
    assert any(
        "not filterable" in m for m in detail(outcome="HAPPY", wave="Y1", filter="shoe_size:9")
    )
    assert any(
        "unknown country" in m for m in detail(outcome="HAPPY", wave="Y1", filter="country_code:99")
    )
    assert any(
        "not an integer" in m for m in detail(outcome="HAPPY", wave="Y1", filter="country_code:xx")
    )
    assert any(
        "not one of" in m
        for m in detail(outcome="HAPPY", wave="Y1", filter=["country_code:1", "gender:9"])
    )


def test_candidates_leave_out_scores_built_from_the_outcome(store: DataStore) -> None:
    assert store.catalog is not None
    query = parse_correlates_query(
        store.catalog,
        outcome="sfi",
        wave="Y1",
        against=[],
        method="pearson",
        adjusted=False,
        by=["country_code"],
        filters=[],
        limit=20,
    )
    names = {info.name for info in candidate_predictors(store.catalog, query)}
    # The domains share the SFI's questions; HAPPY is one of them; the
    # screeners are built from other items and stay.
    assert not any(name.startswith("sfi") for name in names)
    assert "HAPPY" not in names and "LONELY" in names and "phq2_score" in names


def test_suppression_policy_is_honoured(synthetic_data_dir) -> None:
    settings = Settings(
        data_path=synthetic_data_dir / "flourish.duckdb",
        suppression_threshold=50,
        suppression_flag_below=100,
    )
    client = TestClient(create_app(settings))
    meta, rows = get_correlates(
        client, outcome="HAPPY", wave="Y1", against="LONELY", by=["country_code", "gender"]
    )
    assert meta["suppression"] == {"threshold": 50, "flag_below": 100}
    assert rows and all(r["suppressed"] and r["estimate"] is None and r["n"] > 0 for r in rows)
    _, whole = get_correlates(
        client, outcome="HAPPY", wave="Y1", against="LONELY", by="country_code"
    )
    assert all(not r["suppressed"] and r["flagged"] for r in whole)  # 54 < 100


def test_correlates_503_without_data(absent_client: TestClient) -> None:
    resp = absent_client.get("/v1/correlates", params={"outcome": "HAPPY", "wave": "Y1"})
    assert resp.status_code == 503


def test_descending_predictor_is_aligned_to_its_label(client: TestClient, store: DataStore) -> None:
    """ATTEND_SVCS runs 1 = Weekly … 3 = Never, so its lowest code is the
    most attendance (catalog polarity ``descending``). The served
    correlation is taken on the aligned values — exactly the negative of
    the correlation on the raw codes (ADR-0015)."""
    _, rows = get_correlates(
        client, outcome="HAPPY", wave="Y1", against="ATTEND_SVCS", filter="country_code:1"
    )
    assert store.catalog is not None
    happy, attend = store.catalog.outcome("HAPPY"), store.catalog.outcome("ATTEND_SVCS")
    assert happy is not None and attend is not None
    assert happy.polarity == "ascending" and attend.polarity == "descending"
    raw = store.wide_frame([happy, attend], "Y1", country_codes=[1]).filter(
        pl.col("w_c1").is_not_null()
    )
    design = Design(weight="w_c1", strata="strata", psu="psu")
    unaligned = weighted_correlation(raw, "HAPPY", "ATTEND_SVCS", design).to_pylist()[0]
    assert unaligned["estimate"] is not None and unaligned["estimate"] != 0
    assert rows[0]["estimate"] == pytest.approx(-unaligned["estimate"], rel=1e-12)
