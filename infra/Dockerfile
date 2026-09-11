# Flourish Atlas API image for Cloud Run.
# Build from the repo root: docker build -f infra/Dockerfile -t flourish-api .

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS build

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

COPY pyproject.toml uv.lock ./
COPY services/api/pyproject.toml services/api/pyproject.toml
COPY pipeline/pyproject.toml pipeline/pyproject.toml
COPY stats/pyproject.toml stats/pyproject.toml
RUN uv sync --frozen --no-install-workspace --no-dev --package flourish-api

COPY services/api services/api
COPY stats stats
# --no-editable: only .venv is copied to the runtime stage, so workspace
# packages must be installed into site-packages, not linked back to /app.
RUN uv sync --frozen --no-dev --no-editable --package flourish-api

FROM python:3.12-slim-bookworm

WORKDIR /app
COPY --from=build /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"

# The data layer rides in via the staging directory: the deploy workflow
# downloads flourish.duckdb + manifest.json from the private bucket into
# infra/data-stage/ before building (docs/SETUP.md). CI builds with the
# directory empty — the app boots, /health reports data=absent, and /v1
# endpoints 503 honestly (ADR-0007).
COPY infra/data-stage/ /app/data/
ENV FA_DATA_PATH=/app/data/flourish.duckdb

# Set by the deploy workflow so /health reports the build.
ARG GIT_SHA=""
ENV FA_GIT_SHA=$GIT_SHA

RUN useradd --create-home --uid 1000 app
USER app

# Cloud Run injects PORT; default to 8080 for local runs.
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "uvicorn flourish_api.main:app --host 0.0.0.0 --port ${PORT}"]
