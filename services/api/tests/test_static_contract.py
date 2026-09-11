"""The static tier and the API share one envelope (ADR-0008).

The exporter builds its JSON without importing the API (the pipeline must
not depend on FastAPI), so this test is the contract: run the exporter on
the synthetic database and validate **every** produced file with the
API's own pydantic response models. If either side drifts, CI fails here.
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from flourish_api.schemas import EstimateResponse
from flourish_pipeline.aggregate import export_static

# One outcome per view shape (numeric, categorical, three-wave, derived
# float, derived boolean) — the contract needs the shapes, not the volume.
CONTRACT_OUTCOMES = ("HAPPY", "ATTEND_SVCS", "BALANCE", "sfi", "phq2_positive")


@pytest.fixture(scope="module")
def static_dir(synthetic_data_dir: Path, tmp_path_factory: pytest.TempPathFactory) -> Path:
    out = tmp_path_factory.mktemp("static")
    export_static(
        synthetic_data_dir / "flourish.duckdb",
        out,
        data_version="synthetic.0.0.1",
        only=CONTRACT_OUTCOMES,
    )
    return out


def test_every_static_file_validates_as_an_api_response(static_dir: Path) -> None:
    files = sorted(static_dir.glob("v1/**/*.json"))
    assert len(files) > 20
    for path in files:
        envelope = EstimateResponse.model_validate_json(path.read_text())
        assert envelope.meta.data_version == "synthetic.0.0.1"
        for row in envelope.rows:
            assert row.weight == envelope.meta.weight
            assert row.n >= 0


def test_index_lists_every_file(static_dir: Path) -> None:
    index = json.loads((static_dir / "index.json").read_text())
    listed = {entry["path"] for entry in index["files"]}
    on_disk = {path.relative_to(static_dir).as_posix() for path in static_dir.glob("v1/**/*.json")}
    assert listed == on_disk
    assert index["file_count"] == len(on_disk)
    assert index["data_version"] == "synthetic.0.0.1"


def test_static_mean_equals_the_api_response(static_dir: Path, client: TestClient) -> None:
    """The two tiers must answer the Atlas view identically.

    Compared as validated models: the static tier omits null sub-row keys
    (they are schema-optional) while FastAPI serialises them explicitly —
    same contract, so the parsed responses must be equal field for field.
    """
    static = EstimateResponse.model_validate_json(
        (static_dir / "v1" / "HAPPY" / "Y1" / "mean_by-country_code.json").read_text()
    )
    api = EstimateResponse.model_validate(
        client.get(
            "/v1/aggregate", params={"outcome": "HAPPY", "wave": "Y1", "by": "country_code"}
        ).json()
    )
    assert static.rows == api.rows
    assert static.meta.weight_key == api.meta.weight_key
    assert static.meta.n_valid == api.meta.n_valid


def test_exporter_is_deterministic(
    synthetic_data_dir: Path, static_dir: Path, tmp_path: Path
) -> None:
    export_static(
        synthetic_data_dir / "flourish.duckdb",
        tmp_path,
        data_version="synthetic.0.0.1",
        only=CONTRACT_OUTCOMES,
    )
    first = (static_dir / "v1" / "HAPPY" / "Y1" / "mean_by-country_code.json").read_bytes()
    second = (tmp_path / "v1" / "HAPPY" / "Y1" / "mean_by-country_code.json").read_bytes()
    assert first == second
    assert (static_dir / "index.json").read_bytes() == (tmp_path / "index.json").read_bytes()
