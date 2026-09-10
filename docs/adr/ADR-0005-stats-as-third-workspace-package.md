# ADR-0005: Statistics engine as a third workspace package

**Status:** Accepted · **Date:** 2026-09-10 · **Phase:** 2

## Context

Proposal §5.3 places the statistics engine at `services/api/stats/`, inside
the API service. By Phase 3 the engine has two consumers with disjoint
deployment shapes: the API serves custom cuts from DuckDB on Cloud Run, and
the pipeline's static-aggregate exporter precomputes the ~2,500 hot views
at build time. The API image is also budgeted for a 512 MiB instance and
must not inherit the pipeline's parsing stack (pdfplumber, pandera) just to
compute a weighted mean; the pipeline must not import FastAPI to export
aggregates.

## Decision

**`stats/` is a third uv-workspace package, `flourish_stats`,** mirroring
the layout of `pipeline/` (hatchling, `src/` layout, `py.typed`, pyright
strict, pytest under `stats/tests/`).

- Runtime dependencies are exactly `numpy`, `polars`, `pyarrow` — the
  engine takes and returns Arrow tables (no pandas, per ADR-0003; no
  scipy/statsmodels: the only distribution needed is the normal, which the
  standard library's `statistics.NormalDist` provides). `duckdb` is an
  optional extra (`flourish-stats[duckdb]`) used only by
  `flourish_stats.io`, the verify harness and the built-data tests.
- `flourish-api` depends on `flourish-stats` from day one so the Docker
  build proves the package installs into the runtime image; the API starts
  *importing* it in Phase 3, and the pipeline gains the dependency with the
  Phase 3 exporter.
- The R parity harness lives in **`stats/verify/`**, not `pipeline/verify/`
  as proposal §5.3 sketched: it verifies the estimators, so it lives next
  to the package it verifies and ships nothing at runtime.
- The wave → weight → eligibility table (`flourish_stats.weights`) lives in
  the engine, not the API, because both consumers must agree on it; the API
  will serve its JSON export from `/v1/meta`.

## Alternatives considered

- **`services/api/stats/` (the proposal's sketch)** — couples the exporter
  to the API service and drags FastAPI into the pipeline's dependency
  closure (or forces a copy); rejected.
- **A module inside `pipeline/`** — the API image would inherit pdfplumber
  and pandera (~40 MB of parsing stack it never uses) and the pipeline's
  raw-data-adjacent surface; rejected.
- **Publishing to an internal index instead of a workspace member** —
  overhead without benefit for a monorepo whose consumers pin the same
  commit; rejected.

## Consequences

- Registration surface: workspace member, pyright strict include, pytest
  testpath, CI coverage flag, Dockerfile copy — all in this change, so the
  package cannot drift out of the quality gates.
- The API image grows by numpy/polars/pyarrow now rather than in Phase 3;
  that cost was inevitable and buys the Docker job proving the install.
- A new `built` pytest marker (auto-skip without `data/parquet/`) joins the
  pipeline's `raw` marker; CI runs neither.
