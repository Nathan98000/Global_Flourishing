"""CSV column-name helpers shared by the codebook and pipeline stages."""

from __future__ import annotations

import csv
import re
from pathlib import Path

from .codebook.model import WAVES

_SUFFIX_RE = re.compile(r"_(Y1|Y2|MY)$")

GLOBAL_CSV = "gfs_all_countries_wave2_with_midyear.csv"
US_CSV = "gfs_us-state-weight_wave2_with-midyear.csv"
CODEBOOK_PDF = "GFS_codebook_wave2.pdf"


def base_name(column: str) -> str:
    """Strip the wave suffix: ``HAPPY_Y1`` → ``HAPPY``, ``GENDER`` → ``GENDER``."""
    return _SUFFIX_RE.sub("", column)


def wave_of(column: str) -> str | None:
    """The wave suffix of a column, or None for unsuffixed columns."""
    match = _SUFFIX_RE.search(column)
    return match.group(1) if match else None


def waves_available(columns: list[str], base: str) -> list[str]:
    """Waves a base name appears in, in chronological order (Y1, MY, Y2)."""
    found = {wave_of(c) for c in columns if base_name(c) == base}
    return [w for w in WAVES if w in found]


def read_header(csv_path: Path) -> list[str]:
    """Column names only; never reads a data row."""
    with csv_path.open(newline="") as handle:
        return next(csv.reader(handle))
