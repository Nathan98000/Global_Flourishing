"""Shared pytest configuration for the pipeline package.

Tests marked ``raw`` need the raw GFS files (never in git) under
``data/raw/`` and are skipped automatically when they are absent, so CI
stays green without data.
"""

from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = REPO_ROOT / "data" / "raw"
RAW_FILES = (
    "gfs_all_countries_wave2_with_midyear.csv",
    "gfs_us-state-weight_wave2_with-midyear.csv",
    "GFS_codebook_wave2.pdf",
)


def raw_files_present() -> bool:
    return all((RAW_DIR / name).exists() for name in RAW_FILES)


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers", "raw: needs the raw GFS files in data/raw/ (auto-skipped when absent)"
    )


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if raw_files_present():
        return
    skip = pytest.mark.skip(reason="raw GFS files not present in data/raw/ (see data/README.md)")
    for item in items:
        if "raw" in item.keywords:
            item.add_marker(skip)


@pytest.fixture(scope="session")
def raw_dir() -> Path:
    return RAW_DIR
