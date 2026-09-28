"""GET /v1/correlations/pair and /v1/correlations against the synthetic data (ADR-0018).

(Not test_correlations.py: stats/tests has one, and pytest collects the
whole repo in one run.)
"""

import polars as pl
import pytest
from fastapi.testclient import TestClient
from flourish_api.config import Settings
from flourish_api.frames import PAIR_X
from flourish_api.main import create_app
from flourish_api.ops import CACHE_CONTROL
from flourish_api.routes.correlations import bin_groups
from flourish_stats import Design


def get_pair(client: TestClient, **params) -> dict:
    resp = client.get("/v1/correlations/pair", params=params)
    assert resp.status_code == 200, resp.text
    return resp.json()


#: INCOME_FEELINGS' answers, least to most of what its label names (it is
#: descending: 1 = Living comfortably is the most).
FEELINGS_ALIGNED = [
    "Finding it very difficult on present income",
    "Finding it difficult on present income",
    "Getting by on present income",
    "Living comfortably on present income",
]


def columns_of(body: dict) -> dict[int, list[dict]]:
    by_column: dict[int, list[dict]] = {}
    for cell in body["cells"]:
        by_column.setdefault(cell["x"], []).append(cell)
    return by_column


def test_pair_is_a_cross_tab_in_aligned_order(client: TestClient) -> None:
    """ATTEND_SVCS (1 = Weekly … 3 = Never) on the columns and
    INCOME_FEELINGS (1 = Living comfortably … 4) on the rows are both
    descending: each axis runs from least to most of what its label names,
    named by its answers."""
    body = get_pair(
        client, y="INCOME_FEELINGS", x="ATTEND_SVCS", wave="Y1", filter="country_code:1"
    )
    assert body["x"] == "ATTEND_SVCS" and body["y"] == "INCOME_FEELINGS"
    assert body["x_grouping"] == body["y_grouping"] == "answers"
    assert [c["code"] for c in body["columns"]] == [3, 2, 1]
    assert [c["label"] for c in body["columns"]] == ["Never", "Sometimes", "Weekly"]
    assert [r["code"] for r in body["rows"]] == [4, 3, 2, 1]
    assert [r["label"] for r in body["rows"]] == FEELINGS_ALIGNED
    # Every cell, column by column, each column's rows in order.
    assert [(c["x"], c["y"]) for c in body["cells"]] == [
        (x, y) for x in (3, 2, 1) for y in (4, 3, 2, 1)
    ]
    # Column shares: of the people who answered both, who gave each answer
    # to x — they add to 100%; so does every column's cells.
    assert sum(c["share"] for c in body["columns"]) == pytest.approx(1.0)
    for cells in columns_of(body).values():
        assert sum(c["share"] for c in cells) == pytest.approx(1.0)
    assert sum(c["n"] for c in body["columns"]) == sum(c["n"] for c in body["cells"])
    assert sum(c["n"] for c in body["columns"]) == body["shares"]["meta"]["n_valid"]
    for column in body["columns"]:
        assert column["ci_lo"] < column["share"] < column["ci_hi"]
        assert column["n"] == sum(c["n"] for c in columns_of(body)[column["code"]])
    # The same cells as estimate rows, grouped by both questions, with CIs.
    shares = body["shares"]
    assert shares["meta"]["by"] == ["ATTEND_SVCS", "INCOME_FEELINGS"]
    assert shares["meta"]["stat"] == "proportion" and shares["meta"]["weight"] == "w_c1"
    assert shares["meta"]["filters"] == {"country_code": [1]}
    assert [row["group"] for row in shares["rows"]] == [
        {"ATTEND_SVCS": c["x"], "INCOME_FEELINGS": c["y"]} for c in body["cells"]
    ]
    for cell, row in zip(body["cells"], shares["rows"], strict=True):
        assert row["estimate"] == cell["share"] and row["n"] == cell["n"]
        assert row["stat"] == "proportion" and row["level"] is None
        assert row["ci_method"] == "normal" and row["se_method"] == "taylor"
    # The correlation: a point estimate over everyone who answered both.
    corr = body["correlation"]
    assert corr["predictor"] == "ATTEND_SVCS" and corr["stat"] == "pearson_r"
    assert corr["ci_method"] == "none" and corr["se"] is None
    assert corr["n"] == shares["meta"]["n_valid"]
    assert body["min_n"] == 20


