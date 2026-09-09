# ADR-0001: Stack and hosting

**Status:** Accepted · **Date:** 2026-09-09 · **Phase:** 0

## Context

Flourish Atlas (docs/PROPOSAL.md) is a solo, part-time portfolio project: an
interactive explorer for the Global Flourishing Study. It must demonstrate the
full stack, stay on free hosting tiers, survive months of intermittent
development, and be evaluable by a hiring manager in minutes. The data is a
fixed ~200k-row survey release updated at most annually.

## Decision

- **Front end:** React 18 + TypeScript + Vite; TanStack Router (typed URL
  state is a product requirement — the URL *is* the state) and TanStack Query;
  Observable Plot + D3-geo for charts and maps (Phase 4).
- **API:** Python 3.12, FastAPI, pydantic v2. The OpenAPI spec generates the
  TypeScript client, so the request/response types are written once.
- **Data layer:** DuckDB + Parquet built by a Python pipeline (ADR-0002).
- **Tooling:** `uv` workspace for Python (services/api, pipeline), `pnpm` for
  the web app, one Makefile as the entry point, pre-commit with ruff.
- **Hosting:** API on Google Cloud Run (scale-to-zero, 2M req/month free),
  web on Cloudflare Pages (free unlimited bandwidth), static-first: common
  views ship as precomputed JSON next to the web app so the API's cold start
  (~2–4 s) is off the critical path.
- **CI/CD:** GitHub Actions — lint/type/test on both sides per push, Docker
  build with a /healthz smoke test, deploy on `v*` tags.

## Alternatives considered

- **Next.js on Vercel:** SSR is unnecessary for a chart explorer whose data is
  static between releases; a Vite SPA + static JSON is simpler and free of
  serverless lock-in. Client-side rendering with precomputed aggregates keeps
  time-to-chart low.
- **Node/TypeScript API:** one language everywhere, but the statistics engine
  (survey-weighted estimators, Taylor-linearised SEs, verified against R
  `survey`) belongs in the Python data ecosystem, and a typed FastAPI service
  is itself portfolio evidence.
- **Fly.io / Render for the API:** comparable developer experience, but free
  tiers are less durable and the Cloud Run + Artifact Registry path
  demonstrates mainstream cloud tooling.

## Consequences

- Two toolchains (uv + pnpm) in one repo; the Makefile and CI keep the
  commands uniform.
- Cold starts are accepted and mitigated by the static tier rather than paid
  always-on instances.
- Free tiers cap traffic; acceptable for a portfolio project, revisit if the
  app gets sustained public use.
