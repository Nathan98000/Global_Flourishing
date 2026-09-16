# Phase 4 — Front-end MVP

You are implementing **Phase 4** of Flourish Atlas in this repository. Phases 0–3 are complete and merged on `main`. Phase 4 turns the `/v1` API and the 1,994-file static aggregate tier into the public product: **Atlas**, **Breakdowns**, **Codebook** and **Methods**, with typed URL state, CSV/PNG export, dark mode, accessible charts, six Playwright journeys and Lighthouse budgets in CI. The statistics, the weights and the response envelope are **done** — the front end computes no statistics, chooses no weights, and never re-derives a label it can ask for.

## 0. Before writing any code

Read, in this order: `CLAUDE.md`, `docs/PROPOSAL.md` §4 (all of it — audiences, user stories, the views table, the design principles), §5.5, §7 (Phase 4) and §8, `docs/METHODS.md` (it is the source text for the Methods view), `docs/adr/ADR-0008-one-envelope-two-tiers.md` (the contract you consume) and `ADR-0007-api-data-tier.md` (latency, absent-data mode), `services/api/src/flourish_api/schemas.py` (the envelope, field by field), `queries.py` (every 422 you can provoke and its message), `routes/aggregate.py`, `routes/variables.py`, `routes/meta.py`, `pipeline/src/flourish_pipeline/aggregate.py` (what the static tier contains and how its paths are named), `services/api/tests/test_static_contract.py` and `tests/synthetic_db.py` (your CI fixture source), `apps/web/src/` in full (it is ~200 lines), `apps/web/openapi.json`, `.github/workflows/ci.yml` and `deploy.yml`, and `docs/prompts/phase-3-api.md` §1 (the hand-off facts).

The built data is present on this machine (`data/flourish.duckdb`, `data/parquet/`, and `data/static/` with 1,994 files / 220 MB raw). `make setup` if `.venv` or `node_modules` is missing; confirm `make lint typecheck test` is green on `main` before you branch. `git status` is not clean on this machine — `data/manifest.json` and `data/validation_report.md` are modified and `docs/prompts/phase-3-api.md` is untracked; those are the owner's, leave them out of your commits.

Phase discipline (CLAUDE.md): scope to Phase 4. **No Change, Compare, What Matters or US States views** — `/v1/change` and `/v1/states` exist and stay unused until Phase 5. **No Correlates** (the endpoint 501s; Phase 6). No pooled "all countries" number — global-scope estimates must group or filter by country, and the API enforces it. Later-phase nav entries are omitted, not stubbed as dead links.

**Owner decisions, already made — implement them, don't re-open them.** (a) The exporter may emit the small catalog/meta files described in §2.1 so the app boots without the API; this is approved. (b) CI fixtures are generated synthetically at test time (§2.11); no file derived from the real release is committed. (c) For the map, **use a more detailed topology if one actually carries a Hong Kong feature** — check `world-atlas` countries-50m (and 10m if needed) for an `HKG`/"Hong Kong S.A.R." feature before settling; if none does, pick the best alternative (labelled centroid marker for territories, or an inset), implement it and record the reasoning in ADR-0010. Either way no country silently disappears from a map of 23, and the extra topology bytes stay in the lazily-loaded map chunk. (d) Start from the working tree as it stands; the owner's stray files stay untouched.

## 1. Ground truth about what Phase 3 left you

Verified against `main` and the built data. Use these facts; don't rediscover them.

**The API** (`make api`, :8080; `/docs` for the live schema). All GET, all `/v1`, CORS is GET-only, `VITE_API_BASE_URL` points at it:

| Endpoint | Query parameters |
|---|---|
| `/v1/meta` | — |
| `/v1/variables` | `q`, `family` |
| `/v1/variables/{name}` | — |
| `/v1/aggregate` | `outcome` (req), `wave` (req), `stat=mean`, repeated `by`, repeated `filter`, `scope=global`, `oriented=false`, repeated `p` |
| `/v1/export.csv` | identical to `/v1/aggregate` |
| `/v1/change`, `/v1/states` | Phase 5 |
| `/v1/correlates` | 501 `Not implemented: Phase 6` |

