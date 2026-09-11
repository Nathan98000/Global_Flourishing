"""Runtime settings, read from FA_-prefixed environment variables."""

from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="FA_")

    env: Literal["dev", "prod"] = "dev"
    port: int = 8080
    # Comma-separated allowed origins, e.g. "https://flourish-atlas.pages.dev"
    cors_origins: str = ""
    # Injected by the deploy workflow so /health can identify the build.
    git_sha: str | None = None

    # The baked DuckDB file (infra/Dockerfile stages it under /app/data in
    # the image; the default serves `make api` from a local `make data`
    # build). `data/manifest.json` is read from the same directory. A
    # missing file is a supported state: the app boots, /health says
    # data=absent, and /v1/* return 503 (see flourish_api.data).
    data_path: Path = Path("data/flourish.duckdb")

    # DuckDB tuning for the 512 MiB / 1 CPU Cloud Run shape. Values are
    # config, not code, so ADR-0007's measured tuning is an env change.
    duckdb_threads: int = 2
    duckdb_memory_limit: str = "256MB"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def manifest_path(self) -> Path:
        return self.data_path.parent / "manifest.json"
