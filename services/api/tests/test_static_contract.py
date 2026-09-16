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
from flourish_api.schemas import EstimateResponse, MetaResponse, VariableDetail, VariableList
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
    details = 0
    for path in files:
        if path.name == "variable.json":
            VariableDetail.model_validate_json(path.read_text())
            details += 1
            continue
        envelope = EstimateResponse.model_validate_json(path.read_text())
        assert envelope.meta.data_version == "synthetic.0.0.1"
        for row in envelope.rows:
            assert row.weight == envelope.meta.weight
            assert row.n >= 0
    assert details > len(CONTRACT_OUTCOMES)  # every substantive variable, not just `only`


def test_index_lists_every_file(static_dir: Path) -> None:
    index = json.loads((static_dir / "index.json").read_text())
    listed = {entry["path"] for entry in index["files"]}
    on_disk = {path.relative_to(static_dir).as_posix() for path in static_dir.glob("v1/**/*.json")}
    assert listed == on_disk
    assert index["file_count"] == len(on_disk)
    assert index["data_version"] == "synthetic.0.0.1"
    assert index["catalog_files"] == ["meta.json", "variables.json"]
    assert all((static_dir / name).exists() for name in index["catalog_files"])
    kinds = {entry.get("kind") for entry in index["files"]}
    assert kinds == {None, "variable"}


def test_static_meta_matches_the_api(static_dir: Path, client: TestClient) -> None:
    """meta.json is the /v1/meta payload minus git_sha — countries, weight
    table, suppression, breakdown labels and all (the app's boot data)."""
    static = MetaResponse.model_validate_json((static_dir / "meta.json").read_text())
    api = MetaResponse.model_validate(client.get("/v1/meta").json())
    assert "git_sha" not in json.loads((static_dir / "meta.json").read_text())
    assert static == api.model_copy(update={"git_sha": None})


def test_static_variables_match_the_api(static_dir: Path, client: TestClient) -> None:
    static = VariableList.model_validate_json((static_dir / "variables.json").read_text())
    api = VariableList.model_validate(client.get("/v1/variables").json())
    assert static == api


@pytest.mark.parametrize("name", ["HAPPY", "ATTEND_SVCS", "sfi"])
def test_static_variable_detail_matches_the_api(
    static_dir: Path, client: TestClient, name: str
) -> None:
    static = VariableDetail.model_validate_json(
        (static_dir / "v1" / name / "variable.json").read_text()
    )
    api = VariableDetail.model_validate(client.get(f"/v1/variables/{name}").json())
    assert static == api


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
    assert (static_dir / "meta.json").read_bytes() == (tmp_path / "meta.json").read_bytes()
    assert (static_dir / "variables.json").read_bytes() == (
        tmp_path / "variables.json"
    ).read_bytes()
