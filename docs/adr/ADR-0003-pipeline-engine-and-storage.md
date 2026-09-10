# ADR-0003: Pipeline engine and storage layout

**Status:** Accepted · **Date:** 2026-09-10 · **Phase:** 1

## Context

Phase 1 turns two CSVs (138 MB + 33 MB, every cell a string, blanks a
single space) and the parsed codebook into analysis-ready tables in under
five minutes on a laptop, reproducibly. The shape of those tables is fixed
by proposal §6: a `respondents` row per ID, a ~33M-row `responses_long`
table so "any variable × any breakdown" is one query pattern, derived
scores, and a single queryable file for the Phase 3 API (ADR-0002 chose
DuckDB over Postgres for serving).

## Decision

**polars for transformation, Parquet (ZSTD) as the canonical table
format, DuckDB assembled from the Parquet as the query artefact.**

- **Ingest reads everything as strings** (`infer_schema=False`) and casts
  per the catalog. This is the only way the blank-as-single-space missing
  convention and the zero-padded FIPS strings survive; the one fractional
  cell in the release (`DRINKS_Y2` `"4.5"`) is floored under a strict
  allowlist so any new anomaly still fails loudly.
- **The long table is built by per-wave unpivots** of the typed wide
  frame, sentinels mapped to `(value NULL, nonresponse)` by a join against
  the catalog's per-variable sentinel sets, then sorted on the full
  `(variable, wave, id)` key. The full-key sort makes the Parquet bytes
  reproducible run-to-run and gives variable-major locality, which is the
  Phase 3 access pattern. The in-memory engine is used for this collect:
  polars' streaming engine does not reproduce row order, and byte-stable
  outputs matter more than the ~2 GB it would save.
- **Every published table is Parquet first** (`data/parquet/`), and
  `data/flourish.duckdb` is created from those files
  (`CREATE TABLE … AS FROM read_parquet(…)`) plus the
  `responses_oriented` view, which flips `lower_better` items
  (`min + max − value`) instead of materialising a second 33M-row copy.
  Notebooks and the static exporter read Parquet; the API reads DuckDB.
- **Reproducibility contract:** all Parquet/JSON outputs are byte-identical
  across runs from the same inputs. `manifest.json` and
  `validation_report.md` embed run metadata (timestamp, stage timings) and
  are exempt. DuckDB's file format is not byte-deterministic, so
  `flourish.duckdb` is rebuilt each run and verified by content (table
  row counts and check results), with its per-build sha256 recorded in
  the manifest.

Measured on an M-series laptop: the full `run` (codebook → manifest)
takes ~10 s, two orders of magnitude inside the 300 s budget.

## Alternatives considered

- **pandas** — object-dtype columns for the blank-string convention, ~10×
  the memory for the long table, and the proposal's §6 note already
  rejects holding 33M rows as a pandas frame; rejected.
- **DuckDB-only SQL pipeline** — SQL can ingest and unpivot, but the
  catalog-driven per-variable sentinel logic, the derivations, and the
  fixture-tested pure functions are far more testable as polars
  expressions; DuckDB stays what ADR-0002 chose it for: serving queries.
- **Materialising a re-oriented copy of the long table** — doubles the
  largest artefact for a transformation a view expresses exactly.
- **DuckDB as the canonical store with Parquet exports** — inverts the
  dependency: the `.duckdb` file is not byte-reproducible, while Parquet
  is, so Parquet must be the artefact of record.

## Consequences

- `make data` is fast enough to run on every change; the idempotence
  check (byte-equality of data outputs) is cheap to keep in CI-adjacent
  tooling.
- The DuckDB file (~210 MB) exceeds the proposal's 50–80 MB estimate;
  Phase 3 owns slimming it (column pruning, dropping `coverage` from the
  image, or serving some tables straight from Parquet) before baking it
  into the container image.
- Two copies of each table exist (Parquet + DuckDB); the manifest hashes
  both, and validate reads only the DuckDB, so drift between them would
  surface as a check failure after any partial rebuild.
