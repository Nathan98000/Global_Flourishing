# infra/

Deployment targets (proposal §5.6): **Cloud Run** for the API, **Cloudflare
Pages** for the web app. Both on free tiers. Deploys run from
`.github/workflows/deploy.yml` on a `v*` tag and skip gracefully until the
repository secrets below exist.

## One-time setup

### Google Cloud Run (API)

1. Create a GCP project; enable Cloud Run and Artifact Registry.
2. Create an Artifact Registry Docker repo, e.g. `flourish` in `us-central1`.
3. Create a service account with `roles/run.admin`, `roles/artifactregistry.writer`,
   and `roles/iam.serviceAccountUser`; download a JSON key.
4. Add repository secrets:
   - `GCP_PROJECT_ID` — project id
   - `GCP_REGION` — e.g. `us-central1`
   - `GCP_SA_KEY` — the JSON key (workload identity federation is the
     better long-term swap; the workflow uses `google-github-actions/auth`
     either way)

### Cloudflare Pages (web)

1. Create a Pages project named `flourish-atlas` (direct upload).
2. Create an API token with the *Cloudflare Pages — Edit* permission.
3. Add repository secrets:
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_API_TOKEN`

## Releasing

```sh
git tag v0.1.0 && git push origin v0.1.0
```

The deploy workflow builds the Docker image (this directory's `Dockerfile`),
pushes it to Artifact Registry, deploys to Cloud Run with 512 MB memory and
scale-to-zero, builds `apps/web`, and publishes `dist/` to Cloudflare Pages.

## Local image

```sh
make build
docker run --rm -p 8080:8080 flourish-api
curl localhost:8080/healthz
```
