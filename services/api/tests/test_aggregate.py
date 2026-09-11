"""GET /v1/aggregate against the synthetic data."""

import polars as pl
import pytest
from fastapi.testclient import TestClient
from flourish_api.data import DataStore
from flourish_api.frames import assemble_aggregate_frame
from flourish_api.queries import parse_aggregate_query
from flourish_stats import Design, weighted_mean


def get_rows(client: TestClient, **params) -> tuple[dict, list[dict]]:
    resp = client.get("/v1/aggregate", params=params)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    return body["meta"], body["rows"]


def test_mean_by_country_matches_the_engine_exactly(client: TestClient, store: DataStore) -> None:
    meta, rows = get_rows(client, outcome="HAPPY", wave="Y1", by="country_code")
    assert store.catalog is not None
    query = parse_aggregate_query(
        store.catalog,
        outcome="HAPPY",
        stat="mean",
        wave="Y1",
        by=["country_code"],
        filters=[],
        scope="global",
        oriented=False,
        p=None,
    )
    assembled = assemble_aggregate_frame(store, query)
    engine = weighted_mean(
        assembled.frame,
        "value",
        Design(weight="w_c1", strata="strata", psu="psu"),
        by=["country_code"],
    ).to_pylist()
    by_country = {r["country_code"]: r for r in engine}
    for row in rows:
        expected = by_country[row["group"]["country_code"]]
        assert row["estimate"] == pytest.approx(expected["estimate"])
        assert row["se"] == pytest.approx(expected["se"])
        assert row["n"] == expected["n"]
        assert row["suppressed"] == expected["suppressed"]
    assert meta["weight_key"] == "y1" and meta["weight"] == "w_c1"
    assert meta["se_method"] == "taylor"


def test_every_row_carries_the_full_record(client: TestClient) -> None:
    _, rows = get_rows(client, outcome="HAPPY", wave="Y1", by="country_code")
    required = {
        "group",
        "stat",
        "estimate",
        "se",
        "ci_lo",
        "ci_hi",
        "ci_level",
        "ci_method",
        "n",
        "sum_w",
        "n_psu",
        "n_strata",
        "df",
        "se_method",
        "weight",
        "suppressed",
        "flagged",
    }
    for row in rows:
        assert required <= set(row)
        assert row["weight"] == "w_c1" and row["se_method"] == "taylor"


def test_small_cells_are_suppressed_but_visible(client: TestClient) -> None:
    _, rows = get_rows(client, outcome="HAPPY", wave="Y1", by=["country_code", "age_band"])
    assert len(rows) == 8  # 2 countries × 4 bands
    assert all(r["suppressed"] for r in rows)  # 15-ish per cell < 50
    assert all(r["estimate"] is None and r["n"] > 0 for r in rows)


def test_whole_country_cells_are_flagged_not_suppressed(client: TestClient) -> None:
    _, rows = get_rows(client, outcome="HAPPY", wave="Y1", by="country_code")
    # 54 valid of 60 respondents per country: above threshold, below 100.
    assert all(not r["suppressed"] and r["flagged"] for r in rows)
    assert all(r["estimate"] is not None for r in rows)


def test_proportion_ships_catalog_levels(client: TestClient) -> None:
    _, rows = get_rows(
        client, outcome="ATTEND_SVCS", wave="Y1", stat="proportion", by="country_code"
    )
    levels = {(r["group"]["country_code"], r["level"]) for r in rows}
    assert levels == {(c, level) for c in (1, 22) for level in (1, 2, 3)}
    # 20 respondents per level per country: under the fixed threshold, so
    # the shares are suppressed — but the per-level counts stay visible
    # and sum to the country's respondents.
    for country in (1, 22):
        country_rows = [r for r in rows if r["group"]["country_code"] == country]
        assert all(r["suppressed"] and r["estimate"] is None for r in country_rows)
        assert sum(r["n"] for r in country_rows) == 60
        assert all(r["sum_w"] > 0 for r in country_rows)  # denominator survives


def test_distribution_of_a_0_10_item_has_11_bins(client: TestClient) -> None:
    _, rows = get_rows(
        client,
        outcome="HAPPY",
        wave="Y1",
        stat="distribution",
        filter="country_code:1",
    )
    assert [r["level"] for r in rows] == list(range(11))


def test_quantile_rows(client: TestClient) -> None:
    _, rows = get_rows(
        client,
        outcome="HAPPY",
        wave="Y1",
        stat="quantile",
        by="country_code",
        p=[0.25, 0.5],
    )
    assert {r["p"] for r in rows} == {0.25, 0.5}
    assert all(r["se"] is None and r["ci_method"] == "none" for r in rows)


def test_oriented_flips_the_mean(client: TestClient, store: DataStore) -> None:
    _, plain = get_rows(client, outcome="LONELY", wave="Y1", filter="country_code:1")
    _, oriented = get_rows(
        client, outcome="LONELY", wave="Y1", filter="country_code:1", oriented=True
    )
    assert plain[0]["estimate"] + oriented[0]["estimate"] == pytest.approx(10.0)
    assert plain[0]["se"] == pytest.approx(oriented[0]["se"])


def test_by_variable_breakdown_end_to_end(client: TestClient) -> None:
    meta, rows = get_rows(client, outcome="HAPPY", wave="Y1", by=["country_code", "ATTEND_SVCS"])
    assert meta["by"] == ["country_code", "ATTEND_SVCS"]
    assert {r["group"]["ATTEND_SVCS"] for r in rows} == {1, 2, 3}


def test_domain_filter_changes_n_valid_not_n_frame(client: TestClient) -> None:
    meta_all, _ = get_rows(client, outcome="HAPPY", wave="Y1", filter="country_code:1")
    meta_men, _ = get_rows(
        client, outcome="HAPPY", wave="Y1", filter=["country_code:1", "gender:1"]
    )
    assert meta_men["n_frame"] == meta_all["n_frame"] == 60  # design kept
    assert meta_men["n_valid"] < meta_all["n_valid"]
    assert meta_men["filters"] == {"country_code": [1], "gender": [1]}


def test_validation_errors_are_422_with_messages(client: TestClient) -> None:
    resp = client.get(
        "/v1/aggregate", params={"outcome": "MONEY", "wave": "Y1", "by": "country_code"}
    )
    assert resp.status_code == 422
    assert any("MONEY is not asked at Y1" in m for m in resp.json()["detail"])
    resp = client.get(
        "/v1/aggregate",
        params={"outcome": "HAPPY", "wave": "Y1", "scope": "us_state_adj", "by": "state"},
    )
    assert resp.status_code == 422
    assert any("no weight exists for wave Y1" in m for m in resp.json()["detail"])


def test_503_without_data(absent_client: TestClient) -> None:
    resp = absent_client.get(
        "/v1/aggregate", params={"outcome": "HAPPY", "wave": "Y1", "by": "country_code"}
    )
    assert resp.status_code == 503


def test_derived_outcome_share(client: TestClient) -> None:
    _, rows = get_rows(client, outcome="phq2_positive", wave="Y1", by="country_code")
    for row in rows:
        assert 0.0 <= row["estimate"] <= 1.0  # a share


def test_catalog_frames_stay_polars(store: DataStore) -> None:
    assert store.catalog is not None
    assert isinstance(store.catalog.variables, pl.DataFrame)