def test_pair_numbers_are_the_other_routes_numbers(client: TestClient) -> None:
    """The correlation is /v1/correlates' for the pair (either method);
    the cells are /v1/aggregate's shares of y grouped by x — same design,
    weight and SE — and the columns its shares of x."""
    params = {"y": "INCOME_FEELINGS", "x": "ATTEND_SVCS", "wave": "Y1", "filter": "country_code:1"}
    for method in ("pearson", "spearman"):
        body = get_pair(client, **params, method=method)
        ranked = client.get(
            "/v1/correlates",
            params={
                "outcome": "INCOME_FEELINGS",
                "wave": "Y1",
                "against": "ATTEND_SVCS",
                "filter": "country_code:1",
                "method": method,
            },
        ).json()["rows"][0]
        assert body["correlation"]["estimate"] == pytest.approx(ranked["estimate"], rel=1e-12)
        assert body["correlation"]["n"] == ranked["n"]
        assert body["correlation"]["stat"] == f"{method}_r"
    aggregate = client.get(
        "/v1/aggregate",
        params={
            "outcome": "INCOME_FEELINGS",
            "wave": "Y1",
            "stat": "proportion",
            "by": "ATTEND_SVCS",
            "filter": "country_code:1",
        },
    ).json()
    expected = {
        (row["group"]["ATTEND_SVCS"], row["level"]): row
        for row in aggregate["rows"]
        if row["group"]["ATTEND_SVCS"] is not None
    }
    for row in body["shares"]["rows"]:
        match = expected[(row["group"]["ATTEND_SVCS"], row["group"]["INCOME_FEELINGS"])]
        assert row["estimate"] == pytest.approx(match["estimate"], rel=1e-12)
        assert row["se"] == pytest.approx(match["se"], rel=1e-9)
        assert row["n"] == match["n"] and row["weight"] == match["weight"]
    # (Everyone answered both here, so x's own shares are the columns'.)
    x_shares = client.get(
        "/v1/aggregate",
        params={
            "outcome": "ATTEND_SVCS",
            "wave": "Y1",
            "stat": "proportion",
            "filter": "country_code:1",
        },
    ).json()["rows"]
    by_code = {row["level"]: row for row in x_shares}
    for column in body["columns"]:
        assert column["share"] == pytest.approx(by_code[column["code"]]["estimate"], rel=1e-12)
        assert column["n"] == by_code[column["code"]]["n"]


