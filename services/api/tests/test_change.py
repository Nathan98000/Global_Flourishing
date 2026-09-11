"""GET /v1/change against the synthetic data."""

from fastapi.testclient import TestClient


def get_change(client: TestClient, **params) -> tuple[dict, list[dict]]:
    resp = client.get("/v1/change", params=params)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    return body["meta"], body["rows"]


def test_pair_change_uses_the_longitudinal_weight(client: TestClient) -> None:
    meta, rows = get_change(client, outcome="HAPPY", **{"from": "Y1"}, to="Y2", by="country_code")
    assert meta["weight_key"] == "y1_y2" and meta["weight"] == "w_l2"
    assert meta["waves"] == ["Y1", "Y2"]
    change_rows = [r for r in rows if r["stat"] == "change"]
    assert len(change_rows) == 2
    assert all(r["weight"] == "w_l2" for r in rows)


def test_change_distribution_bins_are_suppressed_but_countable(client: TestClient) -> None:
    """Per-bin n in the synthetic data sits under the fixed threshold (50),
    so the API rightly suppresses every bin — while keeping n visible."""
    _, rows = get_change(
        client, outcome="HAPPY", **{"from": "Y1"}, to="Y2", filter="country_code:1"
    )
    dist = [r for r in rows if r["stat"] == "change_distribution"]
    assert [r["level"] for r in dist] == list(range(-10, 11))
    assert all(r["suppressed"] and r["estimate"] is None for r in dist)
    # every complete pair lands in exactly one bin
    change_row = next(r for r in rows if r["stat"] == "change")
    assert sum(r["n"] for r in dist) == change_row["n"]


def test_ordinal_outcome_gets_a_transition_matrix(client: TestClient) -> None:
    _, rows = get_change(
        client, outcome="ATTEND_SVCS", **{"from": "Y1"}, to="Y2", filter="country_code:1"
    )
    stats = {r["stat"] for r in rows}
    assert stats == {"change", "change_distribution", "transition"}
    joint = [r for r in rows if r["measure"] == "transition_joint"]
    assert {(r["from_level"], r["to_level"]) for r in joint} == {
        (i, j) for i in (1, 2, 3) for j in (1, 2, 3)
    }
    # The synthetic patterns make retention exclude from-level 1: the 40
    # pairs split over (2,3) and (3,1), every cell below the suppression
    # threshold — estimates withheld, n honest.
    counts = {(r["from_level"], r["to_level"]): r["n"] for r in joint}
    assert counts[(2, 3)] == 20 and counts[(3, 1)] == 20
    assert sum(counts.values()) == 40
    assert all(r["suppressed"] for r in joint)
    conditional = [r for r in rows if r["measure"] == "transition_conditional"]
    assert len(conditional) == 9


def test_rect_reaches_the_rectangular_weight(client: TestClient) -> None:
    meta, _ = get_change(
        client, outcome="HAPPY", **{"from": "Y1"}, to="Y2", by="country_code", rect=True
    )
    assert meta["weight_key"] == "y1_y2_rect" and meta["weight"] == "w_r2"


def test_three_point_panel_legs_and_midyear_restriction(client: TestClient) -> None:
    meta, rows = get_change(
        client, outcome="BALANCE", **{"from": "Y1"}, via="MY", to="Y2", filter="country_code:1"
    )
    assert meta["weight_key"] == "y1_my_y2" and meta["weight"] == "w_l1m2"
    legs = {r["leg"]: r for r in rows}
    assert set(legs) == {"y1_my", "my_y2", "y1_y2"}
    # retained ∧ midyear in Testland = 20 people; standalone midyear = 10.
    assert legs["y1_my"]["n"] == 20 and legs["y1_y2"]["n"] == 20
    assert legs["my_y2"]["n"] == 10  # the weight table's restriction, not ours


def test_change_validation(client: TestClient) -> None:
    def detail(**params) -> list[str]:
        resp = client.get("/v1/change", params=params)
        assert resp.status_code == 422, resp.text
        return resp.json()["detail"]

    assert any(
        "chronological" in m
        for m in detail(outcome="HAPPY", **{"from": "Y2"}, to="Y1", by="country_code")
    )
    assert any(
        "not asked at MY" in m
        for m in detail(outcome="HAPPY", **{"from": "MY"}, to="Y2", by="country_code")
    )
    assert any(
        "rect=true" in m
        for m in detail(outcome="BALANCE", **{"from": "MY"}, to="Y2", rect=True, by="country_code")
    )
    assert any(
        "demographic columns only" in m
        for m in detail(
            outcome="HAPPY", **{"from": "Y1"}, to="Y2", by=["country_code", "ATTEND_SVCS"]
        )
    )
    assert any("group by country" in m for m in detail(outcome="HAPPY", **{"from": "Y1"}, to="Y2"))
    assert any(
        "column:value" in m
        for m in detail(outcome="HAPPY", **{"from": "Y1"}, to="Y2", filter="gender")
    )
    assert any(
        "not filterable" in m
        for m in detail(outcome="HAPPY", **{"from": "Y1"}, to="Y2", filter="shoe_size:9")
    )
    assert any(
        "unknown country" in m
        for m in detail(outcome="HAPPY", **{"from": "Y1"}, to="Y2", filter="country_code:99")
    )
    assert any(
        "not an integer" in m
        for m in detail(outcome="HAPPY", **{"from": "Y1"}, to="Y2", filter="country_code:xx")
    )
    assert any(
        "US-only" in m
        for m in detail(
            outcome="HAPPY",
            **{"from": "Y1"},
            to="Y2",
            scope="us_state",
            by="state",
            filter="country_code:1",
        )
    )
    assert any(
        "unknown or non-servable" in m for m in detail(outcome="NOPE", **{"from": "Y1"}, to="Y2")
    )
    assert any("wave must be" in m for m in detail(outcome="HAPPY", **{"from": "Y1"}, to="Y9"))
    assert any(
        "duplicate" in m
        for m in detail(
            outcome="HAPPY", **{"from": "Y1"}, to="Y2", by=["country_code", "country_code"]
        )
    )


def test_change_filters_apply_as_domains(client: TestClient) -> None:
    meta_all, _ = get_change(
        client, outcome="HAPPY", **{"from": "Y1"}, to="Y2", filter="country_code:1"
    )
    meta_men, _ = get_change(
        client,
        outcome="HAPPY",
        **{"from": "Y1"},
        to="Y2",
        filter=["country_code:1", "gender:1"],
    )
    assert meta_men["n_frame"] == meta_all["n_frame"]  # design kept
    change_all = meta_all["n_valid"]
    assert meta_men["n_valid"] < change_all
    assert meta_men["filters"] == {"country_code": [1], "gender": [1]}


def test_change_on_us_state_scope(client: TestClient) -> None:
    meta, _ = get_change(
        client, outcome="HAPPY", **{"from": "Y1"}, to="Y2", scope="us_state", by="state"
    )
    assert meta["weight_key"] == "us_state:y1_y2" and meta["weight"] == "w_state_l2"


def test_change_503_without_data(absent_client: TestClient) -> None:
    resp = absent_client.get("/v1/change", params={"outcome": "HAPPY", "from": "Y1", "to": "Y2"})
    assert resp.status_code == 503
