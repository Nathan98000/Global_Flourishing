"""Runtime settings, read from FA_-prefixed environment variables."""

from pathlib import Path
from typing import Literal

from flourish_stats.correlations import CORRELATES_MIN_N
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

    # Small-cell serving policy (ADR-0011): zeros show every cell — with
    # both thresholds 0, `n < 0` is never true, so nothing is suppressed
    # or flagged. Setting FA_SUPPRESSION_THRESHOLD=50 and
    # FA_SUPPRESSION_FLAG_BELOW=100 restores the pre-ADR-0011 rule; the
    # machinery in flourish_stats.suppression is untouched either way.
    suppression_threshold: int = 0
    suppression_flag_below: int = 0

    # The ranked correlates sweep leaves out predictors with fewer complete
    # cases than this in the country (ADR-0015; the default lives with the
    # other correlates constants in flourish_stats.correlations). Named
    # predictors are always served — the matrix mutes such cells instead.
    correlates_min_n: int = CORRELATES_MIN_N

    # The adjusted associations (ADR-0014) are the API's most expensive
    # request and nothing on the site asks for them since ADR-0018, so
    # `/v1/correlates?adjusted=true` is a 422 unless FA_ADJUSTED_ENABLED
    # is set. The statistics code and its tests stay; setting the variable
    # (and restoring the model-card route) brings them back.
    adjusted_enabled: bool = False

    # In-process LRU over /v1 GET responses (entries, not bytes; responses
    # are small aggregates). 0 disables.
    cache_size: int = 256
    # Per-IP token bucket on /v1, enforced only in prod (Cloud Run sets
    # X-Forwarded-For; per-instance limiting is acceptable at max 2
    # instances, ADR-0008). 0 disables.
    rate_limit_per_minute: int = 60
    # Sentry is initialised only when a DSN is provided (docs/SETUP.md).
    sentry_dsn: str | None = None

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def manifest_path(self) -> Path:
        return self.data_path.parent / "manifest.json"