def test_flags_at_both_thresholds(synthetic_data_dir) -> None:
    """A cell is flagged when fewer than the cell floor gave that pair of
    answers, or its column holds fewer than the column floor; a column
    when it does. Flagged cells keep their shares (ADR-0019)."""
    params = {"y": "INCOME_FEELINGS", "x": "ATTEND_SVCS", "wave": "Y1", "filter": "country_code:1"}
    served = TestClient(create_app(Settings(data_path=synthetic_data_dir / "flourish.duckdb")))
    body = get_pair(served, **params)
    # The defaults, 30 and 100: 60 people in all, so every column is thin.
    assert body["cell_flag_below"] == 30 and body["column_flag_below"] == 100
    assert all(column["flagged"] for column in body["columns"])
    assert all(cell["flagged"] and cell["share"] is not None for cell in body["cells"])
    # Lower floors: the column floor under every column, the cell floor
    # between the cells' sizes — some flagged, some not, by the rule.
    sizes = sorted({cell["n"] for cell in body["cells"]})
    cell_floor = sizes[len(sizes) // 2]
    column_floor = min(column["n"] for column in body["columns"])
    tuned = TestClient(
        create_app(
            Settings(
                data_path=synthetic_data_dir / "flourish.duckdb",
                pair_cell_flag_below=cell_floor,
                pair_column_flag_below=column_floor,
            )
        )
    )
    body = get_pair(tuned, **params)
    assert body["cell_flag_below"] == cell_floor and body["column_flag_below"] == column_floor
    assert not any(column["flagged"] for column in body["columns"])
    assert {cell["flagged"] for cell in body["cells"]} == {True, False}
    for cell in body["cells"]:
        assert cell["flagged"] is (cell["n"] < cell_floor)
    # A column below its floor flags every cell in it, however full.
    strict = TestClient(
        create_app(
            Settings(
                data_path=synthetic_data_dir / "flourish.duckdb",
                pair_cell_flag_below=0,
                pair_column_flag_below=column_floor + 1,
            )
        )
    )
    body = get_pair(strict, **params)
    thin = {column["code"] for column in body["columns"] if column["flagged"]}
    assert thin
    for cell in body["cells"]:
        assert cell["flagged"] is (cell["x"] in thin)


def test_a_yes_no_question_is_two_levels(client: TestClient) -> None:
    body = get_pair(client, y="phq2_positive", x="LONELY", wave="Y1", filter="country_code:1")
    assert [r["label"] for r in body["rows"]] == ["No", "Yes"]
    assert [r["code"] for r in body["rows"]] == [0, 1]
    # LONELY's eleven answers, numbered, lowest first.
    assert [c["label"] for c in body["columns"]] == [str(n) for n in range(11)]
    assert len(body["cells"]) == 22


def test_long_scales_are_binned_on_both_axes(client: TestClient) -> None:
    body = get_pair(client, y="sfi_health", x="sfi_meaning", wave="Y1", filter="country_code:22")
    assert body["x_grouping"] == body["y_grouping"] == "bins"
    assert len(body["columns"]) == len(body["rows"]) == 10
    assert [c["code"] for c in body["columns"]] == list(range(10))
    assert [r["code"] for r in body["rows"]] == list(range(10))
    # Bins are labelled by their range, one decimal; the estimate rows
    # carry each bin's label.
    for level in [*body["columns"], *body["rows"]]:
        assert "–" in level["label"] or "below" in level["label"] or "above" in level["label"]
    labels_x = [c["label"] for c in body["columns"]]
    labels_y = [r["label"] for r in body["rows"]]
    assert [row["group"]["sfi_meaning"] for row in body["shares"]["rows"]] == [
        label for label in labels_x for _ in labels_y
    ]
    assert [row["group"]["sfi_health"] for row in body["shares"]["rows"]] == labels_y * 10
    assert sum(c["share"] for c in body["columns"]) == pytest.approx(1.0)
    for cells in columns_of(body).values():
        if any(cell["share"] for cell in cells):
            assert sum(cell["share"] for cell in cells) == pytest.approx(1.0)


def test_whole_number_bins_for_a_long_count() -> None:
    """A count in whole numbers is binned by whole numbers — at most ten
    bins, none empty by construction — and an end bin that took in a tail
    says so."""
    values = [float(v) for v in range(41)] * 5 + [95.0]
    frame = pl.DataFrame(
        {
            PAIR_X: values,
            "w": [1.0] * len(values),
            "strata": [1] * len(values),
            "psu": list(range(len(values))),
        }
    )
    design = Design(weight="w", strata="strata", psu="psu")
    expression, groups = bin_groups(frame, PAIR_X, design, integer=True)
    labels = [g.label for g in groups]
    assert len(groups) <= 10
    assert labels[0] == "0–4" and labels[-1].endswith("or more")
    index = frame.with_columns(expression.alias("g"))["g"].to_list()
    assert min(index) == 0 and max(index) == len(groups) - 1
    # A short count: one bin per whole number.
    short = frame.with_columns(pl.col(PAIR_X).clip(0, 5))
    _, groups = bin_groups(short, PAIR_X, design, integer=True)
    assert [g.label for g in groups] == ["0", "1", "2", "3", "4", "5"]


def test_pair_validation(client: TestClient) -> None:
    def detail(**params) -> list[str]:
        resp = client.get("/v1/correlations/pair", params=params)
        assert resp.status_code == 422, resp.text
        return resp.json()["detail"]

    base = {"wave": "Y1", "filter": "country_code:1"}
    # Built from the same answers: associated by construction, refused plainly.
    message = detail(y="HAPPY", x="sfi", **base)
    assert message == [
        "Secure Flourishing Index and Happiness are built from the same answers, so they go "
        "together by construction — compare Happiness with another question"
    ]
    assert any("two different" in m for m in detail(y="HAPPY", x="HAPPY", **base))
    assert any("has no order" in m for m in detail(y="HAPPY", x="URBAN_RURAL", **base))
    assert any("not asked at Y1" in m for m in detail(y="HAPPY", x="MONEY", **base))
    assert any("not a servable" in m for m in detail(y="HAPPY", x="INCOME", **base))
    assert any("not a servable" in m for m in detail(y="NOPE", x="HAPPY", **base))
    assert any("method must be" in m for m in detail(y="HAPPY", x="LONELY", method="k", **base))
    assert any("wave must be" in m for m in detail(y="HAPPY", x="LONELY", wave="Y9"))
    assert any("exactly one country" in m for m in detail(y="HAPPY", x="LONELY", wave="Y1"))
    assert any(
        "exactly one country" in m
        for m in detail(
            y="HAPPY", x="LONELY", wave="Y1", filter=["country_code:1", "country_code:22"]
        )
    )


def test_pair_serves_shares_never_people(client: TestClient) -> None:
    """Respondent-level answers would publish microdata: the response holds
    shares of people, and nothing per person."""
    resp = client.get(
        "/v1/correlations/pair",
        params={"y": "HAPPY", "x": "LONELY", "wave": "Y1", "filter": "country_code:1"},
    )
    body = resp.json()
    assert set(body) == {
        "x",
        "y",
        "x_grouping",
        "y_grouping",
        "correlation",
        "min_n",
        "columns",
        "rows",
        "cells",
        "shares",
        "cell_flag_below",
        "column_flag_below",
    }
    assert len(body["columns"]) == len(body["rows"]) == 11
    assert len(body["cells"]) == len(body["shares"]["rows"]) == 121
    assert body["correlation"]["n"] > len(body["columns"])
    # The same cache contract as every /v1 route.
    assert resp.headers["cache-control"] == CACHE_CONTROL
    assert resp.headers["etag"]


def test_pair_domain_filter_keeps_the_design(client: TestClient) -> None:
    whole = get_pair(client, y="HAPPY", x="LONELY", wave="Y1", filter="country_code:1")
    men = get_pair(client, y="HAPPY", x="LONELY", wave="Y1", filter=["country_code:1", "gender:1"])
    assert men["shares"]["meta"]["n_frame"] == whole["shares"]["meta"]["n_frame"]
    assert men["correlation"]["n"] < whole["correlation"]["n"]
    assert men["shares"]["meta"]["filters"] == {"country_code": [1], "gender": [1]}


def test_pair_503_without_data(absent_client: TestClient) -> None:
    resp = absent_client.get(
        "/v1/correlations/pair",
        params={"y": "HAPPY", "x": "LONELY", "wave": "Y1", "filter": "country_code:1"},
    )
    assert resp.status_code == 503


def test_pair_floor_follows_the_setting(synthetic_data_dir) -> None:
    served = TestClient(
        create_app(Settings(data_path=synthetic_data_dir / "flourish.duckdb", correlates_min_n=10))
    )
    body = get_pair(served, y="HAPPY", x="ATTEND_SVCS", wave="Y1", filter="country_code:1")
    assert body["min_n"] == 10


# --- /v1/correlations ---------------------------------------------------------


def get_table(client: TestClient, **params) -> dict:
    resp = client.get("/v1/correlations", params=params)
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_table_covers_every_pair_in_order(client: TestClient) -> None:
    names = ["HAPPY", "LONELY", "ATTEND_SVCS", "BALANCE"]
    body = get_table(client, vars=names, wave="Y1", filter="country_code:1")
    meta = body["meta"]
    assert meta["vars"] == names and meta["stat"] == "pearson_r"
    assert meta["weight"] == "w_c1" and meta["filters"] == {"country_code": [1]}
    assert meta["min_n"] == 20
    assert [(p["a"], p["b"]) for p in body["pairs"]] == [
        ("HAPPY", "LONELY"),
        ("HAPPY", "ATTEND_SVCS"),
        ("HAPPY", "BALANCE"),
        ("LONELY", "ATTEND_SVCS"),
        ("LONELY", "BALANCE"),
        ("ATTEND_SVCS", "BALANCE"),
    ]
    for pair in body["pairs"]:
        corr = pair["correlation"]
        assert not pair["shares_answers"]
        assert corr["predictor"] == pair["b"] and corr["ci_method"] == "none"
        assert -1 <= corr["estimate"] <= 1
        assert pair["below_min_n"] is (corr["n"] < 20)


def test_table_numbers_are_the_ranked_lists_numbers(client: TestClient) -> None:
    """A pair's correlation is /v1/correlates' for it, sign and all
    (ATTEND_SVCS is descending: aligned before it is correlated)."""
    for method in ("pearson", "spearman"):
        body = get_table(
            client,
            vars=["HAPPY", "ATTEND_SVCS", "phq2_positive"],
            wave="Y1",
            filter="country_code:22",
            method=method,
        )
        cells = {(p["a"], p["b"]): p["correlation"] for p in body["pairs"]}
        for b in ("ATTEND_SVCS", "phq2_positive"):
            ranked = client.get(
                "/v1/correlates",
                params={
                    "outcome": "HAPPY",
                    "wave": "Y1",
                    "against": b,
                    "filter": "country_code:22",
                    "method": method,
                },
            ).json()["rows"][0]
            assert cells[("HAPPY", b)]["estimate"] == pytest.approx(ranked["estimate"], rel=1e-12)
            assert cells[("HAPPY", b)]["n"] == ranked["n"]


def test_pairs_built_from_the_same_answers_are_marked_not_estimated(client: TestClient) -> None:
    body = get_table(
        client,
        vars=["phq2_score", "phq2_positive", "LONELY"],
        wave="Y1",
        filter="country_code:1",
    )
    cells = {(p["a"], p["b"]): p for p in body["pairs"]}
    shared = cells[("phq2_score", "phq2_positive")]
    assert shared["shares_answers"] is True and shared["correlation"] is None
    assert shared["below_min_n"] is False
    assert cells[("phq2_score", "LONELY")]["correlation"]["estimate"] is not None


def test_table_validation(client: TestClient) -> None:
    def detail(**params) -> list[str]:
        resp = client.get("/v1/correlations", params=params)
        assert resp.status_code == 422, resp.text
        return resp.json()["detail"]

    base = {"wave": "Y1", "filter": "country_code:1"}
    assert any("2 to 10" in m for m in detail(vars=["HAPPY"], **base))
    eleven = ["HAPPY", "LONELY", "ATTEND_SVCS", "BALANCE", "CHILD_MEM", "sfi", "sfi_health"]
    eleven += ["sfi_meaning", "sfi_character", "sfi_relationships", "sfi_financial"]
    assert any("2 to 10" in m for m in detail(vars=eleven, **base))
    assert any("duplicate" in m for m in detail(vars=["HAPPY", "HAPPY"], **base))
    assert any("has no order" in m for m in detail(vars=["HAPPY", "URBAN_RURAL"], **base))
    assert any("not asked at Y1" in m for m in detail(vars=["HAPPY", "MONEY"], **base))
    assert any("method must be" in m for m in detail(vars=["HAPPY", "LONELY"], method="x", **base))
    assert any("exactly one country" in m for m in detail(vars=["HAPPY", "LONELY"], wave="Y1"))
    # A request without vars at all is FastAPI's own 422.
    assert client.get("/v1/correlations", params=base).status_code == 422


def test_table_serves_pairs_never_people(client: TestClient) -> None:
    resp = client.get(
        "/v1/correlations",
        params={"vars": ["HAPPY", "LONELY"], "wave": "Y1", "filter": "country_code:1"},
    )
    assert set(resp.json()) == {"meta", "pairs"}
    assert resp.headers["cache-control"] == CACHE_CONTROL and resp.headers["etag"]


def test_table_503_without_data(absent_client: TestClient) -> None:
    resp = absent_client.get(
        "/v1/correlations",
        params={"vars": ["HAPPY", "LONELY"], "wave": "Y1", "filter": "country_code:1"},
    )
    assert resp.status_code == 503