- `by` is repeated (`?by=country_code&by=age_band`), max 3 dimensions: any of `country_code, age_band, gender, education_3, employment, marital_status, urban_rural, income_quintile`, plus **at most one** categorical survey variable (e.g. `by=ATTEND_SVCS`).
- `filter` is repeated and shaped `column:value` (`?filter=gender:1&filter=country_code:22`). Country filters subset; every other filter is applied as a **domain** server-side. Multiple values of the same column are OR'd.
- Errors: **422 with `detail` as an array of strings**, each phrased as the fix ("HAPPY is not asked at MY; it is available at Y1, Y2"). Surface them verbatim — they are better copy than anything you would write. 503 when the deployment has no data build; 501 for correlates; 429 + `Retry-After` at 60 req/min per IP in prod; 304 against `If-None-Match`.
- Every response is `{"meta": {...}, "rows": [...]}`. `meta`: `data_version, outcome, scale_type, direction, stat, waves, scope, oriented, weight_key, weight, se_method, ci_level, suppression{threshold: 50, flag_below: 100}, n_frame, n_valid, by, filters`. Each row: `group` (a dict of the by-columns), optional `level`/`p`/`leg`/`from_level`/`to_level`/`measure`, then `stat, estimate, se, ci_lo, ci_hi, ci_level, ci_method, n, sum_w, n_psu, n_strata, df, se_method, weight, suppressed, flagged`. **Suppressed rows keep `n`/`sum_w` and null the estimates — they are data to render, never rows to drop.**
- Measured: warm p95 ≈ 90 ms uncached, ≈ 3 ms from the LRU; **cold start 2–4 s** (Cloud Run scales to zero). The static tier is what hides that.

**The static tier** (`data/static/`, rsynced into `apps/web/public/data/` by `deploy-web`, so the app fetches `/data/…` from its own origin):

- `v1/<outcome>/<wave>/<stat>_by-<dim>[-<dim>].json`, e.g. `v1/sfi/Y1/mean_by-country_code.json`, `v1/HAPPY/Y1/distribution_by-country_code.json`, `v1/ATTEND_SVCS/Y2/proportion_by-country_code-age_band.json`. Dimension order is exporter order: `country_code` first, then the demographic.
- Contents: **153 outcomes** (142 catalog items + the 11 derived scores), per available wave — 1,155 Y1 files, 709 Y2, 130 MY (15 outcomes exist at MY). Per outcome × wave: the default stat by country (mean for `scale_0_10`/`count`, proportions for categorical), the same stat by country × each of the seven demographics, and a distribution by country for 0–10 scales.
- **Not** in the static tier: filters, variable-valued breakdowns, quantiles, `oriented=true`, change, states. Those are API-only — that split is the whole design.
- `index.json` is **327 KB** (every file listed with `rows`/`by`/`stat`). Do not put it on the critical path; compute paths and treat a 404 as "ask the API".
- Files are envelope-identical to API responses by CI contract (ADR-0008); one parse path, one type.

**The catalog:** 182 variables (150 substantive), families `character, childhood, demographics, design, mental_health, midyear, physical_health, politics, religion, sfi, social_civic, wellbeing` plus `derived`; `direction ∈ {higher_better (35), lower_better (11), none (136)}`; 23 countries with codes and **ISO3** (`ARG…CHN`, US = 22, Hong Kong = 24 `HKG`, China = 25). Value labels, question wording and per-country × wave missingness come from `/v1/variables/{name}` — never from an aggregate response.

**The web scaffold** (`apps/web`, ~200 lines): Vite 6 + React 18 + TS strict (`noUncheckedIndexedAccess` on), TanStack Router (code-based route tree in `src/router.tsx`, `createAppRouter(history?)` so tests can drive it) and TanStack Query, Vitest + Testing Library + jsdom, ESLint with `jsx-a11y` recommended, Prettier, `src/config.ts` as the **only** reader of `import.meta.env`, `src/api/health.ts` as the pattern for typed fetches, `src/api/schema.d.ts` generated from `openapi.json` (`pnpm gen:api`) and drift-checked in CI. Plain `styles.css`, no design system yet. **`apps/web/public/` does not exist yet** — you create it; `apps/web/public/data/` is already git-ignored.

**CI/CD:** `ci.yml` jobs are python / web / docker / pre-commit; the web job runs lint, typecheck, vitest, the client drift check and `pnpm build`, and uploads `dist`. `deploy.yml` stages `builds/<data_version>/static` into `apps/web/public/data` before building, sets `VITE_API_BASE_URL` from `vars.API_BASE_URL`, and publishes to Cloudflare Pages with `--branch=main`. Everything skips clean when the secrets are absent. Cloudflare Pages serves `dist` as static files — a client-routed app needs `public/_redirects` with `/* /index.html 200` or every deep link 404s; that is yours to add.

