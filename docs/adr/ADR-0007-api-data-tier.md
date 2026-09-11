# ADR-0007: API data tier — baked read-only DuckDB, absent-data mode

**Status:** Accepted · **Date:** 2026-09-10 · **Phase:** 3

## Context

The API serves design-based estimates from one immutable survey release on
a 512 MiB / 1 CPU Cloud Run instance (ADR-0002 chose in-process DuckDB
baked into the image). Two facts complicate "just COPY the file": neither
CI nor the deploy workflow has the data (it never enters git), and the
current build is 143.8 MiB (correcting ADR-0003's stale ~210 MB — the
fresh Phase 1 rebuild is smaller than first measured).

## Decision

1. **One read-only connection, opened eagerly in `create_app`** and closed
   on lifespan shutdown. A read-only open is milliseconds; eager
   construction keeps `/health` and tests deterministic. DuckDB `threads`
   and `memory_limit` are `FA_`-settings (defaults 2 / 256MB), so the
   measured tuning is an env change, not a release.
2. **The small tables (`variables`, `value_labels`, `countries`,
   `coverage` — ~8k rows total) load into memory at startup**; the big
   tables are sliced per request through `flourish_stats.io` only. The
   servable-outcome allow-list (substantive scale types, not
   country-specific, not restricted) and the 11 derived outcomes are
   computed once here.
3. **Absent data is a supported state.** With no file at `FA_DATA_PATH`
   the app boots, `/health` reports `data: absent` (`status` stays `ok` —
   the process is healthy), and every `/v1/*` endpoint returns 503 through
   one dependency. CI's docker job builds and smoke-tests exactly this
   image; the deploy workflow stages the real file (Phase 3 ship PR).
4. **The image stages data from a directory, not a hard COPY** (see
   `infra/Dockerfile` in the ship PR): the build succeeds with or without
   data, and which one you got is visible at `/health`, never implicit.
5. **Filters are domains** (see `flourish_api.frames`): the engine treats
   the frame it receives as the survey design, so the API subsets rows
   only by country (strata nest within countries — a proven property) and
   applies every other filter by nulling the outcome outside the domain,
   preserving R's `subset()`/domain semantics for SEs. The test suite
   pins the two constructions apart.

## Measured performance

*To be recorded by the Phase 3 ship PR (k6 profile):* per-endpoint p95
warm (LRU on/off), cold start with the baked file, image size. Interim
engine-side numbers from ADR-0006: full hot path (slice + Taylor mean by
country over 207,919 rows) ≈ 31 ms median on a laptop.

## Alternatives considered

- **Lifespan-lazy store construction** — makes `/health` depend on
  startup-event ordering and test clients on context-manager use;
  rejected for an eager open that costs milliseconds.
- **Loading `responses_long` into memory** — 33.3M rows against a 512 MiB
  budget; DuckDB's scan of the compressed file is already ~20 ms per
  slice; rejected.
- **Failing hard when data is absent** — would force CI to fake a data
  file or skip the image smoke test, hiding real boot regressions;
  rejected in favour of the honest degraded mode.
- **A sidecar bucket read at runtime** — adds GCS latency, egress and IAM
  to every cold start; the image bake keeps data+code atomic (ADR-0002);
  rejected.

## Consequences

- Dataset updates remain an image rebuild; `/v1/meta` and `/health` name
  the `data_version` so client caches key on it (ETags, ship PR).
- The staging-directory pattern means a mis-configured deploy ships a
  data-less API that *works* and *says so* — preferable to a crash loop,
  but the deploy smoke test must assert `data: ok` in production.
- Every new endpoint must route data access through the store and its
  `require_data` dependency, or CI's absent-data tests fail it.
