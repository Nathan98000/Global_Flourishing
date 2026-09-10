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
