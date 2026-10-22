"""The CSV's suppression line says what the serving policy does (ADR-0031);
the client's export writes the same bytes (export/csv.ts suppressionLine)."""

from fastapi.testclient import TestClient
from flourish_api.serialize import suppression_line


def test_the_line_for_each_policy() -> None:
    assert suppression_line({"threshold": 0, "flag_below": 0}) == "none (all cells shown)"
    assert (
        suppression_line({"threshold": 0, "flag_below": 30})
        == "none (all cells shown); n<30 flagged"
    )
    assert suppression_line({"threshold": 50, "flag_below": 100}) == (
        "n<50 suppressed, n<100 flagged"
    )


def test_the_served_csv_carries_the_serving_policy(client: TestClient) -> None:
    resp = client.get(
        "/v1/export.csv", params={"outcome": "HAPPY", "wave": "Y1", "by": "country_code"}
    )
    assert "# suppression: none (all cells shown); n<30 flagged" in resp.text.splitlines()
