# SETUP.md — hand-off checklist

Everything only the repo owner can do. Each step is copy-pasteable; replace
the `export` values in step 0 with your own. Until steps 1–3 are done, the
deploy workflow on a `v*` tag still runs green — it just skips the deploy
jobs with a notice pointing here.

## 0. Pick identifiers

```sh
export PROJECT_ID="flourish-atlas"        # your GCP project id (globally unique)
export REGION="us-east1"                  # suggested default
export REPO="Nathan98000/Global_Flourishing"
export SA_NAME="flourish-deploy"
```

**Already set up?** Steps 1–4 have been done for this repo, so a fresh shell
should *recover* the real identifiers rather than re-type the defaults above —
the project id you actually got may differ (project ids are globally unique),
and `$SA_EMAIL` built from the wrong one fails later with "Service account …
does not exist".

```sh
gh variable list                      # GCP_PROJECT_ID, GCP_REGION, CLOUD_RUN_SERVICE, …
export PROJECT_ID="<the GCP_PROJECT_ID value>"
export REGION="<the GCP_REGION value>"
gcloud config set project "$PROJECT_ID"

gcloud iam service-accounts list      # copy the deploy account's email
export SA_EMAIL="<that email>"
```

## 1. Google Cloud (API on Cloud Run)

Requires the [gcloud CLI](https://cloud.google.com/sdk/docs/install), logged
in (`gcloud auth login`) with billing enabled on the project (free tier is
enough; billing must merely be attached).

```sh
gcloud projects create "$PROJECT_ID"   # skip if it exists
gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com iamcredentials.googleapis.com

# Artifact Registry repo the workflow pushes to (name "flourish" is hard-coded in deploy.yml)
gcloud artifacts repositories create flourish \
  --repository-format=docker --location="$REGION"

# Deploy service account
gcloud iam service-accounts create "$SA_NAME" --display-name="Flourish Atlas deploys"
export SA_EMAIL="$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"
for role in roles/run.admin roles/artifactregistry.writer roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SA_EMAIL" --role="$role"
done

# Workload Identity Federation (no JSON keys): pool + GitHub OIDC provider,
# restricted to this repository
export PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
gcloud iam workload-identity-pools create github \
  --location=global --display-name="GitHub Actions"
gcloud iam workload-identity-pools providers create-oidc github-oidc \
  --location=global --workload-identity-pool=github \
  --display-name="GitHub OIDC" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository == '$REPO'"

# Let workflows from this repo impersonate the deploy service account
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"

# The value for the GCP_WORKLOAD_IDENTITY_PROVIDER secret:
echo "projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/github-oidc"
```

## 2. Cloudflare (web on Pages)

1. Create the Pages project (direct upload):
   `npx wrangler@latest pages project create flourish-atlas --production-branch=main`
   (or dashboard → Workers & Pages → Create → Pages → Direct upload).
2. Create an API token: dashboard → My Profile → API Tokens → Create Token →
   "Edit Cloudflare Workers"-style custom token with **Account · Cloudflare
   Pages · Edit** permission only.
3. Account ID: dashboard → Workers & Pages → right sidebar, or
   `npx wrangler@latest whoami`.

If you deploy from the dashboard's git integration instead of this repo's
workflow, the build settings are: build command
`pnpm install --frozen-lockfile && pnpm -C apps/web build`, output directory
`apps/web/dist` — but the tag-driven workflow here is the intended path.

## 3. GitHub secrets and variables

```sh
gh secret set GCP_WORKLOAD_IDENTITY_PROVIDER --body "projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/github/providers/github-oidc"
gh secret set GCP_SERVICE_ACCOUNT --body "$SA_EMAIL"
gh secret set CLOUDFLARE_API_TOKEN    # paste when prompted
gh secret set CLOUDFLARE_ACCOUNT_ID   # paste when prompted

gh variable set GCP_PROJECT_ID --body "$PROJECT_ID"
gh variable set GCP_REGION --body "$REGION"
gh variable set CLOUD_RUN_SERVICE --body "flourish-atlas-api"
gh variable set CF_PAGES_PROJECT --body "flourish-atlas"
```

Deploy jobs turn on automatically once these exist (the preflight job in
`.github/workflows/deploy.yml` checks for them); there is no separate
enable flag.

## 4. First real deploy

The API's public URL and the web app's origin don't exist until the first
deploy, so it takes two tags:

```sh
make deploy TAG=v0.1.0
# → wait for the Deploy workflow; copy the Cloud Run URL from the
#   "API → Cloud Run" job output (e.g. https://flourish-atlas-api-xxxx.run.app)
#   and the Pages URL (e.g. https://flourish-atlas.pages.dev)

gh variable set API_BASE_URL --body "https://<cloud-run-url>"
gh variable set WEB_ORIGIN --body "https://<pages-url>"

make deploy TAG=v0.1.1
# → web rebuilds pointing at the API; API redeploys with CORS for the web origin
```

Verify: open the Pages URL — the index page's status line should read
"API: ok · v0.1.0 · sha …".

## 5. Optional: branch protection

Ruleset on `main` requiring the four `ci` checks on PRs, with admins still
able to push directly: repo → Settings → Rules → Rulesets → New branch
ruleset → target `main`, enable "Require status checks to pass"
(`Python (lint · types · tests)`, `Web (lint · types · tests · build)`,
`API image builds`, `pre-commit (all files)`), and add a bypass for the
repository admin role.

## 6. GitHub milestones, labels, phase issues, project

The remote session has no `gh`, so run locally from the repo root:

```sh
bash scripts/github-setup.sh
```

Idempotent — safe to re-run. It creates the nine phase milestones (with due
dates), the labels, the eight phase issues, and sets the repo description
and topics. The final step creates the "Flourish Atlas" Projects v2 board;
if your `gh` token lacks the `project` scope it prints the fix
(`gh auth refresh -s project`) and exits successfully — re-run after
refreshing to create the board.

## Phase 1 — nothing required

The data pipeline needs no cloud resources: raw files live locally in
`data/raw/` and `make data` builds everything on a laptop.

## 7. Phase 3 — private data bucket (raw files in, built artefacts out)

The deploy workflow bakes `flourish.duckdb` into the API image and ships
`data/static/` to Pages, but neither ever enters git — they come from a
private GCS bucket. One-time setup (uses `$PROJECT_ID`/`$REGION`/`$SA_EMAIL`
from steps 0–1):

```sh
export BUCKET="$PROJECT_ID-flourish-data"   # any globally-unique name

# --public-access-prevention is a boolean flag in `gcloud storage` (it *means*
# "enforced"); passing `=enforced` fails with "ignored explicit argument".
gcloud storage buckets create "gs://$BUCKET" \
  --location="$REGION" --uniform-bucket-level-access \
  --public-access-prevention

# Confirm both settings took (publicAccessPrevention: enforced, uniform: true)
gcloud storage buckets describe "gs://$BUCKET" --format="yaml(public_access_prevention, uniform_bucket_level_access)"

# The deploy service account reads builds and writes them from CI
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:$SA_EMAIL" --role="roles/storage.objectAdmin"

# Upload the three raw files (from wherever you keep them locally)
gcloud storage cp \
  data/raw/gfs_all_countries_wave2_with_midyear.csv \
  "data/raw/gfs_us-state-weight_wave2_with-midyear.csv" \
  data/raw/GFS_codebook_wave2.pdf \
  "gs://$BUCKET/raw/"

gh variable set GCS_DATA_BUCKET --body "$BUCKET"
```

Then run the data build once (and after any future raw-release change):

```sh
gh workflow run data-build.yml && gh run watch
```

It runs `make data` in CI (all stages including the static export), runs
the full test suite against the built data (R parity stays a local-only
gate — CI has no R), and uploads everything under
`gs://$BUCKET/builds/<data_version>/` with `builds/latest.txt` pointing at
it. The next `make deploy TAG=…` bakes that build into the image and the
Pages assets; until the bucket variable exists, deploys stay green and
ship a data-less API that says so at `/health`.

## 8. Optional: Sentry (API error reporting)

Create a (free-tier) Sentry project for Python/FastAPI, copy its DSN, then:

```sh
gh secret set SENTRY_DSN    # paste the DSN when prompted
```

and add `FA_SENTRY_DSN=${{ secrets.SENTRY_DSN }}` to the `env_vars` block
of the `deploy-api` job in `.github/workflows/deploy.yml` (left out by
default so the workflow stays secret-free for forks). The API initialises
Sentry only when `FA_SENTRY_DSN` is set.

## 9. Routine: shipping a phase

Steps 1–4 are one-time and are done — `flourish-atlas.pages.dev` is live and
the Cloud Run service answers `/health`. Everything after that is two moves.

First, see what is actually configured:

```sh
gh secret list
gh variable list   # expect GCP_PROJECT_ID, GCP_REGION, CLOUD_RUN_SERVICE,
                   # CF_PAGES_PROJECT, API_BASE_URL, WEB_ORIGIN — and, once
                   # §7 is done, GCS_DATA_BUCKET
```

1. **Data.** If `GCS_DATA_BUCKET` is absent, do §7 once (create the bucket,
   grant the deploy service account, upload the three raw files, set the
   variable), then build once:

   ```sh
   gh workflow run data-build.yml && gh run watch
   ```

   Re-run it whenever the pipeline output changes (a new `data_version`);
   deploys always bake whatever `builds/latest.txt` points at.

2. **Release.** From a clean, up-to-date `main`:

   ```sh
   make deploy TAG=vX.Y.Z
   ```

   The preflight job prints a notice for anything missing; `deploy-api`
   fails loudly if data was staged but `/health` reports it absent;
   `deploy-web` ships `data/static/` alongside the front end.

3. **Verify.** `curl -s https://<cloud-run-url>/health` shows the new
   `git_sha` and `"data":"ok"`, and the Pages URL serves the new build with
   the data version in its footer.

Until step 1 is done the deploy still succeeds: the API ships without data
and says so at `/health`, `/v1/*` returns 503, and the front end has no
precomputed tier to read — a state the app is required to handle honestly
rather than a failure to work around.