**The deployment already exists, and it is stale.** `https://flourish-atlas.pages.dev` is live and its API status line reads `API: ok · v0.1.0 · sha ddcbd39` — the last release tag (`v0.1.2`, 10 Sep) predates the Phase 3 merge, so the deployed API serves only `/health` and the deployed front end is still the Phase 0 scaffold. Whether the private data bucket (`GCS_DATA_BUCKET`, SETUP.md §7) and its data build exist is an owner step you cannot verify from the repo: treat both "API with data", "API without data" (503s on `/v1`) and "no static tier shipped" as states the app must handle honestly — that is exit criterion 5, and it is the reason the static catalog/meta tier in §2.1 matters. Phase 4 ships by `make deploy TAG=v0.2.0` after the last PR merges; if the deploy's `has-data` notice says the bucket is missing, say so in the PR rather than working around it.

**The local loop:** `make api` (:8080, data present) and `make web`. For static-first work, put the built tier where the app expects it: `mkdir -p apps/web/public && ln -s ../../../data/static apps/web/public/data` (verify Vite follows the symlink; `rsync -a data/static/ apps/web/public/data/` if not). Both paths stay git-ignored.

## 2. What to build

### 2.1 The fetch layer — static-first, one parse path (and the one server change you are allowed)

`src/api/estimates.ts`: a single `fetchEstimates(query)` that (a) computes the static path when the query is one the exporter precomputed, fetches `/data/v1/…`, and (b) falls back to `${API_BASE_URL}/v1/aggregate?…` on 404 or on any query the static tier can't answer (filters, variable-valued `by`, quantiles, `oriented`). Cache the negative path result per `(path, data_version)` so a miss costs one round trip, not one per render. Both branches parse into the **same generated type** (`components['schemas']['EstimateResponse']`) — no hand-written response interfaces anywhere in the app, and no `any` at the boundary. `src/config.ts` gains `STATIC_BASE_URL` (default `/data`) and stays the only env reader.

TanStack Query keys are `['estimates', dataVersion, canonicalQueryString]` with `staleTime: Infinity` (the data is immutable per deployment). **Never append cache-busting parameters** — they defeat both the edge cache and the API's request-keyed ETag. Debounce or client-filter anything typed: the Codebook fetches `/v1/variables` once (182 rows) and filters in memory rather than firing a request per keystroke into a 60/min limit.

**Static-first has to mean the first paint needs no API.** Today it doesn't: countries, the weight table, suppression thresholds and the variable catalog only exist behind `/v1`, so a cold or data-less API would leave the Atlas empty. Fix it at the source, not with a hard-coded copy in TypeScript — this is the only pipeline/API change Phase 4 makes:

