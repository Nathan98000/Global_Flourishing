"""GET /v1/meta."""

from fastapi.testclient import TestClient


def test_meta_shape(client: TestClient) -> None:
    body = client.get("/v1/meta").json()
    assert body["data_version"] == "synthetic.0.0.1"
    assert [c["code"] for c in body["countries"]] == [1, 22]
    assert body["waves"] == ["Y1", "MY", "Y2"]
    assert body["ci_level"] == 0.95
    assert body["suppression"] == {"threshold": 50, "flag_below": 100}
    assert "age_band" in body["breakdowns"] and "country_code" in body["breakdowns"]
    assert "wellbeing" in body["families"]


def test_meta_serves_the_weight_table_verbatim(client: TestClient) -> None:
    from flourish_stats import WEIGHT_TABLE

    table = client.get("/v1/meta").json()["weight_table"]
    assert len(table) == len(WEIGHT_TABLE) == 23
    by_key = {row["key"]: row for row in table}
    assert by_key["y1_y2"]["weight"] == "w_l2"
    assert by_key["my_y2"]["requires_midyear_type_1"] is True
    assert by_key["y1_y2_rect"]["is_default"] is False
    assert all(row["rationale"] for row in table)


def test_meta_503_without_data(absent_client: TestClient) -> None:
    resp = absent_client.get("/v1/meta")
    assert resp.status_code == 503
    assert "without data" in resp.json()["detail"]
