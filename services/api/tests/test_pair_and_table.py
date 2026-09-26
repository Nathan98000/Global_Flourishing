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


def test_pair_answers_run_from_least_to_most_of_the_label(client: TestClient) -> None:
    """ATTEND_SVCS runs 1 = Weekly … 3 = Never (polarity descending): its
    groups run Never → Weekly, each named by its answer, so the slope of
    the means follows the sign of the correlation."""
    body = get_pair(client, y="HAPPY", x="ATTEND_SVCS", wave="Y1", filter="country_code:1")
    assert body["x"] == "ATTEND_SVCS" and body["grouping"] == "answers"
    assert [g["code"] for g in body["groups"]] == [3, 2, 1]
    assert [g["label"] for g in body["groups"]] == ["Never", "Sometimes", "Weekly"]
    means = body["means"]
    assert means["meta"]["outcome"] == "HAPPY" and means["meta"]["by"] == ["ATTEND_SVCS"]
    assert means["meta"]["weight"] == "w_c1" and means["meta"]["stat"] == "mean"
    assert means["meta"]["filters"] == {"country_code": [1]}
    assert [row["group"] for row in means["rows"]] == [
        {"ATTEND_SVCS": 3},
        {"ATTEND_SVCS": 2},
        {"ATTEND_SVCS": 1},
    ]
    for row in means["rows"]:
        assert row["ci_method"] == "normal" and row["se_method"] == "taylor"
        assert row["ci_lo"] < row["estimate"] < row["ci_hi"]
    # Shares of the people who answered both, from the groups' weights.
    total = sum(row["sum_w"] for row in means["rows"])
    for group, row in zip(body["groups"], means["rows"], strict=True):
        assert group["share"] == pytest.approx(row["sum_w"] / total)
    assert sum(g["share"] for g in body["groups"]) == pytest.approx(1.0)
    # 18 people per group < the test app's floor of 20: flagged, not dropped.
    assert all(g["below_min_n"] for g in body["groups"])
    assert means["meta"]["min_n"] == 20
    # The correlation: a point estimate over everyone who answered both.
    corr = body["correlation"]
    assert corr["predictor"] == "ATTEND_SVCS" and corr["stat"] == "pearson_r"
    assert corr["ci_method"] == "none" and corr["se"] is None
    assert corr["n"] == sum(row["n"] for row in means["rows"]) == means["meta"]["n_valid"]


def test_pair_numbers_are_the_other_routes_numbers(client: TestClient) -> None:
    """The correlation is /v1/correlates' for the pair (either method);
    the means are /v1/aggregate's, grouped by x — same design, weight, SE."""
    for method in ("pearson", "spearman"):
        body = get_pair(
            client, y="HAPPY", x="ATTEND_SVCS", wave="Y1", filter="country_code:1", method=method
        )
        ranked = client.get(
            "/v1/correlates",
            params={
                "outcome": "HAPPY",
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
        params={"outcome": "HAPPY", "wave": "Y1", "by": "ATTEND_SVCS", "filter": "country_code:1"},
    ).json()
    by_code = {
        row["group"]["ATTEND_SVCS"]: row
        for row in aggregate["rows"]
        if row["group"]["ATTEND_SVCS"] is not None
    }
    for row in body["means"]["rows"]:
        expected = by_code[row["group"]["ATTEND_SVCS"]]
        assert row["estimate"] == pytest.approx(expected["estimate"], rel=1e-12)
        assert row["se"] == pytest.approx(expected["se"], rel=1e-9)
        assert row["n"] == expected["n"] and row["weight"] == expected["weight"]


def test_a_yes_no_outcome_is_its_share_answering_yes(client: TestClient) -> None:
    body = get_pair(client, y="phq2_positive", x="LONELY", wave="Y1", filter="country_code:1")
    means = body["means"]
    assert means["meta"]["stat"] == "proportion"
    assert all(row["stat"] == "proportion" for row in means["rows"])
    assert all(0 <= row["estimate"] <= 1 for row in means["rows"] if row["estimate"] is not None)
    # LONELY's eleven answers, numbered, lowest first.
    assert [g["label"] for g in body["groups"]] == [str(n) for n in range(11)]


def test_a_derived_score_is_binned_between_its_percentiles(client: TestClient) -> None:
    body = get_pair(client, y="LONELY", x="sfi", wave="Y1", filter="country_code:22")
    assert body["grouping"] == "bins"
    assert len(body["groups"]) == 10
    assert [g["code"] for g in body["groups"]] == list(range(10))
    # Bins are labelled by their range, one decimal; the group value in
    # the means rows is that label.
    assert all(
        "–" in g["label"] or "below" in g["label"] or "above" in g["label"] for g in body["groups"]
    )
    assert [row["group"]["sfi"] for row in body["means"]["rows"]] == [
        g["label"] for g in body["groups"]
    ]
    assert sum(g["share"] for g in body["groups"]) == pytest.approx(1.0)


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
    expression, groups = bin_groups(frame, design, integer=True)
    labels = [g.label for g in groups]
    assert len(groups) <= 10
    assert labels[0] == "0–4" and labels[-1].endswith("or more")
    index = frame.with_columns(expression.alias("g"))["g"].to_list()
    assert min(index) == 0 and max(index) == len(groups) - 1
    # A short count: one bin per whole number.
    short = frame.with_columns(pl.col(PAIR_X).clip(0, 5))
    _, groups = bin_groups(short, design, integer=True)
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


def test_pair_serves_groups_never_people(client: TestClient) -> None:
    """Respondent-level points would publish microdata: the response holds
    one mean per group, and nothing per person."""
    resp = client.get(
        "/v1/correlations/pair",
        params={"y": "HAPPY", "x": "LONELY", "wave": "Y1", "filter": "country_code:1"},
    )
    body = resp.json()
    assert set(body) == {"x", "grouping", "correlation", "means", "groups"}
    assert len(body["groups"]) == len(body["means"]["rows"]) == 11
    assert body["correlation"]["n"] > len(body["groups"])
    # The same cache contract as every /v1 route.
    assert resp.headers["cache-control"] == CACHE_CONTROL
    assert resp.headers["etag"]


def test_pair_domain_filter_keeps_the_design(client: TestClient) -> None:
    whole = get_pair(client, y="HAPPY", x="LONELY", wave="Y1", filter="country_code:1")
    men = get_pair(client, y="HAPPY", x="LONELY", wave="Y1", filter=["country_code:1", "gender:1"])
    assert men["means"]["meta"]["n_frame"] == whole["means"]["meta"]["n_frame"]
    assert men["correlation"]["n"] < whole["correlation"]["n"]
    assert men["means"]["meta"]["filters"] == {"country_code": [1], "gender": [1]}


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
    assert body["means"]["meta"]["min_n"] == 10
    assert not any(g["below_min_n"] for g in body["groups"])


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
