# infra/

- **`Dockerfile`** — the API image (FastAPI + uvicorn; from Phase 3 the DuckDB
  file is baked in alongside). Build from the repo root:
  `make docker-build`, run locally with `make docker-run`.
- **Cloud Run** runs the API: `--allow-unauthenticated --port=8080
  --memory=512Mi --cpu=1 --min-instances=0 --max-instances=2` (free tier,
  scale-to-zero).
  The liveness probe is `/health`. Never expose `/healthz` as a public path
  on Cloud Run: its front end intercepts that exact path on `*.run.app` and
  returns its own 404 before the request reaches the container.
- **Cloudflare Pages** serves `apps/web/dist` (direct upload via wrangler;
  build command `pnpm install --frozen-lockfile && pnpm -C apps/web build`,
  output `apps/web/dist`).

Deploys run from `.github/workflows/deploy.yml` on a `v*` tag
(`make deploy TAG=vX.Y.Z`) and skip cleanly until the secrets and variables
exist. **The one-time cloud setup — GCP Workload Identity Federation,
Cloudflare project and token, GitHub secrets/variables — lives in
[docs/SETUP.md](../docs/SETUP.md).**
