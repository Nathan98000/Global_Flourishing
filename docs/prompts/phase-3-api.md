# Phase 3 — API

You are implementing **Phase 3** of Flourish Atlas in this repository. Phases 0–2 are complete and merged on `main`. Phase 3 delivers the typed FastAPI service over DuckDB with caching and rate limiting, the static-aggregate exporter (the pipeline's stubbed `aggregate` stage), the data path into the Cloud Run image, the generated TypeScript client, and a measured performance baseline. The statistics engine is **done and verified** — the API computes nothing itself; it validates requests, assembles frames, calls `flourish_stats`, and serves the records.

## 0. Before writing any code

Read, in this order: `CLAUDE.md`, `docs/PROPOSAL.md` §4.4, §5.2 (step 6), §5.4–5.6 and §7 (Phase 3), `docs/METHODS.md`, `docs/adr/ADR-0002-duckdb-over-postgres.md`, ADR-0003 (consequences: the DuckDB-size follow-up is yours), ADR-0005, ADR-0006, `stats/src/flourish_stats/__init__.py`, `weights.py`, `io.py`, the `RESULT_COLUMNS` docstrings in `_core.py`/`estimators.py`, `services/api/src/flourish_api/main.py` and `config.py`, `services/api/tests/test_health.py`, `stats/tests/test_io.py` (the synthetic-DuckDB fixture pattern you will reuse), `pipeline/src/flourish_pipeline/cli.py` (the `aggregate` stub you will implement), `.github/workflows/ci.yml` and `deploy.yml`, `docs/SETUP.md` (especially the "Deferred to Phase 3" note at the end), `infra/Dockerfile` (the Phase 3 comment), and the Phase-2 hand-off paragraph in PR #20's description (`gh pr view 20`).

The built data is present on this machine (`data/flourish.duckdb`, 143.8 MiB, plus `data/parquet/`; rebuilt by `make data`). Docker is available. **k6 is not installed** — `brew install k6` before the load-test work. Run `make setup` if `.venv` is missing, then confirm `make lint typecheck test` is green on `main` before you branch.

Phase discipline (CLAUDE.md): scope to Phase 3. `/v1/correlates` exists but returns **501 with body `{"detail": "Not implemented: Phase 6"}`** (Phase 6 adds correlates to engine-API-and-view together). No population-rescaled "all countries" estimates — `pooled_population_weights` already raises for Phase 5, and the API must reject a global-scope aggregate that neither groups nor filters by country (weights are mean-1 within country; pooling is Phase 5). No front-end views, no Playwright — Phase 4. The TypeScript **client generation** is Phase 3; its **use** is Phase 4.

## 1. Ground truth about what Phase 2 left you

These facts were verified against `main`. Use them; don't rediscover them, and don't contradict them without proving otherwise in a test.

**The engine (`flourish_stats`) is the only place statistics happen.** Public API (all take `pyarrow.Table | polars.DataFrame`, return `pyarrow.Table`; all have `policy: SuppressionPolicy` and most `ci_level`):

- `weighted_mean(frame, value, design, *, by=())`, `weighted_proportion(..., levels=None)`, `weighted_distribution(...)` (histogram with per-bin CIs; pass the catalog's `[min, max]` as `levels` so empty bins ship), `weighted_quantile(..., p=(0.5,))` (no CI, `ci_method="none"`).
- `paired_change(frame, earlier, later, design, *, by=())`, `paired_change_distribution(...)`, `three_point_panel(frame, y1, my, y2, design, *, scope=...)` (enforces the `midyear_type = 1` MY→Y2 restriction internally and rejects any weight but the panel spec's), `transition_matrix(frame, earlier, later, design, *, levels=None)` (stacked `transition_joint` + `transition_conditional` rows with `measure`, `from_level`, `to_level`).
- `weighted_correlation(..., method="pearson"|"spearman")` — exists, tested, **not served until Phase 6**.
- Every estimator emits the common record (`RESULT_COLUMNS`): `stat, estimate, se, ci_lo, ci_hi, ci_level, ci_method, n, sum_w, n_psu, n_strata, df, se_method, weight, suppressed, flagged` plus group keys. Suppressed rows keep `n`/`sum_w` and null the estimates. **`se_method` is how a Kish fallback stays visible — surface it in every response.**
- `Design(weight, strata, psu)`; for all served estimates use `strata="strata", psu="psu"` (Taylor). The engine raises on null weights/design columns — `validate_frame` first means those errors are 500-never, 422-always.
- **The weight table** (`flourish_stats.weights`) is the only home of weight/eligibility rules: `resolve(waves, scope)` → default spec, `get(key)` for `y1_y2_rect`, `eligibility_expr(spec)` → polars predicate, `validate_frame(frame, spec)`, `weight_table_json()` → the exact JSON `/v1/meta` serves. 23 rows across scopes `global`, `us_state`, `us_state_adj`. Never hard-code a weight column or an eligibility rule in the API.
- `flourish_stats.io.analysis_frame(con, variable, wave, *, oriented=False, columns=DEFAULT_COLUMNS)` returns one `(variable, wave)` slice joined to respondents (`id, value, nonresponse` + requested columns; `DEFAULT_COLUMNS` already covers every global spec's flags and weights). `derived_frame(con, column, wave, ...)` is the same for `sfi`, `sfi_*` domains, `phq2_score/positive`, `gad2_score/positive`. Column names are identifier-validated; queries are parameterised.

**Measured performance (this machine, M-series):** `analysis_frame` for a full Wave-1 item (207,919-row join) ≈ 21 ms; the whole hot path — load slice + Taylor mean by country — **31 ms median**; engine-only mean-by-country 38 ms; the 11-bin distribution by country ≈ 361 ms (ADR-0006). The p95 < 300 ms warm target is comfortable for means/proportions; distributions are the ones to watch. Budget FastAPI/serialisation on top and measure, don't assume.

**Data facts:** `flourish.duckdb` is 143.8 MiB (fresh build; ADR-0003's ~210 MB is stale — record the correction when you write ADR-0007). Tables: `responses_long` 33,295,632 rows (dominates the file), `derived` 468,274, `respondents` 207,919, `coverage` 4,752 (missingness per variable × wave × country — this powers `/v1/variables/{name}`), `value_labels` 3,298, `variables` 182 (150 substantive; `family ∈ {character, childhood, demographics, design, mental_health, midyear, physical_health, politics, religion, sfi, social_civic, wellbeing}`), `countries` 23. The `responses_oriented` view flips the 11 `lower_better` items. `data/manifest.json` has keys `data_version` (currently `gfs-w2my.0.1.0.23e22391`), `git_sha`, `generated_at_utc`, `inputs`, `outputs`, `pipeline_version`, `stage_seconds`.

**The API skeleton:** `create_app(settings)` factory; `Settings` reads `FA_*` env vars (`env`, `port`, `cors_origins`, `git_sha`); CORS is GET-only; `/health` returns `data_version: None` with a comment saying Phase 3 fills it. Cloud Run intercepts the literal path `/healthz` on `*.run.app` — the probe is `/health`, keep it that way.

**The deploy pipeline has no data.** `deploy.yml` builds the image from a plain checkout; CI's docker job does too. `docs/SETUP.md` ends with the deferral: a private GCS bucket for the raw CSVs plus a `workflow_dispatch` data-build job "to be added by the Phase 3 PR with the exact commands". Secrets/vars that exist (never invent new identifiers; name any new ones in SETUP.md and read them from `vars`/`secrets`): `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`, `GCP_PROJECT_ID`, `GCP_REGION`, `CLOUD_RUN_SERVICE`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CF_PAGES_PROJECT`, `API_BASE_URL`, `WEB_ORIGIN`. The preflight-skip pattern (deploys no-op with a notice until secrets exist) must survive everything you add.

**The web side:** `apps/web/src/config.ts` is the only reader of `import.meta.env`; `src/api/health.ts` is the hand-written fetch pattern the generated types will slot into. Vite copies `public/` into `dist/`.

**Correctness trap — filters are domains, not subsets.** The engine's variance math treats the frame it receives as *the design*: per-stratum PSU counts come from that frame. Filtering the frame to a **country** is safe (strata nest within countries — proven property). Filtering the frame to anything else (an age band, a gender) **changes the SEs** relative to R's domain semantics. So: country filters may subset the frame; every other filter must stay in the frame as a domain — implement non-country filters by nulling the outcome outside the filter (or estimate with `by=` and select the group), never by dropping rows. Write a test that proves the two disagree on a non-nested filter and agree on a country filter.

## 2. What to build

### 2.1 The data layer (`services/api/src/flourish_api/data.py` or similar)

A lifespan-managed, **read-only** DuckDB connection opened from `FA_DATA_PATH` (default `data/flourish.duckdb` so `make api` works locally), with PRAGMAs tuned for the 512 MiB / 1 CPU instance (`threads`, `memory_limit` — pick values by measuring, record them in ADR-0007). Load the small catalog tables (`variables`, `value_labels`, `countries`, `coverage`) into memory once at startup; slice `responses_long`/`derived` per request through `flourish_stats.io` only. Read `data/manifest.json` from beside the DuckDB file for `data_version`.

**Absent-data mode is a feature, not an error**: when `FA_DATA_PATH` doesn't exist, the app still boots, `/health` reports `"data": "absent", "data_version": null` (status stays `"ok"` — the process is healthy), and every `/v1/*` endpoint returns 503 with a problem-detail body. This is what keeps CI's docker job (no data, smoke-tests `/health`) green, and it must be tested.

### 2.2 The query model (pydantic v2)

Typed request models validated against the catalog at startup — reject nonsense with 422 and a message that names the fix:

- `outcome`: a substantive catalog variable or a derived score (`sfi`, the six `sfi_*` domains, `phq2_score`, `phq2_positive`, `gad2_score`, `gad2_positive`). Reject `restricted`, `design`-type and country-specific variables you can't yet render.
- `wave` ∈ the outcome's `waves_available` (derived scores: `sfi*`/screeners exist at Y1+Y2). A Y1-only variable requested at Y2 is the canonical 422.
- `stat` compatible with `scale_type`: `mean`/`quantile`/`distribution` for `scale_0_10`/`count`; `proportion`/`distribution` for `ordinal`/`nominal`/`binary`; `mean` additionally allowed for `ordinal` and `binary` (documented as such in the response meta). Pass the catalog's `[min, max]` as `levels` for proportions/distributions so empty bins ship.
- `by`: zero or more of `country_code` plus the respondent demographics (`age_band`, `gender`, `education_3`, `employment`, `marital_status`, `urban_rural`, `income_quintile`), **plus at most one variable-valued breakdown** (e.g. `ATTEND_SVCS`, `INCOME_FEELINGS`): implemented as one extra `analysis_frame` slice of that variable at the same wave, joined on `id` as a by-column. One generic mechanism, allow-listed to categorical variables available at the requested wave.
- `filters`: same fields; country filters subset the frame, all others are applied as domains (§1 trap). Filter values validated against value labels / catalog ranges.
- `scope` ∈ `global | us_state | us_state_adj`; weight always via `resolve(waves, scope)` — the only user-selectable alternative is `rect=true` on change requests mapping to `get("y1_y2_rect")`, echoed in the meta. Global scope requires `country_code` in `by` or a country filter (no pooling until Phase 5).
- Suppression thresholds are **not** query parameters (50/100 fixed, from the engine's defaults, echoed in `/v1/meta`).

### 2.3 Endpoints (all GET, all under `/v1`)

| Endpoint | Serves |
|---|---|
| `/v1/meta` | `data_version`, git sha, countries, waves, the verbatim `weight_table_json()` output, suppression thresholds, `ci_level`, breakdown allow-list, families |
| `/v1/variables?q=&family=` | catalog search over name/display name/wording substring + family filter (182 rows — no pagination) |
| `/v1/variables/{name}` | wording, labels (incl. country-specific), `scale_type`, `direction`, `min/max`, waves, and missingness by country × wave from `coverage` |
| `/v1/aggregate` | `outcome, stat, wave, by, filters, scope, oriented=false` → estimator records. `oriented=true` re-runs on `responses_oriented` (data-layer flip; engine is direction-agnostic); default responses are raw-coded and carry `direction` in the meta |
| `/v1/change` | `outcome, from, to, by, filters, scope, rect=false` → mean change + change distribution + (ordinal/nominal) transition matrix under the table-resolved weight; `from=Y1&to=MY&…` three-wave form calls `three_point_panel`. The `MY→Y2` standalone-midyear restriction comes from the weight table — no code here re-states it |
| `/v1/states` | thin variant of `/v1/aggregate` with `scope=us_state` (or `us_state_adj`), `by=state`; uses `respondents.state` |
| `/v1/export.csv` | same query model as `/v1/aggregate`, CSV rows (one per record, meta as `# ` comment header lines), `Content-Disposition` filename carrying outcome/wave/data-version |
| `/v1/correlates` | **501, `Not implemented: Phase 6`** |

Response envelope everywhere: `{"meta": {...}, "rows": [...]}` where `meta` carries `data_version`, the resolved weight-spec key + column, `se_method`, `ci_level`, suppression thresholds, the echoed query, unweighted total n; `rows` are the engine records verbatim (every number ships with weight, n, CI, `suppressed`/`flagged` — CLAUDE.md's rule, enforced by a test that walks the OpenAPI schema).

### 2.4 Caching, limits, observability

- **ETag** = strong hash of (`data_version`, canonical query string); honour `If-None-Match` with 304. `Cache-Control: public, max-age=86400, stale-while-revalidate=604800` on `/v1/*` reads (the data changes only with a release).
- **In-process LRU** on the canonical query → response body, size-bounded (`FA_CACHE_SIZE`, default ~256 entries), measured for memory sanity against the 512 MiB limit.
- **Per-IP rate limiting**: lightweight in-process token bucket middleware (`FA_RATE_LIMIT`, default 60/min, off in `dev`) keyed on `X-Forwarded-For` first hop (Cloud Run sets it); 429 with `Retry-After`. No Redis — free tier, max 2 instances, per-instance limiting is acceptable and documented.
- **Structured logs**: one JSON line per request (method, path, canonical query, status, latency ms, cache hit/miss) via stdlib logging; human-readable in `dev`.
- **Sentry**: `sentry-sdk` initialised only when `FA_SENTRY_DSN` is set; a one-line owner step (create project, `gh secret set` + deploy env var) appended to SETUP.md. Skip-clean like everything else.

### 2.5 The static exporter (the pipeline's `aggregate` stage)

Implement the existing `Not implemented: Phase 3` stub in `flourish_pipeline/cli.py`. `flourish-pipeline` gains the `flourish-stats` dependency (planned in ADR-0005). For every substantive outcome × available wave: per-country overall estimate (mean or proportions by `scale_type`) and the per-demographic breakdowns — the proposal's ~2,500 hot views — written as compact JSON under `data/static/` (git-ignored), **shape-identical to the API envelope** (one shared pydantic/JSON contract — the Phase 4 front end must not care which tier answered). Deterministic bytes (sorted keys, fixed float formatting) per ADR-0003's reproducibility contract; an index file lists paths + `data_version`. `make data` runs it (drop the skip notice); record counts and timing in the validation report's stage table.

### 2.6 Shipping the data (image + workflows + SETUP.md)

- **Dockerfile**: bake `data/flourish.duckdb` + `data/manifest.json` into the image via a staging directory (e.g. `COPY infra/data-stage/ /app/data/` where the directory contains a `.keep` in git) so the build **succeeds with or without data** — CI stays data-less, deploy stages real files. Decide and document (ADR-0007) what, if anything, to slim first: measure image size and cold start with the full 143.8 MiB file before optimising; candidate cuts are dropping `responses_long.nonresponse` from the served copy (missingness lives in `coverage`) and re-sorting/recompressing — but only act on measurements.
- **`data-build.yml`** (new, `workflow_dispatch`): fetch the three raw files from a private GCS bucket (new var, e.g. `GCS_DATA_BUCKET` — named in SETUP.md, checked in a preflight, skip-clean when absent), run `make data`, run the non-`raw`/`built`-marked test suite plus the `built` tests (data exists here!), upload `flourish.duckdb`, `manifest.json`, `validation_report.md` and `data/static/` to the bucket under the `data_version`. R parity is **not** run in CI (R + survey stays a local gate; note this in the workflow comment).
- **`deploy.yml`**: before the image build, download the current DuckDB + manifest from the bucket into the staging dir (skip-clean without the bucket var — image then ships data-less and `/health` says so); `deploy-web` downloads `data/static/` into `apps/web/public/data/` before `pnpm build` under the same condition.
- **SETUP.md**: exact copy-pasteable commands — bucket creation, uniform access, the deploy service account's `roles/storage.objectViewer` (+ `objectAdmin` for the data-build upload), the initial `gsutil cp` of the raw files, `gh variable set GCS_DATA_BUCKET`. Do not create any of it yourself.

### 2.7 The TypeScript client

Export the OpenAPI schema deterministically (`uv run python -m flourish_api.openapi > apps/web/openapi.json` or a make target), generate `apps/web/src/api/schema.d.ts` with `openapi-typescript` (new web devDependency, `pnpm gen:api` script), commit both, and add a CI step (in the python job, which has both uv and can `npx`) that regenerates and `git diff --exit-code`s so the client can never drift from the server. Refactor `src/api/health.ts` to use the generated types as proof of concept — no further front-end work.

### 2.8 Performance baseline

`infra/k6/` scripts for the hot-query profile (meta, a mean by country, a proportion by country × age band, a change query; realistic think time). Run locally against `make api` (document `brew install k6`): record **p95 warm** for each (< 300 ms exit criterion), LRU on and off, plus **cold start** (deploy-shaped measurement: container start → first `/health` and first `/v1/aggregate`, e.g. via `docker run` timing). Numbers go in ADR-0007 and the PR description. Tune DuckDB PRAGMAs from these measurements.

### 2.9 Tests (`services/api/tests/`) — coverage gate joins the CI

- **A synthetic mini-DuckDB fixture** (extend the `stats/tests/test_io.py` pattern to all seven tables + the oriented view, a handful of respondents across 2 countries with realistic flags/weights) so **every endpoint, including suppression, ETags, 422s, 503-no-data, CSV export and the envelope contract, is fully tested in CI without data**.
- **Golden-file contract tests**: canonical requests → committed JSON responses (deterministic by construction); OpenAPI schema snapshot; a test that every `/v1` estimate row exposes `weight`, `se_method`, `n`, `ci_lo/ci_hi`, `suppressed`, `flagged`.
- **`built`-marked tests** (reuse the marker via a `services/api/tests/conftest.py` mirroring `stats/conftest.py`): against the real DuckDB, `/v1/aggregate` for Wave-1 SFI by country reproduces `data/validation_report.md` (±0.005, ordering), `/v1/change` respects the MY→Y2 restriction (UK n equals the standalone count), `/v1/states` returns 50-ish states, and an `/v1/aggregate` vs direct-engine equality check.
- Validation unit tests for every 422 class; rate-limit and 304 behaviour; absent-data 503.
- CI: extend the coverage gate to `--include='services/api/src/*' --fail-under=90` alongside the stats gate.

### 2.10 Documentation

**ADR-0007** (API data tier: baked read-only DuckDB, staging-dir build trick, absent-data mode, PRAGMA choices, the slimming decision with measured image size + cold start, correction of ADR-0003's stale 210 MB). **ADR-0008** (one response contract for two tiers: envelope shared by API and static exporter, ETag/Cache-Control scheme, in-process LRU + per-instance rate limiting and why that's acceptable at max-2 instances). Register both in `docs/adr/README.md`. Update: README (status → Phase 3 complete, phases tick, a "Try the API" curl block), CLAUDE.md (repo-map row for the API's new shape, the envelope-is-shared rule, `FA_*` additions), `docs/METHODS.md` (one short section: how the API chooses weights — by pointing at the table — and what suppression looks like in responses), SETUP.md (§2.6's owner commands + Sentry).

## 3. How to work

- Branch from an up-to-date `main`; conventional commits (`feat(api): …`, `feat(pipeline): …`, `test(api): …`, `ci: …`, `build: …`, `docs(adr): …`); the Phase 3 issue is **#7**, milestone "Phase 3 — API" (`gh issue view 7`); reference it in every PR body and use `.github/PULL_REQUEST_TEMPLATE.md`.
- Land the phase as **three PRs**, each green on `make lint typecheck test` and `uv run pre-commit run --all-files` before it is opened, stacked if the later ones depend on the earlier (Phase 2 used stacked PRs retargeted on merge — same flow works):
  1. `claude/phase-3-data-layer` — data layer + absent-data mode, query model with catalog validation, `/v1/meta`, `/v1/variables`, `/v1/variables/{name}`, the synthetic fixture, the filters-are-domains test, ADR-0007 (draft: everything but the measured numbers).
  2. `claude/phase-3-endpoints` — `/v1/aggregate`, `/v1/change`, `/v1/states`, `/v1/export.csv`, the correlates 501, ETag/Cache-Control/LRU/rate-limit/logging/Sentry, golden + `built` tests, the api coverage gate.
  3. `claude/phase-3-ship` — the exporter stage, Dockerfile staging dir, `data-build.yml`, `deploy.yml` data steps, SETUP.md commands, the TS client + drift check, k6 + measured p95/cold-start, ADR-0008, ADR-0007 numbers, README/CLAUDE.md/METHODS updates.
- Never commit anything under `data/` beyond the three allowed files; `data/static/` and the staging dir contents stay ignored; the only committed generated artefacts are `apps/web/openapi.json` and `schema.d.ts`. Do not bypass hooks.
- Pyright strict stays clean on `services/api/src` (the single-diagnostic module-level disable pattern from the other packages is fine). Runtime deps stay lean: `flourish-stats[duckdb]` (the extra becomes load-bearing here), `sentry-sdk`; no pandas, no ORM.
- Anything only the repo owner can do (the bucket, Sentry, uploading raw files) goes into `docs/SETUP.md` as exact commands — don't block on it, and keep every workflow skip-clean without it.
- If a measured number misses a target (p95, memory), do not quietly relax the target: record the measurement, the cause, and the decision in ADR-0007.

## 4. Exit criteria (all must hold before the third PR is opened)

1. Contract tests pass in CI with **no data present**: every endpoint tested against the synthetic fixture, golden responses committed, OpenAPI snapshot stable, coverage of `services/api/src` ≥ 90% and gated.
2. `make api` + k6 locally: **p95 < 300 ms warm** on the hot-query profile with the real data (numbers recorded in ADR-0007, LRU on/off); cold start measured and documented.
3. The image builds **with and without data**; `/health` truthfully reports `data_version` (real when baked, `"absent"` otherwise); `/v1/*` 503s cleanly when data is absent; CI's docker smoke test still passes.
4. `deploy.yml` and `data-build.yml` are skip-clean without the bucket variable and documented in SETUP.md with exact owner commands; nothing invents a cloud identifier.
5. Every `/v1` estimate row carries `weight`, `se_method`, `n`, CI bounds and `suppressed`/`flagged`; weight choice flows only through `flourish_stats.weights`; invalid combinations (Y1-only variable at Y2, non-table weight, global scope without a country, bad filter values) 422 with actionable messages; `/v1/correlates` 501s with `Not implemented: Phase 6`.
6. The exporter fills the `aggregate` stage: deterministic `data/static/` JSON, envelope-identical to the API, indexed with `data_version`, produced by `make data`, uploaded by `data-build.yml`.
7. `apps/web/src/api/schema.d.ts` is generated, committed, drift-checked in CI, and `health.ts` uses it.
8. ADR-0007 and ADR-0008 exist; README/CLAUDE.md/METHODS/SETUP.md updated; non-country filters are provably domain-correct (the §1-trap test exists and passes).

Finish by posting, in the third PR's description, the measured performance table (per-endpoint p95 warm with and without LRU, cold start, image size with data) and a one-paragraph note on what Phase 4 should know: the envelope contract and where the static tier lives relative to `API_BASE_URL`, how to regenerate the client, and that `direction`/value labels for chart rendering come from `/v1/variables/{name}`, not from the aggregate responses.
