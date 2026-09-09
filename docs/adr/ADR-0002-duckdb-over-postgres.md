# ADR-0002: DuckDB over Postgres

**Status:** Accepted · **Date:** 2026-09-09 · **Phase:** 0

## Context

The app serves aggregates over a fixed survey release: ~207,919 respondents,
~35M rows in long format (proposal §6). Reads are analytical (group-by over
weighted values with design-based variance); there are **no writes** at
request time — the pipeline rebuilds the dataset offline when a new release
lands. Hosting must be free and low-ops.

## Decision

Use **DuckDB, in-process and read-only**, with the database file baked into
the API's container image (~50–80 MB expected). Parquet copies of the same
tables are kept for notebooks and for exporting the static aggregate tier.

## Rationale

- **Fits the workload:** columnar execution answers "any variable × any
  breakdown" group-bys over 35M rows in tens of milliseconds; Postgres needs
  careful indexing or materialised views for the same shapes.
- **Zero ops, zero cost:** no managed database to provision, pay for, secure,
  back up, or keep warm. The "database" deploys atomically with the code as
  one image; rollback is redeploying the previous image.
- **Reproducibility:** the file is a build artifact of `make data` with its
  SHA-256 in `data/manifest.json`, so API and data version together.

## Alternatives considered

- **Postgres (Cloud SQL / Supabase / Neon):** right choice the moment there
  are writes, users, or row-level security; none exist here. Free tiers sleep
  or expire, and OLAP-shaped queries are its weak axis. Kept in the backlog as
  a demonstration variant.
- **SQLite:** same in-process virtues, wrong engine shape (row store) for
  analytical scans.
- **Parquet + DataFusion/polars only:** viable, but DuckDB adds a SQL surface
  the API can expose safely and one file instead of many.

## Consequences

- Dataset updates require an image rebuild and redeploy — acceptable for
  at-most-annual releases.
- The file must fit Cloud Run's 512 MB memory alongside the process: column
  pruning, ZSTD compression, and a DuckDB memory limit are part of the
  pipeline's job (proposal §9); the heaviest queries can fall back to
  precomputed aggregates.
- Concurrent access is read-only by construction, so DuckDB's
  single-writer model costs nothing.
