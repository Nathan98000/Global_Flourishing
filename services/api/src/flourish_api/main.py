"""FastAPI application factory.

Phase 0 scaffolding: /health and a redirect to the OpenAPI docs. The /v1
endpoints arrive in Phase 3 (docs/PROPOSAL.md §5.4), and Phase 3 generates
the web app's TypeScript client from the OpenAPI schema served here.
"""

from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from flourish_api import __version__
from flourish_api.config import Settings


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()

    app = FastAPI(
        title="Flourish Atlas API",
        version=__version__,
        description=(
            "Aggregate statistics from the Global Flourishing Study, Waves 1-2. "
            "Data: https://doi.org/10.17605/OSF.IO/3JTZ8"
        ),
    )

    if settings.cors_origin_list:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origin_list,
            allow_methods=["GET"],
            allow_headers=["*"],
        )

    @app.get("/health")
    def health() -> dict[str, Any]:  # pyright: ignore[reportUnusedFunction] — registered via decorator
        """Liveness probe for Cloud Run and uptime monitoring."""
        return {
            "status": "ok",
            "service": "flourish-atlas-api",
            "version": __version__,
            "git_sha": settings.git_sha,
            # Filled from data/manifest.json in Phase 1; null until then.
            "data_version": None,
        }

    @app.get("/", include_in_schema=False)
    def root() -> RedirectResponse:  # pyright: ignore[reportUnusedFunction] — registered via decorator
        return RedirectResponse(url="/docs")

    return app


app = create_app()
