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
    assert (
        'filename="flourish_HAPPY_Y1_mean_synthetic.0.0.1.csv"'
        in resp.headers["content-disposition"]
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


def test_correlates_is_a_loud_phase_6_stub(client: TestClient) -> None:
    resp = client.get("/v1/correlates")
    assert resp.status_code == 501
    assert resp.json()["detail"] == "Not implemented: Phase 6"
