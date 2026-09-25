"""GET /v1/states, /v1/export.csv and /v1/correlates."""

import pytest
from fastapi.testclient import TestClient


def test_states_by_state_on_state_weights(client: TestClient) -> None:
    resp = client.get("/v1/states", params={"outcome": "HAPPY", "wave": "Y1"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["meta"]["weight_key"] == "us_state:y1"
    assert body["meta"]["weight"] == "w_state_c1"
    assert {r["group"]["state"] for r in body["rows"]} == {"CA", "NY", "TX"}


def test_states_adj_variant(client: TestClient) -> None:
    resp = client.get("/v1/states", params={"outcome": "HAPPY", "wave": "Y2", "adj": True})
    assert resp.status_code == 200
    assert resp.json()["meta"]["weight"] == "w_state_adj_c2"
    # …and the release has no adjusted Wave 1 weight:
    resp = client.get("/v1/states", params={"outcome": "HAPPY", "wave": "Y1", "adj": True})
    assert resp.status_code == 422
    assert any("no weight exists for wave Y1" in m for m in resp.json()["detail"])


def test_states_after_wave_1_follow_the_wave_2_state(client: TestClient) -> None:
    """The Wave 2 and midyear state weights are calibrated to the Wave 2
    state: a respondent with a Wave 1 state only is not in those frames
    (no such weight exists for them — the 500 this used to raise), one
    with a Wave 2 state only is, grouped by that state."""
    from synthetic_db import US_STATES

    # (No synthetic Californian is retained — CA is every third id — so
    # the Wave 2 frame holds two states; the midyear one all three.)
    for wave, weight, states, n_total in (
        ("Y2", "w_state_c2", {"NY", "TX"}, 39),
        ("MY", "w_state_l1m", set(US_STATES), 29),
    ):
        resp = client.get("/v1/states", params={"outcome": "BALANCE", "wave": wave})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["meta"]["weight"] == weight
        assert body["meta"]["by"] == ["state"]
        assert {r["group"]["state"] for r in body["rows"]} == states
        # Everyone eligible on the Wave 2 state: 40 retained (30 midyear) US
        # respondents minus the one with a Wave 1 state only.
        assert sum(r["n"] for r in body["rows"]) == n_total
    y1 = client.get("/v1/states", params={"outcome": "BALANCE", "wave": "Y1"}).json()["rows"]
    # …and at Wave 1 the 60 US respondents minus the one with a Wave 2 state only.
    assert sum(r["n"] for r in y1) == 59


def test_us_overall_on_the_state_weight(client: TestClient) -> None:
    """The reference the states are read against: the whole US on the
    state weight, through /v1/aggregate's state scope with no group."""
    resp = client.get(
        "/v1/aggregate", params={"outcome": "BALANCE", "wave": "Y2", "scope": "us_state"}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["meta"]["weight_key"] == "us_state:y2" and body["meta"]["by"] == []
    assert len(body["rows"]) == 1 and body["rows"][0]["n"] == 39


def test_states_extra_breakdown(client: TestClient) -> None:
    resp = client.get("/v1/states", params={"outcome": "HAPPY", "wave": "Y1", "by": "gender"})
    groups = [r["group"] for r in resp.json()["rows"]]
    assert all(set(g) == {"state", "gender"} for g in groups)


def test_export_csv_carries_meta_and_rows(client: TestClient) -> None:
    resp = client.get(
        "/v1/export.csv",
        params={"outcome": "HAPPY", "wave": "Y1", "by": "country_code"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/csv")
    # The name in words — the web client's exportFilename pins this same
    # example (export.test.ts): display name, view, wave; no code, no version.
    assert (
        'filename="flourish-atlas_happiness_by-country_2023.csv"'
        in (resp.headers["content-disposition"])
    )
    lines = resp.text.splitlines()
    assert lines[0] == "# data_version: synthetic.0.0.1"
    assert any(line.startswith("# weight_key: y1") for line in lines)
    header_index = next(i for i, line in enumerate(lines) if not line.startswith("#"))
    header = lines[header_index].split(",")
    assert header[0] == "country_code"
    assert {"estimate", "se", "n", "weight", "se_method", "suppressed"} <= set(header)
    assert len(lines) - header_index - 1 == 2  # one row per country


def test_export_csv_validation_passthrough(client: TestClient) -> None:
    resp = client.get("/v1/export.csv", params={"outcome": "NOPE", "wave": "Y1"})
    assert resp.status_code == 422


def test_export_values_match_the_json_response(client: TestClient) -> None:
    params = {"outcome": "HAPPY", "wave": "Y1", "by": "country_code"}
    json_rows = client.get("/v1/aggregate", params=params).json()["rows"]
    lines = client.get("/v1/export.csv", params=params).text.splitlines()
    header_index = next(i for i, line in enumerate(lines) if not line.startswith("#"))
    header = lines[header_index].split(",")
    first = dict(zip(header, lines[header_index + 1].split(","), strict=True))
    assert float(first["estimate"]) == pytest.approx(json_rows[0]["estimate"])
    assert int(first["n"]) == json_rows[0]["n"]
    # The correlates-only meta fields stay out of an aggregate export.
    assert not any(line.startswith(("# adjusted", "# controls", "# model")) for line in lines)


def test_export_csv_name_carries_breakdown_and_country_in_words(client: TestClient) -> None:
    """A split adds `_by-<breakdown display name>`; a single-country query
    adds the country's name, diacritics stripped (ADR-0016)."""
    resp = client.get(
        "/v1/export.csv",
        params={"outcome": "HAPPY", "wave": "Y2", "by": ["country_code", "gender"]},
    )
    assert (
        'filename="flourish-atlas_happiness_by-country_2024_by-gender.csv"'
        in (resp.headers["content-disposition"])
    )
    one = client.get(
        "/v1/export.csv",
        params={
            "outcome": "HAPPY",
            "wave": "Y1",
            "by": "country_code",
            "filter": "country_code:22",
        },
    )
    assert one.status_code == 200, one.text
    assert (
        'filename="flourish-atlas_happiness_by-country_2023_united-states.csv"'
        in (one.headers["content-disposition"])
    )
