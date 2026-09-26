"""FastAPI application factory.

The DuckDB-backed :class:`~flourish_api.data.DataStore` is built eagerly in
``create_app`` (a read-only open is milliseconds and a missing file is a
supported state — see ADR-0007) and closed on lifespan shutdown. `/v1/*`
endpoints live under ``flourish_api.routes``; Phase 3 generates the web
app's TypeScript client from the OpenAPI schema served here.
"""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from flourish_stats import SuppressionPolicy

from flourish_api import __version__
from flourish_api.config import Settings
from flourish_api.data import DataStore
from flourish_api.ops import init_sentry, install_middleware
from flourish_api.routes import v1
from flourish_api.schemas import HealthResponse


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    store = DataStore(settings)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
        yield
        store.close()

    app = FastAPI(
        title="Flourish Atlas API",
        version=__version__,
        description=(
            "Aggregate statistics from the Global Flourishing Study, Waves 1-2. "
            "Every estimate carries its survey weight, design-based CI "
            "and unweighted n. "
            "Data: https://doi.org/10.17605/OSF.IO/3JTZ8"
        ),
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.store = store
    # The serving policy, built once (ADR-0011: zeros by default — every
    # cell is shown; FA_SUPPRESSION_* restores the old rule).
    app.state.suppression_policy = SuppressionPolicy(
        threshold=settings.suppression_threshold,
        flag_below=settings.suppression_flag_below,
    )
    app.state.correlates_min_n = settings.correlates_min_n
    app.state.adjusted_enabled = settings.adjusted_enabled

    init_sentry(settings)
    install_middleware(app, settings)

    # Dev default: the Vite dev/preview servers, so the local loop
    # (`make api` + `make web`) exercises the front end's API fallback
    # without exporting FA_CORS_ORIGINS. Prod stays explicit-only.
    origins = settings.cors_origin_list
    if not origins and settings.env == "dev":
        origins = ["http://localhost:5173", "http://localhost:4173"]
    if origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_methods=["GET"],
            allow_headers=["*"],
        )

    app.include_router(v1)

    @app.get("/health")
    def health() -> HealthResponse:  # pyright: ignore[reportUnusedFunction] — registered via decorator
        """Liveness probe for Cloud Run and uptime monitoring.

        ``status`` reports the process; ``data`` is honest about whether a
        DuckDB file is baked into this deployment (CI images have none).
        """
        return HealthResponse(
            status="ok",
            service="flourish-atlas-api",
            version=__version__,
            git_sha=settings.git_sha,
            data="ok" if store.present else "absent",
            data_version=store.data_version,
        )

    @app.get("/", include_in_schema=False)
    def root() -> RedirectResponse:  # pyright: ignore[reportUnusedFunction] — registered via decorator
        return RedirectResponse(url="/docs")

    return app


app = create_app()
