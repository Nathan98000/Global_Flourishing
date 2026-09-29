"""All countries — the plain average of the countries' own estimates
(ADR-0020) — against the synthetic data: the parameter and its 422s, the
average against the countries' own numbers (correlations, and Compare
two's shares with their intervals), the asterisk and the ranking floor, a
country that did not ask a question, and the precomputed file of every
country's correlations against the on-demand estimator (equal to 1e-12)."""

import math
import shutil
from pathlib import Path
from statistics import NormalDist

import duckdb
import polars as pl
import pytest
from fastapi.testclient import TestClient
from flourish_api import country_correlations
from flourish_api.data import DataStore
from flourish_api.main import create_app
from flourish_api.routes import correlates as correlates_route
from flourish_api.routes import correlations as correlations_route
from flourish_stats import NO_SUPPRESSION
from synthetic_db import synthetic_settings
from test_contract import assert_json_close

COUNTRIES = (1, 22)
Z = NormalDist().inv_cdf(0.975)


def get(client: TestClient, path: str, **params: object) -> dict:
    response = client.get(path, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def problems(client: TestClient, path: str, **params: object) -> list[str]:
    response = client.get(path, params=params)
    assert response.status_code == 422, response.text
    return response.json()["detail"]


def each_country(client: TestClient, path: str, **params: object) -> dict[int, dict]:
    return {code: get(client, path, filter=f"country_code:{code}", **params) for code in COUNTRIES}


def copy_data(source: Path, directory: Path) -> Path:
    for path in source.iterdir():
        shutil.copy(path, directory / path.name)
    return directory


def at_floor(directory: Path, min_n: int, **overrides: object) -> TestClient:
    settings = synthetic_settings(directory, **overrides)
    return TestClient(create_app(settings.model_copy(update={"correlates_min_n": min_n})))


# --- the parameter --------------------------------------------------------


def test_the_average_takes_the_place_of_a_country_and_says_so(client: TestClient) -> None:
    body = get(client, "/v1/correlates", outcome="HAPPY", wave="Y1", pooled="average")
    meta = body["meta"]
    assert meta["pooled"] == "average" and meta["countries"] == [1, 22]
    assert meta["filters"] == {}
    assert meta["weight_key"] == "y1" and meta["weight"] == "w_c1"
    # Every country asked every question here: each average covers both.
    assert body["rows"] and all(row["n_countries"] == 2 for row in body["rows"])
    # The floor and the dedupe are unchanged.
    assert meta["min_n"] == 20
    assert meta["dropped_overlap"] == {"phq2_positive": "phq2_score", "gad2_positive": "gad2_score"}
    # A one-country response carries none of it.
    single = get(client, "/v1/correlates", outcome="HAPPY", wave="Y1", filter="country_code:1")
    assert single["meta"]["pooled"] is None and single["meta"]["countries"] is None
    assert all(row["n_countries"] is None for row in single["rows"])


def test_every_new_refusal(client: TestClient, adjusted_client: TestClient) -> None:
    # Every problem at once: an unknown value is no average at all.
    assert problems(client, "/v1/correlates", outcome="HAPPY", wave="Y1", pooled="gdp")[0] == (
        "pooled must be one of ['average'], got 'gdp'"
    )
    (message,) = problems(
        client,
        "/v1/correlates",
        outcome="HAPPY",
        wave="Y1",
        pooled="average",
        filter="country_code:1",
    )
    assert "drop the country filter" in message
    (message,) = problems(
        client, "/v1/correlates", outcome="HAPPY", wave="Y1", pooled="average", by="country_code"
    )
    assert "drop by=country_code" in message
    for path, params in (
        ("/v1/correlations/pair", {"y": "HAPPY", "x": "LONELY"}),
        ("/v1/correlations", {"vars": ["HAPPY", "LONELY"]}),
    ):
        (message,) = problems(
            client, path, wave="Y1", pooled="average", filter="country_code:22", **params
        )
        assert "drop the country filter" in message
        # Neither a country nor the average: the one-country rule stands.
        (message,) = problems(client, path, wave="Y1", **params)
        assert "exactly one country" in message and "pooled=average" in message
    (message,) = problems(client, "/v1/correlates", outcome="HAPPY", wave="Y1")
    assert "pooled=average" in message
    assert problems(
        adjusted_client,
        "/v1/correlates",
        outcome="HAPPY",
        wave="Y1",
        against="LONELY",
        adjusted="true",
        pooled="average",
    ) == ["pooled=average serves plain correlations; drop adjusted=true"]
    # Country by country is unchanged, and never averaged.
    across = get(client, "/v1/correlates", outcome="HAPPY", wave="Y1", by="country_code")
    assert across["meta"]["pooled"] is None


# --- the numbers ----------------------------------------------------------


@pytest.mark.parametrize("method", ["pearson", "spearman"])
def test_the_average_is_the_plain_mean_of_the_countries(client: TestClient, method: str) -> None:
    params = {
        "outcome": "HAPPY",
        "wave": "Y1",
        "against": ["LONELY", "WB_TODAY", "BALANCE"],
        "method": method,
    }
    average = get(client, "/v1/correlates", pooled="average", **params)
    own = each_country(client, "/v1/correlates", **params)
    dots = get(client, "/v1/correlates", by="country_code", **params)
    for row in average["rows"]:
        theirs = [
            next(r for r in own[code]["rows"] if r["predictor"] == row["predictor"])
            for code in COUNTRIES
        ]
        # Every country counts the same, whatever its size.
        assert row["estimate"] == pytest.approx(
            sum(r["estimate"] for r in theirs) / len(theirs), abs=1e-15
        )
        assert row["n"] == sum(r["n"] for r in theirs)
        assert row["sum_w"] == pytest.approx(sum(r["sum_w"] for r in theirs), rel=1e-12)
        assert row["n_countries"] == 2
        assert row["ci_lo"] is None and row["ci_hi"] is None and row["flagged"] is False
        # Exactly what a reader gets by averaging the country chart's dots.
        shown = [r["estimate"] for r in dots["rows"] if r["predictor"] == row["predictor"]]
        assert row["estimate"] == pytest.approx(sum(shown) / len(shown), abs=1e-15)


def test_compare_two_averages_the_countries_grids(client: TestClient) -> None:
    params = {"y": "INCOME_FEELINGS", "x": "WB_TODAY", "wave": "Y1"}
    average = get(client, "/v1/correlations/pair", pooled="average", **params)
    own = each_country(client, "/v1/correlations/pair", **params)
    meta = average["shares"]["meta"]
    assert meta["pooled"] == "average" and meta["countries"] == [1, 22]
    assert meta["filters"] == {}
    # The correlation: the mean of the countries'.
    correlation = average["correlation"]
    assert correlation["estimate"] == pytest.approx(
        sum(own[code]["correlation"]["estimate"] for code in COUNTRIES) / 2, abs=1e-15
    )
    assert correlation["n_countries"] == 2
    # The bars: the mean of the countries' shares who gave each answer.
    columns_n = {code: {c["code"]: c["n"] for c in own[code]["columns"]} for code in COUNTRIES}
    for index, column in enumerate(average["columns"]):
        theirs = [own[code]["columns"][index] for code in COUNTRIES]
        assert column["share"] == pytest.approx(sum(t["share"] for t in theirs) / 2, abs=1e-12)
        assert column["n"] == sum(t["n"] for t in theirs)
        assert column["flagged"] == (column["n"] < average["column_flag_below"])
    assert sum(column["share"] for column in average["columns"]) == pytest.approx(1.0)
    # Each cell: the mean over the countries with people in its column,
    # with SE √(Σ se²) / K and its normal interval; n summed; the flags on
    # the summed n.
    for index, (cell, row) in enumerate(
        zip(average["cells"], average["shares"]["rows"], strict=True)
    ):
        inside = [code for code in COUNTRIES if columns_n[code][cell["x"]] > 0]
        theirs = [own[code]["shares"]["rows"][index] for code in inside]
        if not inside:
            assert cell["share"] is None and row["n_countries"] == 0
            continue
        mean = sum(t["estimate"] for t in theirs) / len(theirs)
        assert row["estimate"] == pytest.approx(mean, abs=1e-12)
        assert row["n"] == sum(t["n"] for t in theirs) and row["n_countries"] == len(inside)
        if all(t["se"] is not None for t in theirs):
            se = math.sqrt(sum(t["se"] ** 2 for t in theirs)) / len(theirs)
            assert row["se"] == pytest.approx(se, abs=1e-12)
            assert row["ci_lo"] == pytest.approx(mean - Z * se, abs=1e-12)
            assert row["ci_hi"] == pytest.approx(mean + Z * se, abs=1e-12)
        column_n = sum(columns_n[code][cell["x"]] for code in inside)
        assert cell["flagged"] == (
            row["n"] < average["cell_flag_below"] or column_n < average["column_flag_below"]
        )
    # Every column still adds to 100%.
    for column in average["columns"]:
        shares = [cell["share"] for cell in average["cells"] if cell["x"] == column["code"]]
        if any(share is not None for share in shares):
            assert sum(share or 0.0 for share in shares) == pytest.approx(1.0)
    # The answers are named by the labels every country shares.
    assert average["rows"][0]["label"].startswith("Finding it very difficult")


def test_the_pair_and_the_table_agree_with_the_sweep(client: TestClient) -> None:
    sweep = get(
        client,
        "/v1/correlates",
        outcome="INCOME_FEELINGS",
        wave="Y1",
        against="WB_TODAY",
        pooled="average",
    )
    pair = get(
        client,
        "/v1/correlations/pair",
        y="INCOME_FEELINGS",
        x="WB_TODAY",
        wave="Y1",
        pooled="average",
    )
    assert pair["correlation"]["estimate"] == pytest.approx(sweep["rows"][0]["estimate"], abs=1e-12)
    table = get(
        client,
        "/v1/correlations",
        vars=["WB_TODAY", "INCOME_FEELINGS", "HAPPY"],
        wave="Y1",
        pooled="average",
    )
    assert table["meta"]["pooled"] == "average" and table["meta"]["countries"] == [1, 22]
    first = table["pairs"][0]
    assert (first["a"], first["b"]) == ("WB_TODAY", "INCOME_FEELINGS")
    assert first["correlation"]["estimate"] == pytest.approx(
        sweep["rows"][0]["estimate"], abs=1e-12
    )
    assert all(pair["correlation"]["n_countries"] == 2 for pair in table["pairs"])


# --- the asterisk and the floor ---------------------------------------------


@pytest.fixture(scope="module")
def fewer_dir(synthetic_data_dir: Path, tmp_path_factory: pytest.TempPathFactory) -> Path:
    """The synthetic data with half of Testland's LONELY answers gone."""
    directory = copy_data(synthetic_data_dir, tmp_path_factory.mktemp("fewer"))
    con = duckdb.connect(str(directory / "flourish.duckdb"))
    con.execute(
        "DELETE FROM responses_long WHERE variable = 'LONELY' AND id IN "
        "(SELECT id FROM respondents WHERE country_code = 1 AND id % 2 = 0)"
    )
    con.close()
    return directory


def test_an_average_wears_an_asterisk_only_when_every_country_does(fewer_dir: Path) -> None:
    params = {"outcome": "HAPPY", "wave": "Y1", "against": "LONELY"}
    own = each_country(at_floor(fewer_dir, 20), "/v1/correlates", **params)
    n_tst, n_us = own[1]["rows"][0]["n"], own[22]["rows"][0]["n"]
    assert 0 < n_tst < n_us
    # One country at the floor or above: no asterisk.
    mixed = get(at_floor(fewer_dir, n_tst + 1), "/v1/correlates", pooled="average", **params)
    assert mixed["rows"][0]["flagged"] is False
    # Every country below it: the average wears one.
    below = at_floor(fewer_dir, n_us + 1)
    row = get(below, "/v1/correlates", pooled="average", **params)["rows"][0]
    assert row["flagged"] is True and row["n"] == n_tst + n_us
    table = get(below, "/v1/correlations", vars=["HAPPY", "LONELY"], wave="Y1", pooled="average")
    assert table["pairs"][0]["below_min_n"] is True
    pair = get(below, "/v1/correlations/pair", y="HAPPY", x="LONELY", wave="Y1", pooled="average")
    assert pair["correlation"]["flagged"] is True


def test_the_ranking_floor_reads_the_countries_summed_complete_cases(fewer_dir: Path) -> None:
    us_n = get(
        at_floor(fewer_dir, 20),
        "/v1/correlates",
        outcome="HAPPY",
        wave="Y1",
        against="WB_TODAY",
        filter="country_code:22",
    )["rows"][0]["n"]
    # A floor every country falls below, but not their total.
    client = at_floor(fewer_dir, us_n + 1)
    ranked = get(client, "/v1/correlates", outcome="HAPPY", wave="Y1", pooled="average", limit=200)
    assert "WB_TODAY" in {row["predictor"] for row in ranked["rows"]}
    assert all(row["n"] >= us_n + 1 for row in ranked["rows"])
    alone = get(
        client, "/v1/correlates", outcome="HAPPY", wave="Y1", filter="country_code:22", limit=200
    )
    assert "WB_TODAY" not in {row["predictor"] for row in alone["rows"]}


# --- a country that did not ask ---------------------------------------------


@pytest.fixture(scope="module")
def unasked_dir(synthetic_data_dir: Path, tmp_path_factory: pytest.TempPathFactory) -> Path:
    """The synthetic data with LONELY never asked in the United States."""
    directory = copy_data(synthetic_data_dir, tmp_path_factory.mktemp("unasked"))
    con = duckdb.connect(str(directory / "flourish.duckdb"))
    con.execute(
        "DELETE FROM responses_long WHERE variable = 'LONELY' "
        "AND id IN (SELECT id FROM respondents WHERE country_code = 22)"
    )
    con.close()
    return directory


def test_a_country_that_did_not_ask_drops_out_of_that_average(unasked_dir: Path) -> None:
    client = at_floor(unasked_dir, 20)
    body = get(
        client,
        "/v1/correlates",
        outcome="HAPPY",
        wave="Y1",
        against=["LONELY", "WB_TODAY"],
        pooled="average",
    )
    by_name = {row["predictor"]: row for row in body["rows"]}
    assert by_name["LONELY"]["n_countries"] == 1
    assert by_name["WB_TODAY"]["n_countries"] == 2
    assert body["meta"]["countries"] == [1, 22]
    # The average of one country is that country's own number.
    tst = get(
        client,
        "/v1/correlates",
        outcome="HAPPY",
        wave="Y1",
        against="LONELY",
        filter="country_code:1",
    )
    assert by_name["LONELY"]["estimate"] == pytest.approx(tst["rows"][0]["estimate"], abs=1e-15)
    assert by_name["LONELY"]["n"] == tst["rows"][0]["n"]
    only = get(client, "/v1/correlations/pair", y="HAPPY", x="LONELY", wave="Y1", pooled="average")
    assert only["shares"]["meta"]["countries"] == [1]
    assert only["correlation"]["n_countries"] == 1
    assert {row["n_countries"] for row in only["shares"]["rows"]} <= {0, 1}
    # Country by country, the United States has nobody behind the pair.
    dots = get(
        client, "/v1/correlates", outcome="HAPPY", wave="Y1", against="LONELY", by="country_code"
    )
    us = next(row for row in dots["rows"] if row["group"]["country_code"] == 22)
    assert us["n"] == 0 and us["estimate"] is None


# --- the precomputed file -------------------------------------------------


def precompute(directory: Path, path: Path) -> Path:
    store = DataStore(synthetic_settings(directory))
    assert country_correlations.write(store, path) > 0
    store.close()
    return path


@pytest.fixture(scope="module")
def precomputed(synthetic_data_dir: Path, tmp_path_factory: pytest.TempPathFactory) -> Path:
    return precompute(
        synthetic_data_dir, tmp_path_factory.mktemp("file") / "country_correlations.parquet"
    )


@pytest.fixture(scope="module")
def served_from_file(synthetic_data_dir: Path, precomputed: Path) -> TestClient:
    return TestClient(
        create_app(synthetic_settings(synthetic_data_dir, country_correlations_path=precomputed))
    )


@pytest.fixture(scope="module")
def on_demand(synthetic_data_dir: Path, tmp_path_factory: pytest.TempPathFactory) -> TestClient:
    missing = tmp_path_factory.mktemp("none") / "absent.parquet"
    return TestClient(
        create_app(synthetic_settings(synthetic_data_dir, country_correlations_path=missing))
    )


#: Every shape the file serves: All countries (averaged) ...
AVERAGED = [
    ("/v1/correlates", {"outcome": "HAPPY", "wave": "Y1"}),
    ("/v1/correlates", {"outcome": "sfi", "wave": "Y1"}),
    ("/v1/correlates", {"outcome": "INCOME_FEELINGS", "wave": "Y2"}),
    ("/v1/correlates", {"outcome": "MONEY", "wave": "MY", "against": ["BALANCE"]}),
    # Midyear pairs (ADR-0020): with 2023 answers, and with 2024's.
    ("/v1/correlates", {"outcome": "MONEY", "wave": "MY"}),
    ("/v1/correlates", {"outcome": "MONEY", "wave": "MY", "other_wave": "Y2"}),
    ("/v1/correlates", {"outcome": "HAPPY", "wave": "MY", "other_wave": "Y2"}),
    ("/v1/correlations", {"vars": ["MONEY", "HAPPY", "WB_TODAY", "BALANCE"], "wave": "MY"}),
    (
        "/v1/correlations",
        {"vars": ["BALANCE", "INCOME_FEELINGS", "HAPPY"], "wave": "MY", "other_wave": "Y2"},
    ),
    ("/v1/correlates", {"outcome": "HAPPY", "wave": "Y1", "against": ["LONELY", "sfi_health"]}),
    (
        "/v1/correlations",
        {"vars": ["WB_TODAY", "INCOME_FEELINGS", "HAPPY", "sfi", "phq2_score"], "wave": "Y1"},
    ),
    ("/v1/correlations", {"vars": ["HAPPY", "ATTEND_SVCS", "BALANCE"], "wave": "Y2"}),
]
#: ... and country by country (Find related's table, Compare two's chart).
COUNTRY_BY_COUNTRY = [
    ("/v1/correlates", {"outcome": "HAPPY", "wave": "Y1", "against": ["LONELY", "WB_TODAY"]}),
    ("/v1/correlates", {"outcome": "WB_TODAY", "wave": "Y1", "against": ["INCOME_FEELINGS"]}),
    (
        "/v1/correlates",
        {"outcome": "MONEY", "wave": "MY", "other_wave": "Y2", "against": ["HAPPY", "BALANCE"]},
    ),
    ("/v1/correlates", {"outcome": "INCOME_FEELINGS", "wave": "Y2"}),
]
REQUESTS = [(path, {**params, "pooled": "average"}) for path, params in AVERAGED] + [
    (path, {**params, "by": "country_code"}) for path, params in COUNTRY_BY_COUNTRY
]


def estimates(body: dict) -> list[float | None]:
    rows = body.get("rows") or [
        pair["correlation"] for pair in body["pairs"] if pair["correlation"]
    ]
    return [row["estimate"] for row in rows]


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
    query = {**params, "method": method}
    expected = get(on_demand, path, **query)

    # Served from the file: no frame is assembled at all.
    def refuse(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("a precomputed request assembled a frame")

    monkeypatch.setattr(correlates_route, "assemble_correlates_frame", refuse)
    monkeypatch.setattr(correlations_route, "assemble_matrix_frame", refuse)
    actual = get(served_from_file, path, **query)
    assert_json_close(actual, expected)
    # Floats agree to 1e-12 in absolute terms as well.
    for got, want in zip(estimates(actual), estimates(expected), strict=True):
        if want is None:
            assert got is None
        else:
            assert got is not None and abs(got - want) <= 1e-12


def test_the_files_average_is_the_mean_of_its_countries(served_from_file: TestClient) -> None:
    params = {"outcome": "HAPPY", "wave": "Y1", "against": ["LONELY", "WB_TODAY", "BALANCE"]}
    average = get(served_from_file, "/v1/correlates", pooled="average", **params)
    dots = get(served_from_file, "/v1/correlates", by="country_code", **params)
    for row in average["rows"]:
        shown = [r["estimate"] for r in dots["rows"] if r["predictor"] == row["predictor"]]
        assert row["estimate"] == pytest.approx(sum(shown) / len(shown), abs=1e-15)


def test_a_question_not_asked_in_a_country_leaves_it_out_of_the_file(
    unasked_dir: Path, tmp_path: Path
) -> None:
    file = precompute(unasked_dir, tmp_path / "unasked.parquet")
    client = at_floor(unasked_dir, 20, country_correlations_path=file)
    assert client.app.state.country_correlations is not None  # type: ignore[attr-defined]
    table = client.app.state.country_correlations  # type: ignore[attr-defined]
    records = table.records(
        ("Y1", None), "pearson", "HAPPY", ["LONELY", "WB_TODAY"], NO_SUPPRESSION
    )
    countries = {
        name: sorted(records.filter(pl.col("predictor") == name)["country_code"].to_list())
        for name in ("LONELY", "WB_TODAY")
    }
    assert countries == {"LONELY": [1], "WB_TODAY": [1, 22]}
    body = get(
        client, "/v1/correlates", outcome="HAPPY", wave="Y1", against="LONELY", pooled="average"
    )
    assert body["rows"][0]["n_countries"] == 1


def test_the_file_serves_the_serving_policy_as_finalize_does(
    synthetic_data_dir: Path, precomputed: Path, tmp_path_factory: pytest.TempPathFactory
) -> None:
    """Under the pre-ADR-0011 rule (50/100), the file's rows are
    suppressed and flagged exactly as the on-demand rows."""
    strict = {"suppression_threshold": 50, "suppression_flag_below": 100}
    from_file = TestClient(
        create_app(
            synthetic_settings(synthetic_data_dir, country_correlations_path=precomputed, **strict)
        )
    )
    missing = tmp_path_factory.mktemp("strict") / "absent.parquet"
    fresh = TestClient(
        create_app(
            synthetic_settings(synthetic_data_dir, country_correlations_path=missing, **strict)
        )
    )
    for extra in ({"pooled": "average"}, {"by": "country_code"}):
        params = {"outcome": "HAPPY", "wave": "Y1", "against": ["LONELY", "BALANCE"], **extra}
        assert_json_close(
            get(from_file, "/v1/correlates", **params), get(fresh, "/v1/correlates", **params)
        )


def test_a_file_for_another_build_is_ignored(
    synthetic_data_dir: Path, precomputed: Path, tmp_path: Path
) -> None:
    store = DataStore(synthetic_settings(synthetic_data_dir))
    assert country_correlations.load(precomputed, store) is not None
    store.data_version = "another.build"
    assert country_correlations.load(precomputed, store) is None
    store.data_version = "synthetic.0.0.1"
    assert country_correlations.load(tmp_path / "absent.parquet", store) is None
    store.close()
