# Flourish Atlas

An interactive explorer for the [Global Flourishing Study](https://doi.org/10.17605/OSF.IO/3JTZ8):
survey-weighted estimates with design-based confidence intervals across 23
countries and territories — 207,919 respondents, Waves 1–2 (2023–2024) plus
the midyear survey.

**Status: Phase 0 (Foundations).** Monorepo, tooling, CI, and deploy skeleton.
The full plan lives in [docs/PROPOSAL.md](docs/PROPOSAL.md); decisions in
[docs/adr/](docs/adr/).

## Architecture

```
 raw CSVs (global with midyear, US state-weighted) + codebook PDF
        │
        ▼
 ┌─────────────────────┐   pandera checks,   ┌──────────────────────┐
 │ pipeline/ (Python)   │──── checksums ────▶│ data/ (Parquet +     │
 │ parse · clean · SFI  │                    │ DuckDB file + JSON   │
 │ · aggregates         │                    │ catalog + static     │
 └─────────────────────┘                    │ aggregates)          │
                                             └──────┬───────┬──────┘
                                                    │       │
                                   baked into image │       │ uploaded to CDN
                                                    ▼       ▼
                                  ┌──────────────────┐   ┌──────────────────────┐
                                  │ services/api      │   │ apps/web (React/TS)  │
                                  │ FastAPI + DuckDB  │◀──│ static-first: reads  │
                                  │ Cloud Run (free)  │   │ precomputed JSON;    │
                                  │ /aggregate etc.   │   │ calls API for custom │
                                  └──────────────────┘   │ cuts · Cloudflare    │
                                                         │ Pages (free)         │
                                                         └──────────────────────┘
```

## Repository layout

| Path | Contents |
|---|---|
| `apps/web/` | React 18 + TypeScript + Vite, TanStack Router |
| `services/api/` | FastAPI service (Phase 0: `/healthz`; Phase 3: `/v1/*`) |
| `pipeline/` | Data pipeline (Phase 1: ingest → clean → reshape → derive → validate → aggregate) |
| `data/` | Pipeline outputs; git-ignored except README and manifest |
| `docs/` | Proposal, ADRs; later METHODS.md, DATA.md, ARCHITECTURE.md |
| `infra/` | Dockerfile, deploy notes ([infra/README.md](infra/README.md)) |

## Development

Prerequisites: [uv](https://docs.astral.sh/uv/), [pnpm](https://pnpm.io/) ≥ 10, GNU make.

```sh
make setup       # install Python + web dependencies
make test        # pytest + vitest
make lint        # ruff + eslint
make typecheck   # pyright + tsc
make api         # FastAPI on :8000 (docs at /docs)
make web         # Vite dev server
make data        # Phase 1: build catalog/Parquet/DuckDB from data/raw/
```

Raw survey files are never committed; see [data/README.md](data/README.md).

## Deployment

Pushing a `v*` tag deploys the API to Cloud Run and the web app to Cloudflare
Pages via GitHub Actions, once the secrets in
[infra/README.md](infra/README.md) are configured. Deploy jobs skip cleanly
while secrets are absent.

## Phases

| Phase | Deliverable | Status |
|---|---|---|
| 0 Foundations | Monorepo, tooling, CI, ADRs | ✅ this commit |
| 1 Data pipeline | `make data`: catalog, Parquet, DuckDB | — |
| 2 Statistics engine | Weighted estimators, design-based CIs | — |
| 3 API | `/v1/*` on Cloud Run, static aggregates | — |
| 4 Front-end MVP | Atlas, Breakdowns, Codebook, Methods | — |
| 5 Panel, midyear & US | Change, Compare, What Matters, US States | — |
| 6 Correlates | Associations with controls | — |
| 7 Hardening | E2E, a11y, monitoring, docs | — |
| 8 Launch | v1.0, case study, demo | — |

---

**Data citation.** Global Flourishing Study, Waves 1–2 (2023–2024). Center for
Open Science / Gallup / Harvard Human Flourishing Program / Baylor Institute
for Studies of Religion. <https://doi.org/10.17605/OSF.IO/3JTZ8>. Study
profile: VanderWeele et al., *Nature Mental Health* (2025). This project
serves aggregates only and is not affiliated with the study.
