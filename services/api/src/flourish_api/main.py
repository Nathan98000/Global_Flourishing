"""FastAPI application entry point.

Phase 0 scaffolding: only /healthz and a root pointer exist. The /v1 endpoints
arrive in Phase 3 (see docs/PROPOSAL.md §5.4).
"""

from fastapi import FastAPI

from flourish_api import __version__

app = FastAPI(
    title="Flourish Atlas API",
    version=__version__,
    description=(
        "Aggregate statistics from the Global Flourishing Study, Waves 1-2. "
        "Data: https://doi.org/10.17605/OSF.IO/3JTZ8"
    ),
)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    """Liveness probe for Cloud Run and uptime monitoring."""
    return {"status": "ok", "version": __version__}


@app.get("/")
def root() -> dict[str, str]:
    return {
        "name": "flourish-atlas-api",
        "docs": "/docs",
        "health": "/healthz",
        "data_citation": "Global Flourishing Study, Waves 1-2. https://doi.org/10.17605/OSF.IO/3JTZ8",
    }