1. Extend the exporter (`flourish_pipeline.aggregate`) to also emit `meta.json` (the `/v1/meta` payload minus `git_sha`), `variables.json` (the `/v1/variables` list payload) and `v1/<name>/variable.json` (the `/v1/variables/{name}` detail: wording, value labels, missingness). Deterministic bytes like the rest; listed in `index.json`'s counts or a sibling key; validated by the existing contract test with the API's own models.
2. Add `breakdown_labels` to `MetaResponse` — for each breakdown column, its display name and the ordered `(value, label)` pairs (from the catalog's value labels for `gender`, `education_3`, `employment`, `marital_status`, `urban_rural`; the literal bands for `age_band`; Q1–Q5 for `income_quintile`). The front end must not own a second copy of code→label maps. Regenerate `apps/web/openapi.json` and `schema.d.ts` (`make gen-client`) and commit both.
3. The app boots from `/data/meta.json`, falls back to `/v1/meta`, and pings `/health` once on mount — which also warms a cold Cloud Run instance while the visitor reads a static chart. When both fail, the shell still renders with an honest banner.

### 2.2 URL state — the URL *is* the state

TanStack Router typed search params, validated on parse, with **the API's own parameter names** (`outcome`, `wave`, `stat`, `by`, `filter`, `scope`, `oriented`) so a URL reads like the query it makes and the fetch layer is a pass-through; view-only params (`view=bars|map`, `sort`, selected countries) are additional and clearly separate. Defaults are omitted from the URL. Invalid search params degrade to defaults with a visible notice rather than crashing a route. Theme lives in `localStorage`, not the URL. Back, forward, refresh and paste-into-another-browser all reproduce the view exactly — this is a Playwright journey, not a hope.

### 2.3 Design tokens and layout (CSS Modules)

`src/styles/tokens.css`: custom properties for the **six fixed SFI domain hues** (`sfi_happiness, sfi_health, sfi_meaning, sfi_character, sfi_relationships, sfi_financial` — the same hue everywhere, every view), semantic colors (suppressed, flagged, CI band, emphasis, surface/ink scales), spacing, radii and type scale. Dark mode via `color-scheme` + `prefers-color-scheme`, overridable by an explicit toggle persisted in `localStorage`; **both themes must pass WCAG AA contrast**, including chart marks against the plot background. Per-component `*.module.css`; no Tailwind, no CSS-in-JS, no new styling dependency. Meaning is never carried by hue alone (suppression = hatch + text, not just grey).

Shared primitives: `AppShell` (header, nav, footer with the live `data_version` + DOI citation), `Skeleton` (the proposal's risk table is explicit: skeletons, never spinners), `EmptyState`, `ErrorState` (renders the 422 string list, the 503 "this deployment has no data build", the 429 "slow down" and network failure distinctly), `Suppressed` marker, `Stat` (estimate ± CI with the n and weight in a consistent format), `CoverageBanner`.

### 2.4 The chart library (Observable Plot + TopoJSON)

Dependencies: `@observablehq/plot`, `topojson-client`, and a Natural Earth world TopoJSON (`world-atlas` countries-110m, joined to the catalog's ISO3). Components under `src/charts/`, each a thin typed wrapper that takes `EstimateResponse` rows and never fetches:

- `RankedBar` — ranked country bars with CI whiskers, n in the tooltip, suppression rendered in place.
- `DotPlot` — dots with CI for compact comparisons and breakdown levels.
- `SmallMultiples` — one panel per country for outcome × demographic, shared scales, sortable.
- `Histogram` — the `distribution` stat with per-bin CIs (empty bins ship because the API passes the catalog's `[min, max]`).
- `Choropleth` — Plot's geo mark with an equal-earth projection, sequential scale anchored to the item's `[min, max]`, diverging only where that is honest. **Hong Kong (HKG) is not a feature in Natural Earth 110m.** Per the owner decision in §0: verify whether countries-50m (or 10m) carries an `HKG` feature and use the more detailed topology if it does, weighing the extra bytes inside the lazy map chunk; otherwise implement the best alternative (a labelled centroid marker for territories, or an inset) and record it in ADR-0010. Never silently drop a country from a map of 23.

Chart rules, enforced in tests: every chart renders `estimate`, its CI, the unweighted `n` and the weight name; `direction` from the response meta labels the axis ("higher is better" / "lower is better" / neither) — the default view stays raw-coded and **never silently flips a scale**; `oriented=true` is an explicit, labelled user choice (and is rejected by the API for derived outcomes). The map and its TopoJSON asset are a **lazy chunk**; so is the Methods renderer.

### 2.5 Atlas

Pick an outcome (searchable, grouped by family, with the derived scores first), pick a wave (Y1 / MY / Y2 — MY offers only the 15 midyear outcomes), see ranked bars or the map, CI and n on every value, question wording one click away in a side panel from `/v1/variables/{name}`, weight and suppression rule stated under the chart. Y2 and MY views carry the `CoverageBanner`: per-country response coverage from the variable's missingness (proposal §3.4 — retention runs from 90% in China to 23% in Hong Kong, and no Wave-2 or midyear number is honest without it). Selecting countries filters the chart and the URL.

### 2.6 Breakdowns

Outcome × one demographic, small multiples by country, sortable (by estimate, by country name, by gap between levels), level labels from `breakdown_labels`, suppressed cells shown as suppressed with their n, flagged cells (50–99) marked distinctly. A second breakdown (`by` up to 3, one of which may be a categorical survey variable such as `ATTEND_SVCS`) is API-only — that is expected and fine; show the tier that answered in a subtle "served from precomputed / live query" marker, because it is a thing the portfolio audience will look for.

### 2.7 Codebook

Search across name, display name and wording over the single `/v1/variables` fetch; filter by family, wave and scale type; a detail view with the exact wording, the full value-label table (including country-specific labels), scale direction, min/max, waves available, and missingness by country × wave; a **"chart this"** link that lands on the Atlas with the right `outcome`/`wave`/`stat` already in the URL. Non-servable variables (country-specific, design) appear in the codebook and say plainly why they cannot be charted yet.

### 2.8 Methods

`docs/METHODS.md` is the single source — render it (Vite `?raw` import + a lazily-loaded `marked`), don't paraphrase it into JSX, and add a Vitest assertion that the rendered page contains its headings. Above the rendered text, a short plain-language summary and the **"associations, not causes"** note, the live suppression thresholds and CI level from meta (not hard-coded), and links to the study papers and the DOI. The footer shows `data_version` on every page.

### 2.9 Export

CSV: link to `/v1/export.csv` with the current parameters (correct filename and `#` meta header lines come from the server). When the view was served statically **and** the API is unreachable, fall back to a client-side CSV with the identical column order and the same `#` meta lines — with a test asserting both forms produce the same header set. PNG: serialize the Plot SVG with computed token colors inlined, draw to a 2× canvas, `toBlob`, and stamp the chart title, the data version and the DOI citation into the image, since the image is what gets shared.

### 2.10 Accessibility and performance

Every chart is a `figure` with a `figcaption`, `role="img"` and an aria-label that states what it shows and its extremes, plus a `<details>` data table with the same numbers — that table is the screen-reader path and the copy-paste path; per-mark keyboard focus is not required. Skip link, visible focus, `prefers-reduced-motion`, semantic headings in order, labelled controls, live regions for async updates. Budgets: **Lighthouse performance ≥ 90 and accessibility ≥ 95** on Atlas and Codebook, and **≤ 250 kB gzipped for the initial route** (Plot is in it; the map, its topology and `marked` are not) — route-level code splitting via lazy routes.

### 2.11 Tests

- **Vitest**: the fetch layer (static hit, static 404 → API fallback, API 503/429/422 rendering, negative-path caching), URL-state round-trip (parse → query → serialize → parse), suppression and flagging rendering, `breakdown_labels` mapping, number/CI formatting, CSV parity helper, PNG serializer, theme persistence, and one render test per chart against fixtures.
- **Fixtures are synthetic, never copied from the real build** (CLAUDE.md: no sample rows, ever). Generate them by running the exporter over the API's synthetic DuckDB — the machinery exists (`services/api/tests/synthetic_db.py`, `flourish_pipeline.aggregate.export_static`, `test_static_contract.py`). Wrap it in a `make web-fixtures` target that writes a small static tier plus `meta.json`/`variables.json` into `apps/web/public/data`, and use it for Vitest fixtures, Playwright and Lighthouse so **CI needs no real data**.
- **Playwright** (`@playwright/test`, its own CI job, browsers cached), six journeys: (1) Atlas → change outcome and wave → share the URL → reload reproduces the view; (2) Codebook search → chart this → wording panel shows the question; (3) a suppressed cell renders as suppressed with its n, not as a gap; (4) CSV export downloads with the meta header lines; (5) dark mode toggles and survives a reload; (6) **API blocked at the network level → Atlas still renders from the static tier** and says so.
- **Lighthouse CI** against the built preview with the fixture tier, asserting the two scores and the bundle budget; failures fail the job.

### 2.12 CI, hosting, docs

Add the Playwright and Lighthouse steps/jobs to `ci.yml` (fixtures first, artifacts on failure: traces, HTML report). Add `public/_redirects`, a favicon and `og:`/`twitter:` meta with a static preview image. Keep `deploy.yml` working unchanged — verify by reading it that the static tier lands where §2.1 expects. **ADR-0009**: static-first fetch layer (path computation vs the 327 KB index, fallback rules, the static catalog/meta tier, negative caching, cache keys). **ADR-0010**: front-end rendering stack (Observable Plot over Vega-Lite/Recharts/D3-by-hand, CSS Modules + tokens over Tailwind, the map topology and the Hong Kong decision, measured bundle sizes). Register both in `docs/adr/README.md`. Update README (status → Phase 4 complete, phase ticks, screenshot, the live URL once it exists), `CLAUDE.md` (repo-map row for `apps/web`'s new shape, the "labels come from meta, statistics come from the API" rule, `make web-fixtures`), and `docs/SETUP.md` if any owner step changes.

## 3. How to work

- Branch from an up-to-date `main`; conventional commits (`feat(web): …`, `feat(pipeline): …`, `test(web): …`, `ci: …`, `docs(adr): …`); the Phase 4 issue is in milestone **"Phase 4 — Front-end MVP"** (likely **#8** — confirm with `gh issue list --milestone "Phase 4 — Front-end MVP"`); reference it in every PR body and use `.github/PULL_REQUEST_TEMPLATE.md`.
- Land the phase as **three PRs**, each green on `make lint typecheck test` and `uv run pre-commit run --all-files` before it is opened, stacked and retargeted on merge as Phases 2–3 did:
  1. `claude/phase-4-shell` — tokens, CSS Modules, dark mode, app shell, typed URL state, the static-first fetch layer, the exporter's meta/catalog tier + `breakdown_labels` + regenerated client, skeleton/empty/error/suppression primitives, `_redirects`, `make web-fixtures`, ADR-0009 draft.
  2. `claude/phase-4-atlas` — the chart library, Atlas (bars, map, wave toggle, coverage, wording panel), Breakdowns, CSV/PNG export, component tests.
  3. `claude/phase-4-ship` — Codebook, Methods, Playwright job, Lighthouse CI + bundle budget, the a11y pass, ADR-0009/0010 with measured numbers, README/CLAUDE.md updates, deploy verification.
- Do not commit anything under `data/`, `apps/web/public/data/`, or any fixture derived from the real release. The committed generated artefacts remain exactly `apps/web/openapi.json` and `apps/web/src/api/schema.d.ts`; regenerate both in the same commit as any API change.
- TS strict and ESLint (with `jsx-a11y`) stay clean; no `any` at the API boundary, no `@ts-expect-error` without a one-line reason. New runtime dependencies are limited to `@observablehq/plot`, `topojson-client`, the world topology and `marked`; anything else needs a line in ADR-0010 justifying its bytes.
- If a measured number misses a target (Lighthouse, bundle, a journey that is flaky), record the measurement and the decision in the ADR — do not quietly relax the target or retry-loop the test.

## 4. Exit criteria (all must hold before the third PR is opened)

1. Atlas, Breakdowns, Codebook and Methods are live at `https://flourish-atlas.pages.dev` (a release tag is cut after the last PR merges; flag it in the PR if the deploy reports no data build), and a first-time visitor can answer **"which country has the highest mental health rating among 18–24-year-olds?"** without help (proposal §7; try it on someone).
2. Every number on screen carries its weight, unweighted n and CI; suppressed cells are rendered as suppressed with their n and never silently dropped; Y2 and MY views show coverage.
3. The URL is the state: every view is reproducible from its URL after a reload and in a second browser; six Playwright journeys green in CI, including the API-blocked static-first journey.
4. Lighthouse performance ≥ 90 and accessibility ≥ 95 on Atlas and Codebook in CI, initial route ≤ 250 kB gzipped, both themes AA-contrast clean.
5. The app boots and renders the Atlas with the API unreachable or data-less, and degrades honestly (banner, not a spinner) for the views that need it; the 422 string list, 429 and 503 each render distinctly.
6. Labels, wording, value labels, directions, countries, suppression thresholds and CI level all come from the server (meta / `/v1/variables`), with no second copy in TypeScript; the static tier and the API remain envelope-identical and the contract test still passes.
7. CI needs no real data: `make web-fixtures` builds the synthetic tier that Vitest, Playwright and Lighthouse run against; client drift check still green; nothing under `data/` committed.
8. ADR-0009 and ADR-0010 exist with measured numbers; README, CLAUDE.md and the phase table updated; `make deploy TAG=…` still ships both apps (or skips clean without the secrets).

Finish by posting, in the third PR's description, the measured table (Lighthouse scores per route, initial and total bundle sizes gzipped, static vs API response times for the Atlas view, Playwright wall-clock in CI) and a one-paragraph note on what Phase 5 should know: which primitives the Change / Compare / What Matters / US States views can reuse as-is, where the fetch layer needs a new branch for `/v1/change` and `/v1/states` (neither is in the static tier), what the wave toggle already assumes about `MIDYEAR_TYPE_MY`, and any place where a Phase 5 view will need a static export that does not exist yet.
