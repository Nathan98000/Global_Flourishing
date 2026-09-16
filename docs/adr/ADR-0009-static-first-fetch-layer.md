# ADR-0009: Static-first fetch layer

**Status:** Proposed (measurements land with the phase's final PR) · **Date:** 2026-09-16 · **Phase:** 4

## Context

The API runs on Cloud Run with min-instances 0: a cold start costs 2–4 s
(ADR-0007), unacceptable for a first paint. The pipeline already
precomputes the hot views — 1,994 envelope-identical JSON files
(ADR-0008) shipped to the app's own origin under `/data/` — but three
gaps stood between that and "the Atlas renders with the API down":
(a) the client had no rule for *which* queries are precomputed; (b) the
327 KB `index.json` is too big for the critical path; (c) countries,
labels, wording and thresholds lived only behind `/v1`, so a data-less
API still meant an empty app.

## Decision

**One fetcher, static first.** `fetchEstimates` computes the exporter's
path for a query and fetches `/data/v1/<outcome>/<wave>/<stat>_by-<dims>.json`;
anything the exporter did not precompute — filters, a variable-valued
breakdown, quantiles, `oriented` — goes straight to `/v1/aggregate`. Both
branches parse into the same generated `EstimateResponse` type, and the
caller learns which tier answered (surfaced in the UI as a badge).

**Paths are computed, not looked up.** The client mirrors the exporter's
naming rule using only server-declared facts (`default_stat` on every
variable summary, `meta.breakdowns`), plus one tier fact of its own: the
exporter emits distributions only for 0–10 scales, by country. A wrong
guess is harmless — it degrades to one API call.

**Misses are detected and remembered.** Cloudflare Pages' SPA fallback
answers *missing* files with `200 text/html`, so "miss" means
`!ok || content-type isn't JSON || unparseable`. Each miss is cached per
`(data_version, path)` for the session, so it costs one round trip, not
one per render.

**The catalog tier makes the first paint API-free.** The exporter also
emits `meta.json` (the `/v1/meta` payload minus `git_sha` — including
`breakdown_labels`, countries, the weight table and suppression
thresholds), `variables.json` and `v1/<name>/variable.json`, all
validated against the API's own pydantic models and compared for
equality with the live routes in CI. The app boots from `/data/meta.json`,
falls back to `/v1/meta`, and pings `/health` once — which also warms a
cold instance while the visitor reads a static chart.

**Cache keys are `(data_version, canonical query)`** with
`staleTime: Infinity` — the data is immutable per deployment — and no
cache-busting parameters, ever: the browser cache, the edge cache and
the API's request-keyed ETag (ADR-0008) all depend on stable URLs.

## Alternatives considered

- **Consult `index.json` at runtime** — 327 KB on the critical path to
  answer a question a pure function answers; rejected.
- **Service-worker cache of API responses** — helps the second visit,
  not the first paint, and adds an update-invalidation problem.
- **Hard-coding countries/labels in TypeScript** — a second copy of
  server truth that drifts; rejected outright (CLAUDE.md).
- **Proxying `/v1` through Pages functions** — moves the cold start,
  doesn't remove it; adds a runtime to operate.

## Consequences

Easier: the common views are fast everywhere (same-origin static JSON,
edge-cached), the app is honest in every degraded state (API absent,
data-less, or static-only), and the tier split is visible and testable —
Playwright blocks `/v1/**` and the Atlas must still render.

Harder: the client's path rule must track the exporter (drift degrades
to API calls — correct but slower; the contract tests keep the payloads
identical), and a stale static tier next to a newer API would disagree
about `data_version` (they deploy from the same build, and the footer
shows the version the app booted with).

Revisit when the static tier grows past what a bucket rsync ships
comfortably, or if Phase 5's change/state views need precomputation
(neither `/v1/change` nor `/v1/states` is in the tier today).
