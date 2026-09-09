# Flourish Atlas API image for Cloud Run.
# Build from the repo root: docker build -f infra/Dockerfile -t flourish-api .
# From Phase 3 the DuckDB file is baked in alongside the code (proposal §5.4).

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS build

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

COPY pyproject.toml uv.lock ./
COPY services/api/pyproject.toml services/api/pyproject.toml
COPY pipeline/pyproject.toml pipeline/pyproject.toml
RUN uv sync --frozen --no-install-workspace --no-dev --package flourish-api

COPY services/api services/api
# --no-editable: only .venv is copied to the runtime stage, so workspace
# packages must be installed into site-packages, not linked back to /app.
RUN uv sync --frozen --no-dev --no-editable --package flourish-api

FROM python:3.12-slim-bookworm

WORKDIR /app
COPY --from=build /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"

# Cloud Run injects PORT; default to 8080 for local runs.
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "uvicorn flourish_api.main:app --host 0.0.0.0 --port ${PORT}"]
