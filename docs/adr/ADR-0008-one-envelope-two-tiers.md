# ADR-0008: One response envelope for two tiers; request-keyed caching

**Status:** Accepted · **Date:** 2026-09-10 · **Phase:** 3

## Context

The proposal's architecture is static-first: the common views load from
precomputed JSON on the CDN, only custom cuts hit the API (§4.4, §5.4).
That splits every estimate across two producers — the pipeline's
exporter and the API — which must never disagree in shape, or Phase 4
ends up with two client code paths. Separately, the data is immutable per
deployment, which makes ordinary HTTP caching unusually powerful if the
keys are chosen right.

## Decision

1. **One envelope, `{meta, rows}`**, defined by the API's pydantic models
   (`flourish_api.schemas.EstimateResponse`): `meta` names the data
   version, resolved weight-spec key and column, `se_method`, CI level,
   suppression thresholds, frame/valid counts and the echoed query;
   `rows` are the engine's common record verbatim. The static exporter
   emits the same shape **without importing the API** (the pipeline must
   not depend on FastAPI): shared *semantics* live in `flourish_stats`
   (`outcomes.py` joins `weights.py` as the cross-consumer registry), and
   shared *shape* is enforced by a CI contract test that runs the
   exporter on the API's synthetic database and validates every produced
   file with the API's own models, plus a value-equality check against a
   live API response. The static tier omits null sub-row keys (they are
   schema-optional); equality is at the model level, not the byte level.
2. **The static layout** is `data/static/v1/<outcome>/<wave>/<view>.json`
   (default stat by country, by country × each demographic, and
   distributions for 0–10 scales — 1,994 files, 68 s in `make data`),
   with an `index.json` carrying the file list and `data_version`.
   Deploys publish it under `gs://<bucket>/builds/<data_version>/static`
   and ship it into `apps/web/public/data/`, so the front end fetches
   `/data/v1/...` relative to its own origin. Raw size is 216 MB but the
   envelope compresses ~9× on the wire (a 236 KB worst-case file is
   25 KB gzipped); slimming rows is a Phase 4 option, not a need.
3. **ETags are computed from the request, not the response**: every /v1
   GET is a pure function of `(data_version, canonical query)`, so the
   ETag is a hash of exactly that — a matching `If-None-Match` returns
   304 *before any work happens*. `Cache-Control: public, max-age=86400,
   stale-while-revalidate=604800` lets Cloudflare hold responses at the
   edge for the life of a data version.
4. **A small in-process LRU** (`FA_CACHE_SIZE` entries, default 256) sits
   behind the ETag check, keyed the same way, storing response bytes +
   content type. Measured effect: warm p95 drops from ~90 ms to ~3 ms
   (ADR-0007).
5. **Rate limiting is per-instance**: an in-process token bucket per
   client IP (first `X-Forwarded-For` hop) on /v1, prod only,
   `FA_RATE_LIMIT_PER_MINUTE` (default 60), 429 + `Retry-After`. With
   Cloud Run capped at 2 instances the worst case is 2× the nominal
   limit, which is fine for an abuse brake — a shared store (Redis)
   would cost money and ops for no product need.

## Alternatives considered

- **Sharing the envelope by moving the pydantic models into
  flourish_stats** — makes pydantic a dependency of the engine, which
  ADR-0005 deliberately kept to numpy/polars/pyarrow; rejected in favour
  of CI-enforced shape identity.
- **The exporter importing flourish_api** — drags FastAPI, uvicorn and
  sentry into the pipeline's closure and inverts the layering; rejected.
- **Response-hash ETags** — require doing the work before revalidating;
  the request-keyed form gives 304s for free; rejected.
- **Redis/Memorystore for cache + rate limits** — paid, managed, and
  unnecessary at this scale; revisit only if instances grow past the
  point where per-instance limiting is meaningless.

## Consequences

- Phase 4 writes one fetch layer: try `/data/v1/<view>.json`, fall back
  to `/v1/...` — parsing is identical by construction, and the contract
  test fails CI the moment either side drifts.
- A new data version invalidates every cache naturally (the key contains
  it); no purge tooling is needed.
- The LRU holds at most `FA_CACHE_SIZE` small JSON bodies (~100 KB worst
  case each) — bounded well inside the 512 MiB instance.
