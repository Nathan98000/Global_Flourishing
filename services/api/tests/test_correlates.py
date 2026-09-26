"""GET /v1/correlates against the synthetic data."""

import polars as pl
import pytest
from fastapi.testclient import TestClient
from flourish_api.config import Settings
from flourish_api.data import ADJUSTED_OFF, DataStore, VariableInfo
from flourish_api.frames import assemble_correlates_frame
from flourish_api.main import create_app
from flourish_api.queries import parse_correlates_query
from flourish_api.routes import correlates as correlates_route
from flourish_api.routes.correlates import candidate_predictors, drop_overlaps, stands_in_for
from flourish_api.schemas import EstimateRow
from flourish_stats import Design, adjusted_association, weighted_correlation
from flourish_stats.correlations import DEFAULT_CONTROLS

#: Every other servable ordered item at Y1 in the synthetic catalog, minus
#: the two scores built from HAPPY (sfi, sfi_happiness); nominal items
#: (GENDER, EMPLOYMENT, …), the country-specific INCOME and the MY-only
#: MONEY never qualify. EDUCATION_3 is in the catalog but has no rows, so
#: the ranked sweep leaves it out (n = 0 < the test app's min_n of 20).
HAPPY_Y1_PREDICTORS = {
    "LONELY",
    "ATTEND_SVCS",
    "CHILD_MEM",
    "BALANCE",
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

#: What the ranked sweep leaves out as overlap: each screen-positive flag
#: shares both its answers with its score, and the score (non-binary)
#: stands in for it (ADR-0018).
HAPPY_Y1_OVERLAP = {"phq2_positive": "phq2_score", "gad2_positive": "gad2_score"}


def get_correlates(client: TestClient, **params) -> tuple[dict, list[dict]]:
    resp = client.get("/v1/correlates", params=params)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    return body["meta"], body["rows"]


def test_ranked_sweep_covers_every_other_ordered_item(client: TestClient) -> None:
    meta, rows = get_correlates(client, outcome="HAPPY", wave="Y1", filter="country_code:1")
    assert {r["predictor"] for r in rows} == HAPPY_Y1_PREDICTORS - set(HAPPY_Y1_OVERLAP)
    assert meta["dropped_overlap"] == HAPPY_Y1_OVERLAP
    assert meta["stat"] == "pearson_r" and meta["adjusted"] is False
    assert meta["weight_key"] == "y1" and meta["weight"] == "w_c1"
    assert meta["controls"] == [] and meta["model"] is None
    # Ranked by |r|, strongest first; the item with no data is not ranked.
    strengths = [abs(r["estimate"]) for r in rows if r["estimate"] is not None]
    assert strengths == sorted(strengths, reverse=True)
    assert meta["min_n"] == 20 and meta["n_excluded"] == 1
    assert all(r["n"] >= 20 for r in rows)


def test_ranked_sweep_excludes_predictors_below_min_n(synthetic_data_dir) -> None:
    """The serving floor (ADR-0015): with 60 people per synthetic country,
    a floor of 100 ranks nothing — every candidate is reported excluded —
    while named predictors are still served in full, for the matrix to
    mute rather than hide."""
    settings = Settings(data_path=synthetic_data_dir / "flourish.duckdb")
    assert settings.correlates_min_n == 100
    client = TestClient(create_app(settings))
    meta, rows = get_correlates(client, outcome="HAPPY", wave="Y1", filter="country_code:1")
    assert rows == []
    assert meta["min_n"] == 100 and meta["n_excluded"] == len(HAPPY_Y1_PREDICTORS) + 1
    assert meta["dropped_overlap"] == {}
    meta, named = get_correlates(
        client, outcome="HAPPY", wave="Y1", against="LONELY", filter="country_code:1"
    )
    assert len(named) == 1 and named[0]["n"] == 54 and named[0]["estimate"] is not None
    assert meta["min_n"] == 100 and meta["n_excluded"] == 0
    assert meta["dropped_overlap"] == {}
    # Grouped: a predictor ranks on the groups that clear the floor.
    lowered = TestClient(
        create_app(Settings(data_path=synthetic_data_dir / "flourish.duckdb", correlates_min_n=54))
    )
    meta, grouped = get_correlates(lowered, outcome="HAPPY", wave="Y1", by="country_code")
    assert meta["n_excluded"] >= 1 and all(
        any(r["n"] >= 54 for r in grouped if r["predictor"] == name)
        for name in {r["predictor"] for r in grouped}
    )


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


def test_adjusted_routes_to_the_model(adjusted_client: TestClient, store: DataStore) -> None:
    meta, rows = get_correlates(
        adjusted_client,
        outcome="HAPPY",
        wave="Y1",
        against="LONELY",
        adjusted="true",
        by="country_code",
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


def test_binary_outcome_takes_the_logistic_model(adjusted_client: TestClient) -> None:
    meta, rows = get_correlates(
        adjusted_client,
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


def test_adjusted_ranked_sweep(adjusted_client: TestClient) -> None:
    _, rows = get_correlates(
        adjusted_client,
        outcome="HAPPY",
        wave="Y1",
        adjusted="true",
        filter="country_code:1",
        limit=4,
    )
    predictors = [r["predictor"] for r in rows[::2]]
    assert len(predictors) == 4 and len(rows) == 8
    per_sd = [abs(r["estimate"]) for r in rows if r["measure"] == "beta_per_sd"]
    assert per_sd == sorted(per_sd, reverse=True)


def test_adjusted_is_refused_by_default_before_any_work(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """ADR-0018: with FA_ADJUSTED_ENABLED unset (the default, and the
    deploy's) an adjusted request is a 422 with the plain message, and
    nothing is parsed, loaded or estimated for it."""

    def no_work(*args: object, **kwargs: object) -> None:
        raise AssertionError("an adjusted request did work while the setting is off")

    monkeypatch.setattr(correlates_route, "parse_correlates_query", no_work)
    monkeypatch.setattr(correlates_route, "run_correlates", no_work)
    monkeypatch.setattr(correlates_route, "assemble_correlates_frame", no_work)
    assert Settings().adjusted_enabled is False
    resp = client.get(
        "/v1/correlates",
        params={"outcome": "HAPPY", "wave": "Y1", "adjusted": "true", "by": "country_code"},
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == [ADJUSTED_OFF]
    assert ADJUSTED_OFF == "Adjusted associations are not offered on this server."
    # adjusted=false is the ordinary request.
    monkeypatch.undo()
    ok = client.get(
        "/v1/correlates",
        params={"outcome": "HAPPY", "wave": "Y1", "adjusted": "false", "filter": "country_code:1"},
    )
    assert ok.status_code == 200 and ok.json()["meta"]["adjusted"] is False


def test_the_openapi_description_says_adjusted_is_off(client: TestClient) -> None:
    schema = client.get("/openapi.json").json()
    parameters = schema["paths"]["/v1/correlates"]["get"]["parameters"]
    adjusted = next(p for p in parameters if p["name"] == "adjusted")
    assert "disabled unless the server enables it" in adjusted["description"]


def _info(name: str, scale_type: str = "scale_0_10", derived: bool = False) -> VariableInfo:
    return VariableInfo(
        name=name,
        display_name=name,
        scale_type=scale_type,
        direction="higher_better",
        polarity="ascending",
        min=0,
        max=10,
        waves=("Y1",),
        is_derived=derived,
    )


def test_a_score_stands_in_for_its_questions_and_its_flag() -> None:
    score = _info("phq2_score", "count", derived=True)
    flag = _info("phq2_positive", "binary", derived=True)
    item = _info("DEPRESSED", "ordinal")
    sfi, domain = _info("sfi", derived=True), _info("sfi_meaning", derived=True)
    # More answers wins; on a tie the non-binary one; a full tie never flips.
    assert stands_in_for(score, item) and not stands_in_for(item, score)
    assert stands_in_for(score, flag) and not stands_in_for(flag, score)
    assert stands_in_for(flag, item)
    assert stands_in_for(sfi, domain) and not stands_in_for(domain, sfi)
    assert not stands_in_for(score, score)


def test_drop_overlaps_keeps_the_score_and_backfills_to_the_limit() -> None:
    """The prompt's example: phq2_score beats its items DEPRESSED and
    INTEREST, and beats phq2_positive; the list backfills from further
    down so the limit still holds, in rank order."""
    names = {
        "DEPRESSED": ("ordinal", False),
        "LONELY": ("scale_0_10", False),
        "phq2_score": ("count", True),
        "INTEREST": ("ordinal", False),
        "phq2_positive": ("binary", True),
        "BALANCE": ("scale_0_10", False),
        "HOPE": ("scale_0_10", False),
        "CALM": ("scale_0_10", False),
    }
    infos = {name: _info(name, scale, derived) for name, (scale, derived) in names.items()}
    ranked = [(name, list[EstimateRow]()) for name in names]  # strongest first
    kept, dropped = drop_overlaps(ranked, infos, limit=4)
    assert [name for name, _ in kept] == ["LONELY", "phq2_score", "BALANCE", "HOPE"]
    assert dropped == {
        "DEPRESSED": "phq2_score",
        "INTEREST": "phq2_score",
        "phq2_positive": "phq2_score",
    }
    # Only kept predictors compete: a score below the cut never displaces
    # its question, and nothing past the cut is reported.
    kept, dropped = drop_overlaps(ranked, infos, limit=2)
    assert [name for name, _ in kept] == ["DEPRESSED", "LONELY"]
    assert dropped == {}


def test_the_ranked_sweep_backfills_after_dropping_overlap(client: TestClient) -> None:
    """End to end on the synthetic data: however the cut falls, no two
    predictors in the list share answers and the list is `limit` long."""
    _, everything = get_correlates(client, outcome="HAPPY", wave="Y1", filter="country_code:1")
    for limit in range(1, len(everything) + 1):
        meta, rows = get_correlates(
            client, outcome="HAPPY", wave="Y1", filter="country_code:1", limit=limit
        )
        listed = [r["predictor"] for r in rows]
        assert len(listed) == limit
        assert not ({"phq2_score", "phq2_positive"} <= set(listed))
        assert not ({"gad2_score", "gad2_positive"} <= set(listed))
        assert set(meta["dropped_overlap"]) <= set(HAPPY_Y1_OVERLAP)
        assert all(winner in listed for winner in meta["dropped_overlap"].values())


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
