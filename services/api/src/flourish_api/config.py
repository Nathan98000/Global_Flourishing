"""Runtime settings, read from FA_-prefixed environment variables."""

from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="FA_")

    env: Literal["dev", "prod"] = "dev"
    port: int = 8080
    # Comma-separated allowed origins, e.g. "https://flourish-atlas.pages.dev"
    cors_origins: str = ""
    # Injected by the deploy workflow so /healthz can identify the build.
    git_sha: str | None = None

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]
