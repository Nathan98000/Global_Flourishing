# CLAUDE.md — Flourish Atlas

Interactive explorer for the Global Flourishing Study (GFS): survey-weighted
estimates with design-based CIs across 23 countries, Waves 1–2 (2023–2024)
plus a midyear survey. Read `docs/PROPOSAL.md` before non-trivial work — it is
the source of truth for scope, data semantics (weights, sentinel codes,
midyear administration modes), and the phase plan.

## Repo map

| Path | Contents |
|---|---|
| `apps/web/` | React 18 + TS + Vite, TanStack Router (code-based) + Query. `src/config.ts` is the only reader of `import.meta.env`. |
| `services/api/` | FastAPI (`flourish_api`), `create_app()` factory, `FA_*` settings in `config.py`. `/v1` endpoints over a read-only DuckDB (`data.py`; absent data → honest 503s), catalog-validated queries (`queries.py`), frame assembly with filters-as-domains (`frames.py`), ETag/LRU/rate-limit middleware (`ops.py`). Tests run against a synthetic DuckDB (`tests/synthetic_db.py`); `built` marker for real-data tests. |
| `stats/` | `flourish_stats` — survey-weighted estimators with design-based CIs (Taylor over strata/PSU, Kish fallback), the wave→weight→eligibility table, suppression. `stats/verify/` holds the R `survey` parity harness. |
| `pipeline/` | `flourish_pipeline` — codebook parser (`codebook/`), curated overrides (`overrides/*.yaml`), and the run pipeline: ingest → reshape → derive → validate → manifest. `notebooks/01_data_quirks.ipynb` documents the release's surprises. |
| `data/` | Pipeline outputs; git-ignored except `README.md` and `manifest.json`. |
| `docs/` | `PROPOSAL.md`, `SETUP.md` (hand-off checklist), `adr/`. |
| `infra/` | `Dockerfile` (API image, repo root as build context). |
| `scripts/` | `github-setup.sh` (idempotent milestones/labels/issues/project). |

## Commands

`make help` lists everything. The ones that matter: `make setup`, `make lint`,
`make typecheck`, `make test`, `make api` (:8080), `make web`, `make build`,
`make data` (needs `data/raw/`), `make parity` (R `survey` parity; needs the
built data + `Rscript`), `make deploy TAG=vX.Y.Z` (main only, clean tree;
pushes the tag that triggers `.github/workflows/deploy.yml`).

## Conventions

- **Conventional commits** (`feat(api): …`, `ci: …`, `docs(adr): …`).
- **Every significant decision gets an ADR** in `docs/adr/` (MADR format,
  see `docs/adr/template.md`).
- **Tests accompany code.** Python: pytest under each package's `tests/`;
  web: vitest next to `src/`. Pyright runs strict on `src/`.
- **Never commit data.** No CSV/Parquet/DuckDB/PDF, no sample rows, ever
  (data-use terms). Guards: `.gitignore`, pre-commit `forbid-data-files` +
  large-file hooks. Raw files live outside git; see `data/README.md`.
- **Sentinels are per-variable.** Never apply a global "98/99 → null"
  rule: `AGE` uses −998/998/999 (98 and 99 are real ages), country-specific
  variables use −9998/9998/9999, and some parenthesised codebook labels are
  answers (`INCOME` 9900, `SELFID2` 9997, childhood 97). The catalog's
  per-variable `nonresponse_codes` is the only source of truth.
- **Tests needing raw data carry the `raw` pytest marker** and are
  auto-skipped when `data/raw/` is absent (pipeline/tests/conftest.py), so
  CI never needs the data files. **Tests needing the built data carry the
  `built` marker** (stats/conftest.py), auto-skipped when
  `data/parquet/respondents.parquet` is absent — the R-parity test in
  `stats/verify/` included.
- **Weight and eligibility facts live only in `flourish_stats.weights`**
  (the wave→weight→eligibility table): which weight goes with which wave
  combination, the `w_r2` populated-for-everyone quirk, and the
  `midyear_type = 1` restriction on MY→Y2 comparisons. Engine, API and
  docs read from it; never restate those rules elsewhere. Likewise the
  servable-outcome allow-list and derived-score registry live only in
  `flourish_stats.outcomes` (API + static exporter both read it).
- **The API and the static exporter share one response envelope**
  (ADR-0008): `flourish_api.schemas.EstimateResponse` is the contract,
  and `services/api/tests/test_static_contract.py` validates the
  exporter's files against it in CI. Change the envelope in both places
  or that test fails.
- **API frames: filters are domains.** Only country filters may subset
  rows (strata nest within countries); every other filter must null the
  outcome outside the domain (`flourish_api.frames`) or SEs silently
  diverge from R's domain semantics.
- **The generated client is committed and drift-checked**: after any
  API schema change run `uv run python -m flourish_api.openapi >
  apps/web/openapi.json && pnpm -C apps/web gen:api` and commit both.
- **Never invent cloud identifiers.** Project IDs, regions, URLs come from
  GitHub secrets/variables named in `docs/SETUP.md`; deploy jobs skip
  cleanly when they are absent.
- **Free tiers only.** Cloud Run: 512 MiB, 1 CPU, min 0, max 2 instances.
- **Health endpoint is `/health`, never `/healthz`.** Cloud Run's front end
  intercepts the exact path `/healthz` on `*.run.app` and returns its own 404
  before the container sees the request.
- Numbers shown to users always carry weight, unweighted n, and CI;
  associations, not causes (proposal §4.4).

## Phases (docs/PROPOSAL.md §7)

0 Foundations ✅ · 1 Data pipeline ✅ · 2 Statistics engine ✅ · 3 API ✅ ·
4 Front-end MVP · 5 Panel/midyear/US views · 6 Correlates · 7 Hardening ·
8 Launch. Scope work to the current phase; later-phase work gets a loud
"Not implemented: Phase N" stub, not a partial implementation.

## Hand-off

Anything only the repo owner can do (cloud accounts, secrets, GitHub scopes)
goes into `docs/SETUP.md` as exact copy-pasteable commands — don't block on it.
