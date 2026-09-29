"""Pooled requests — All countries, each weighted to its adult population
(ADR-0020) — against the synthetic data: the parameter and its 422s, the
numbers against the engine on a hand-pooled frame, coverage when a country
did not ask a question, and the precomputed file against the on-demand
estimator (equal to 1e-12)."""

import shutil
from pathlib import Path

import duckdb
import polars as pl
import pytest
from fastapi.testclient import TestClient
from flourish_api import pooled as pooled_module
from flourish_api.data import DataStore
from flourish_api.frames import COUNTRY_BIT, countries_in, coverage_masks, pool_countries
from flourish_api.main import create_app
from flourish_api.routes import correlates as correlates_route
from flourish_api.routes import correlations as correlations_route
from flourish_stats import Design, pooled_population_weights, resolve, weighted_correlation
from flourish_stats.correlations import Method
from flourish_stats.io import aligned_expr
from synthetic_db import SYNTHETIC_POPULATIONS, synthetic_settings
from test_contract import assert_json_close

POPULATIONS = {1: float(SYNTHETIC_POPULATIONS["TST"]), 22: float(SYNTHETIC_POPULATIONS["USA"])}


def get(client: TestClient, path: str, **params: object) -> dict:
    response = client.get(path, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def problems(client: TestClient, path: str, **params: object) -> list[str]:
    response = client.get(path, params=params)
    assert response.status_code == 422, response.text
    return response.json()["detail"]


# --- the parameter --------------------------------------------------------


def test_pooled_takes_the_place_of_a_country_and_says_so(client: TestClient) -> None:
    body = get(client, "/v1/correlates", outcome="HAPPY", wave="Y1", pooled="population")
    meta = body["meta"]
    assert meta["pooled"] == "population"
    assert meta["countries"] == [1, 22]
    assert meta["population_source"] == "Synthetic test populations"
    assert meta["filters"] == {}
    assert meta["weight_key"] == "y1" and meta["weight"] == "w_c1"
    # Every country asked every question here: each estimate covers both.
    assert body["rows"] and all(row["n_countries"] == 2 for row in body["rows"])
    # The floor and the dedupe are unchanged.
    assert meta["min_n"] == 20
    assert meta["dropped_overlap"] == {"phq2_positive": "phq2_score", "gad2_positive": "gad2_score"}
    # A one-country response carries none of it.
    single = get(client, "/v1/correlates", outcome="HAPPY", wave="Y1", filter="country_code:1")
    assert single["meta"]["pooled"] is None and single["meta"]["countries"] is None
    assert all(row["n_countries"] is None for row in single["rows"])


def test_every_new_refusal(client: TestClient, adjusted_client: TestClient) -> None:
    # Every problem at once: an unknown pooling is no pooling at all.
    assert problems(client, "/v1/correlates", outcome="HAPPY", wave="Y1", pooled="gdp")[0] == (
        "pooled must be one of ['population'], got 'gdp'"
    )
    (message,) = problems(
        client,
        "/v1/correlates",
        outcome="HAPPY",
        wave="Y1",
        pooled="population",
        filter="country_code:1",
    )
    assert "drop the country filter" in message
    (message,) = problems(
        client, "/v1/correlates", outcome="HAPPY", wave="Y1", pooled="population", by="country_code"
    )
    assert "drop by=country_code" in message
    for path, params in (
        ("/v1/correlations/pair", {"y": "HAPPY", "x": "LONELY"}),
        ("/v1/correlations", {"vars": ["HAPPY", "LONELY"]}),
    ):
        (message,) = problems(
            client, path, wave="Y1", pooled="population", filter="country_code:22", **params
        )
        assert "drop the country filter" in message
        # Neither a country nor pooling: the one-country rule stands.
        (message,) = problems(client, path, wave="Y1", **params)
        assert "exactly one country" in message and "pooled=population" in message
    (message,) = problems(client, "/v1/correlates", outcome="HAPPY", wave="Y1")
    assert "pooled=population" in message
    assert problems(
        adjusted_client,
        "/v1/correlates",
        outcome="HAPPY",
        wave="Y1",
        against="LONELY",
        adjusted="true",
        pooled="population",
    ) == ["pooled=population serves plain correlations; drop adjusted=true"]
    # Country by country is unchanged, and never pooled.
    across = get(client, "/v1/correlates", outcome="HAPPY", wave="Y1", by="country_code")
    assert across["meta"]["pooled"] is None


# --- the numbers ----------------------------------------------------------


def hand_pooled(store: DataStore, x: str, y: str, wave: str, method: Method = "pearson") -> dict:
    """The correlation the engine gives on the eligible frame pooled by
    hand: every respondent, each country's weights rescaled to its
    population, both items aligned to their labels."""
    spec = resolve((wave,), "global")
    assert store.catalog is not None
    infos = [store.catalog.outcome(x), store.catalog.outcome(y)]
    assert infos[0] is not None and infos[1] is not None
    infos = [infos[0], infos[1]]
    frame = store.wide_frame(infos, wave, extra_columns=(spec.weight,))
    frame = frame.filter(pl.col(spec.weight).is_not_null() & (pl.col("country_code") > 0))
    frame = pooled_population_weights(frame, POPULATIONS, weight=spec.weight)
    for info in infos:
        frame = frame.with_columns(
            aligned_expr(info.name, polarity=info.polarity, lo=info.min, hi=info.max)
        )
    return weighted_correlation(frame, x, y, Design(weight=spec.weight), method=method).to_pylist()[
        0
    ]


@pytest.mark.parametrize("method", ["pearson", "spearman"])
def test_pooled_estimates_match_a_hand_pooled_frame(
    client: TestClient, store: DataStore, method: Method
) -> None:
    body = get(
        client,
        "/v1/correlates",
        outcome="HAPPY",
        wave="Y1",
        against=["LONELY", "WB_TODAY"],
        method=method,
        pooled="population",
    )
    for row in body["rows"]:
        expected = hand_pooled(store, "HAPPY", row["predictor"], "Y1", method)
        assert row["estimate"] == pytest.approx(expected["estimate"], abs=1e-12)
        assert row["n"] == expected["n"]
    # Pooling is not a sum of samples: the pooled number is neither
    # country's, and not the unrescaled pool's.
    tst = get(
        client,
        "/v1/correlates",
        outcome="HAPPY",
        wave="Y1",
        against="LONELY",
        filter="country_code:1",
    )
    us = get(
        client,
        "/v1/correlates",
        outcome="HAPPY",
        wave="Y1",
        against="LONELY",
        filter="country_code:22",
    )
    pooled_r = body["rows"][0]["estimate"]
    assert pooled_r not in (tst["rows"][0]["estimate"], us["rows"][0]["estimate"])


def test_the_pooled_pair_and_table_agree_with_the_sweep(client: TestClient) -> None:
    sweep = get(
        client,
        "/v1/correlates",
        outcome="INCOME_FEELINGS",
        wave="Y1",
        against="WB_TODAY",
        pooled="population",
    )
    pair = get(
        client,
        "/v1/correlations/pair",
        y="INCOME_FEELINGS",
        x="WB_TODAY",
        wave="Y1",
        pooled="population",
    )
    assert pair["correlation"]["estimate"] == pytest.approx(sweep["rows"][0]["estimate"], abs=1e-12)
    assert pair["correlation"]["n_countries"] == 2
    meta = pair["shares"]["meta"]
    assert meta["pooled"] == "population" and meta["countries"] == [1, 22]
    assert meta["filters"] == {}
    # Each column still adds to 1; the columns' shares too.
    assert sum(column["share"] for column in pair["columns"]) == pytest.approx(1.0)
    for column in pair["columns"]:
        cells = [cell["share"] for cell in pair["cells"] if cell["x"] == column["code"]]
        assert sum(share or 0.0 for share in cells) == pytest.approx(1.0)
    # Every share carries its column's countries; one-country pairs none.
    assert {row["n_countries"] for row in pair["shares"]["rows"]} == {2}
    # The answers are named by the labels every country shares.
    assert pair["rows"][0]["label"].startswith("Finding it very difficult")
    table = get(
        client,
        "/v1/correlations",
        vars=["WB_TODAY", "INCOME_FEELINGS", "HAPPY"],
        wave="Y1",
        pooled="population",
    )
    assert table["meta"]["pooled"] == "population" and table["meta"]["countries"] == [1, 22]
    first = table["pairs"][0]
    assert (first["a"], first["b"]) == ("WB_TODAY", "INCOME_FEELINGS")
    assert first["correlation"]["estimate"] == pytest.approx(
        sweep["rows"][0]["estimate"], abs=1e-12
    )
    assert all(pair["correlation"]["n_countries"] == 2 for pair in table["pairs"])


# --- coverage: a country that did not ask ---------------------------------


@pytest.fixture(scope="module")
def unasked_client(
    synthetic_data_dir: Path, tmp_path_factory: pytest.TempPathFactory
) -> TestClient:
    """The synthetic data with LONELY never asked in the United States."""
    directory = tmp_path_factory.mktemp("unasked")
    for name in ("flourish.duckdb", "manifest.json", "adult_population.csv"):
        shutil.copy(synthetic_data_dir / name, directory / name)
    con = duckdb.connect(str(directory / "flourish.duckdb"))
    con.execute(
        "DELETE FROM responses_long WHERE variable = 'LONELY' "
        "AND id IN (SELECT id FROM respondents WHERE country_code = 22)"
    )
    con.close()
    return TestClient(create_app(synthetic_settings(directory)))


def test_a_country_that_did_not_ask_drops_out_of_that_estimate(unasked_client: TestClient) -> None:
    body = get(
        unasked_client,
        "/v1/correlates",
        outcome="HAPPY",
        wave="Y1",
        against=["LONELY", "WB_TODAY"],
        pooled="population",
    )
    by_name = {row["predictor"]: row for row in body["rows"]}
    assert by_name["LONELY"]["n_countries"] == 1
    assert by_name["WB_TODAY"]["n_countries"] == 2
    assert body["meta"]["countries"] == [1, 22]
    # LONELY's pooled number is Testland's own: one country's weights,
    # rescaled by a constant, give its correlation unchanged.
    tst = get(
        unasked_client,
        "/v1/correlates",
        outcome="HAPPY",
        wave="Y1",
        against="LONELY",
        filter="country_code:1",
    )
    assert by_name["LONELY"]["estimate"] == pytest.approx(tst["rows"][0]["estimate"], abs=1e-12)
    only = get(
        unasked_client,
        "/v1/correlations/pair",
        y="HAPPY",
        x="LONELY",
        wave="Y1",
        pooled="population",
    )
    assert only["shares"]["meta"]["countries"] == [1]
    assert only["correlation"]["n_countries"] == 1
    assert {row["n_countries"] for row in only["shares"]["rows"]} <= {0, 1}


def test_coverage_masks_and_pooling_on_a_toy_frame(store: DataStore) -> None:
    frame = pl.DataFrame(
        {
            "country_code": [1, 1, 22, 22, 22],
            "w_c1": [1.0, 3.0, 0.5, 0.5, 1.0],
            "x": [1, 2, 3, None, 5],
            "y": [1, None, 2, 2, None],
            "z": [None, None, 1, 2, 3],
        }
    )
    pooled = pool_countries(store, frame, resolve(("Y1",), "global"))
    totals = dict(pooled.group_by("country_code").agg(pl.col("w_c1").sum()).iter_rows())
    assert totals[1] == pytest.approx(POPULATIONS[1]) and totals[22] == pytest.approx(
        POPULATIONS[22]
    )
    assert pooled[COUNTRY_BIT].to_list() == [2, 2, 2**22, 2**22, 2**22]
    masks = coverage_masks(pooled, "x", ["y", "z"])
    assert countries_in(masks[((), "y")]) == [1, 22]
    assert countries_in(masks[((), "z")]) == [22]
    assert countries_in(0) == []


# --- the precomputed file -------------------------------------------------


@pytest.fixture(scope="module")
def precomputed(synthetic_data_dir: Path, tmp_path_factory: pytest.TempPathFactory) -> Path:
    path = tmp_path_factory.mktemp("pooled") / "pooled_correlations.parquet"
    store = DataStore(synthetic_settings(synthetic_data_dir))
    assert pooled_module.write(store, path) > 0
    store.close()
    return path


@pytest.fixture(scope="module")
def served_from_file(synthetic_data_dir: Path, precomputed: Path) -> TestClient:
    return TestClient(create_app(synthetic_settings(synthetic_data_dir, pooled_path=precomputed)))


@pytest.fixture(scope="module")
def on_demand(synthetic_data_dir: Path, tmp_path_factory: pytest.TempPathFactory) -> TestClient:
    missing = tmp_path_factory.mktemp("none") / "absent.parquet"
    return TestClient(create_app(synthetic_settings(synthetic_data_dir, pooled_path=missing)))


REQUESTS = [
    ("/v1/correlates", {"outcome": "HAPPY", "wave": "Y1"}),
    ("/v1/correlates", {"outcome": "sfi", "wave": "Y1"}),
    ("/v1/correlates", {"outcome": "INCOME_FEELINGS", "wave": "Y2"}),
    ("/v1/correlates", {"outcome": "MONEY", "wave": "MY", "against": ["BALANCE"]}),
    ("/v1/correlates", {"outcome": "HAPPY", "wave": "Y1", "against": ["LONELY", "sfi_health"]}),
    (
        "/v1/correlations",
        {"vars": ["WB_TODAY", "INCOME_FEELINGS", "HAPPY", "sfi", "phq2_score"], "wave": "Y1"},
    ),
    ("/v1/correlations", {"vars": ["HAPPY", "ATTEND_SVCS", "BALANCE"], "wave": "Y2"}),
]


@pytest.mark.parametrize("method", ["pearson", "spearman"])
@pytest.mark.parametrize(("path", "params"), REQUESTS)
def test_the_precomputed_file_equals_the_on_demand_estimator(
    served_from_file: TestClient,
    on_demand: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    path: str,
    params: dict,
    method: str,
) -> None:
    query = {**params, "method": method, "pooled": "population"}
    expected = get(on_demand, path, **query)

    # Served from the file: no frame is assembled at all.
    def refuse(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("a precomputed request assembled a frame")

    monkeypatch.setattr(correlates_route, "assemble_correlates_frame", refuse)
    monkeypatch.setattr(correlations_route, "assemble_matrix_frame", refuse)
    actual = get(served_from_file, path, **query)
    assert_json_close(actual, expected)
    # Floats agree to 1e-12 in absolute terms as well.
    rows = actual.get("rows") or [
        pair["correlation"] for pair in actual["pairs"] if pair["correlation"]
    ]
    reference = expected.get("rows") or [
        pair["correlation"] for pair in expected["pairs"] if pair["correlation"]
    ]
    for got, want in zip(rows, reference, strict=True):
        if want["estimate"] is None:
            assert got["estimate"] is None
        else:
            assert abs(got["estimate"] - want["estimate"]) <= 1e-12


def test_the_file_serves_the_serving_policy_as_finalize_does(
    synthetic_data_dir: Path, precomputed: Path, tmp_path_factory: pytest.TempPathFactory
) -> None:
    """Under the pre-ADR-0011 rule (50/100), the file's rows are
    suppressed and flagged exactly as the on-demand rows."""
    strict = {"suppression_threshold": 50, "suppression_flag_below": 100}
    from_file = TestClient(
        create_app(synthetic_settings(synthetic_data_dir, pooled_path=precomputed, **strict))
    )
    missing = tmp_path_factory.mktemp("strict") / "absent.parquet"
    fresh = TestClient(
        create_app(synthetic_settings(synthetic_data_dir, pooled_path=missing, **strict))
    )
    params = {
        "outcome": "HAPPY",
        "wave": "Y1",
        "against": ["LONELY", "BALANCE"],
        "pooled": "population",
    }
    assert_json_close(
        get(from_file, "/v1/correlates", **params), get(fresh, "/v1/correlates", **params)
    )


def test_a_file_for_another_build_is_ignored(
    synthetic_data_dir: Path, precomputed: Path, tmp_path: Path
) -> None:
    store = DataStore(synthetic_settings(synthetic_data_dir))
    assert pooled_module.load(precomputed, store) is not None
    store.data_version = "another.build"
    assert pooled_module.load(precomputed, store) is None
    store.data_version = "synthetic.0.0.1"
    store.populations = {1: 1.0, 22: 2.0}
    assert pooled_module.load(precomputed, store) is None
    assert pooled_module.load(tmp_path / "absent.parquet", store) is None
    store.close()


def test_a_population_table_that_misses_a_country_refuses_pooling_honestly(
    synthetic_data_dir: Path,
) -> None:
    """The packaged UN table has no Testland: the API still serves every
    country on its own, and says why it cannot pool."""
    from flourish_api.config import Settings

    client = TestClient(
        create_app(Settings(data_path=synthetic_data_dir / "flourish.duckdb", correlates_min_n=20))
    )
    response = client.get(
        "/v1/correlates", params={"outcome": "HAPPY", "wave": "Y1", "pooled": "population"}
    )
    assert response.status_code == 503
    assert "no adult population for country codes [1]" in response.json()["detail"]
    ok = client.get(
        "/v1/correlates", params={"outcome": "HAPPY", "wave": "Y1", "filter": "country_code:1"}
    )
    assert ok.status_code == 200
