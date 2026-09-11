"""Shared pytest configuration for the API package.

The ``client`` fixture serves the synthetic DuckDB (see synthetic.py) so
every endpoint is fully tested in CI without any real data; the
``absent_client`` serves no data at all. Tests marked ``built`` need the
real Phase 1 outputs and are skipped automatically when absent — the same
marker contract as stats/conftest.py.
"""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from flourish_api.config import Settings
from flourish_api.main import create_app

REPO_ROOT = Path(__file__).resolve().parents[3]
BUILT_SENTINEL = REPO_ROOT / "data" / "flourish.duckdb"


def built_data_present() -> bool:
    return BUILT_SENTINEL.exists()


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers",
        "built: needs the built data in data/flourish.duckdb (auto-skipped when absent)",
    )


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if built_data_present():
        return
    skip = pytest.mark.skip(reason="built data not present (run `make data`; see data/README.md)")
    for item in items:
        if "built" in item.keywords:
            item.add_marker(skip)


@pytest.fixture(scope="session")
def synthetic_data_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    from synthetic_db import build_synthetic_db  # sibling module, see docstring

    directory = tmp_path_factory.mktemp("synthetic-data")
    build_synthetic_db(directory)
    return directory


@pytest.fixture(scope="session")
def api_app(synthetic_data_dir: Path):
    settings = Settings(data_path=synthetic_data_dir / "flourish.duckdb")
    return create_app(settings)


@pytest.fixture(scope="session")
def client(api_app) -> TestClient:
    return TestClient(api_app)


@pytest.fixture(scope="session")
def store(api_app):
    """The app's DataStore, for tests that reach under the HTTP layer."""
    return api_app.state.store


@pytest.fixture()
def absent_client(tmp_path: Path) -> TestClient:
    settings = Settings(data_path=tmp_path / "nowhere.duckdb")
    return TestClient(create_app(settings))


@pytest.fixture(scope="session")
def built_client() -> TestClient:
    """The API over the real built data (only used by `built` tests)."""
    return TestClient(create_app(Settings(data_path=BUILT_SENTINEL)))
