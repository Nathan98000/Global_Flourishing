"""Shared pytest configuration for stats/tests and stats/verify.

Tests marked ``built`` need the Phase 1 outputs (``data/parquet/*.parquet``,
``data/flourish.duckdb``) and are skipped automatically when they are
absent, so CI — which never has the data — stays green. This mirrors the
``raw`` marker in ``pipeline/tests/conftest.py``. It lives at ``stats/``
(not ``stats/tests/``) so the R-parity test under ``stats/verify/`` shares
the marker.

Hypothesis runs the registered ``ci`` profile when ``CI`` is set: a fixed
number of examples with ``derandomize=True`` so CI is reproducible and fast
(proposal §10 budgets 8 minutes).
"""

import os
from pathlib import Path

import pytest
from hypothesis import HealthCheck, settings

REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = REPO_ROOT / "data"
BUILT_SENTINEL = DATA_DIR / "parquet" / "respondents.parquet"

settings.register_profile(
    "ci",
    max_examples=50,
    derandomize=True,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow],
)
settings.register_profile("dev", max_examples=100, deadline=None)
settings.load_profile("ci" if os.environ.get("CI") else "dev")


def built_data_present() -> bool:
    return BUILT_SENTINEL.exists()


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers",
        "built: needs the built data in data/parquet/ + data/flourish.duckdb "
        "(auto-skipped when absent)",
    )


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if built_data_present():
        return
    skip = pytest.mark.skip(reason="built data not present (run `make data`; see data/README.md)")
    for item in items:
        if "built" in item.keywords:
            item.add_marker(skip)


@pytest.fixture(scope="session")
def data_dir() -> Path:
    return DATA_DIR
