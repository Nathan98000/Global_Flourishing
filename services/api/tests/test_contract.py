"""Contract tests: golden responses + the OpenAPI schema's promises.

Golden files pin the full envelope for three canonical queries against the
deterministic synthetic data. To regenerate after an intentional contract
change: UPDATE_GOLDEN=1 uv run pytest services/api/tests/test_contract.py
"""

import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

GOLDEN_DIR = Path(__file__).parent / "golden"


def assert_json_close(actual: object, expected: object, where: str = "$") -> None:
    """Structural equality with float tolerance.

    Goldens are generated on one machine and checked on another; ARM and
    x86-64 differ in the last ULP of `estimate ± z·se` arithmetic, so
    floats compare at rel 1e-12 while every other value — keys, ints,
    bools, strings, null — stays exact.
    """
    if isinstance(expected, bool) or isinstance(actual, bool):
        assert actual == expected, where
    elif isinstance(expected, float) or isinstance(actual, float):
        assert actual == pytest.approx(expected, rel=1e-12, abs=1e-12), where
    elif isinstance(expected, dict):
        assert isinstance(actual, dict), where
        assert actual.keys() == expected.keys(), where
        for key, value in expected.items():
            assert_json_close(actual[key], value, f"{where}.{key}")
    elif isinstance(expected, list):
        assert isinstance(actual, list) and len(actual) == len(expected), where
        for i, value in enumerate(expected):
            assert_json_close(actual[i], value, f"{where}[{i}]")
    else:
        assert actual == expected, where


CASES: dict[str, dict] = {
    "aggregate_mean_by_country": {
        "path": "/v1/aggregate",
        "params": {"outcome": "HAPPY", "wave": "Y1", "by": "country_code"},
    },
    "aggregate_proportions": {
        "path": "/v1/aggregate",
        "params": {
            "outcome": "ATTEND_SVCS",
            "wave": "Y1",
            "stat": "proportion",
            "filter": "country_code:1",
        },
    },
    "change_y1_y2": {
        "path": "/v1/change",
        "params": {"outcome": "ATTEND_SVCS", "from": "Y1", "to": "Y2", "filter": "country_code:1"},
    },
}


@pytest.mark.parametrize("name", sorted(CASES))
def test_golden_response(name: str, client: TestClient) -> None:
    case = CASES[name]
    resp = client.get(case["path"], params=case["params"])
    assert resp.status_code == 200, resp.text
    body = resp.json()
    path = GOLDEN_DIR / f"{name}.json"
    if os.environ.get("UPDATE_GOLDEN"):
        GOLDEN_DIR.mkdir(exist_ok=True)
        path.write_text(json.dumps(body, indent=2, sort_keys=True) + "\n")
    assert path.exists(), f"golden file missing — run with UPDATE_GOLDEN=1 to create {path}"
    assert_json_close(body, json.loads(path.read_text()))


def test_openapi_estimate_row_promises_the_record(client: TestClient) -> None:
    """CLAUDE.md: numbers never appear without weight, n and CI — the
    schema itself must require those fields on every estimate row."""
    schema = client.get("/openapi.json").json()
    row = schema["components"]["schemas"]["EstimateRow"]
    required = set(row["required"])
    assert {
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
        "se_method",
        "weight",
        "suppressed",
        "flagged",
    } <= required


def test_openapi_lists_every_v1_endpoint(client: TestClient) -> None:
    paths = set(client.get("/openapi.json").json()["paths"])
    assert {
        "/v1/meta",
        "/v1/variables",
        "/v1/variables/{name}",
        "/v1/aggregate",
        "/v1/change",
        "/v1/states",
        "/v1/export.csv",
        "/v1/correlates",
        "/health",
    } <= paths
