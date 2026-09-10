"""Small shared helpers for the pipeline stages."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def intermediate_dir(out_dir: Path) -> Path:
    path = out_dir / "intermediate"
    path.mkdir(parents=True, exist_ok=True)
    return path


def record_timing(out_dir: Path, stage: str, seconds: float) -> None:
    """Per-stage wall time, merged across invocations; read by validate/manifest."""
    path = intermediate_dir(out_dir) / "timings.json"
    timings: dict[str, float] = {}
    if path.exists():
        timings = {str(k): float(v) for k, v in json.loads(path.read_text()).items()}
    timings[stage] = round(seconds, 2)
    path.write_text(json.dumps(timings, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def read_timings(out_dir: Path) -> dict[str, float]:
    path = intermediate_dir(out_dir) / "timings.json"
    if not path.exists():
        return {}
    return {str(k): float(v) for k, v in json.loads(path.read_text()).items()}
