#!/usr/bin/env bash
# One-time GitHub project setup for Flourish Atlas (docs/PROPOSAL.md §7).
# Idempotent: safe to re-run; existing milestones/labels/issues are left alone.
# Requires: gh (authenticated with repo access). The final Projects-v2 step
# needs the `project` scope and degrades gracefully without it.
set -euo pipefail

REPO="Nathan98000/Global_Flourishing"
OWNER="Nathan98000"

say() { printf '\n== %s\n' "$*"; }

# ---------------------------------------------------------------- milestones
# Week 1 begins Monday 2026-09-14; each due date is the Sunday ending the
# phase's last week.
ensure_milestone() {
  local title="$1" due="$2" desc="$3" number
  number=$(gh api "repos/$REPO/milestones?state=all&per_page=100" \
    --jq ".[] | select(.title == \"$title\") | .number" | head -n1)
  if [ -n "$number" ]; then
    echo "milestone exists: $title (#$number)"
  else
    gh api -X POST "repos/$REPO/milestones" \
      -f title="$title" -f due_on="${due}T12:00:00Z" -f description="$desc" \
      --jq '"created milestone: \(.title) (#\(.number))"'
  fi
}

say "Milestones"
ensure_milestone "Phase 0 — Foundations" 2026-09-20 \
  "Monorepo, tooling, CI skeleton, ADR-0001. Exit: hello-world API and web app deployed from CI."
ensure_milestone "Phase 1 — Data pipeline" 2026-10-04 \
  "make data builds catalog, Parquet, DuckDB. Exit: validation suite passes; reproduces published SFI ranking."
ensure_milestone "Phase 2 — Statistics engine" 2026-10-18 \
  "Weighted estimators with design-based CIs. Exit: 30 estimates match R survey within tolerance."
ensure_milestone "Phase 3 — API" 2026-11-01 \
  "FastAPI on Cloud Run; static aggregate export. Exit: contract tests pass; p95 < 300 ms on hot queries."
ensure_milestone "Phase 4 — Front-end MVP" 2026-11-22 \
  "Atlas, Breakdowns, Codebook, Methods; URL state. Exit: public MVP; Lighthouse >= 90 / a11y >= 95."
ensure_milestone "Phase 5 — Panel, midyear & US" 2026-12-06 \
  "Change, Compare, What Matters, US States views. Exit: all Y1/MY/Y2 data reachable through the UI."
ensure_milestone "Phase 6 — Correlates" 2026-12-20 \
  "Correlates view, adjusted models, model cards. Exit: methods page updated; caveats shown in-product."
ensure_milestone "Phase 7 — Hardening" 2026-12-27 \
  "E2E, load test, monitoring, docs. Exit: launch checklists complete."
ensure_milestone "Phase 8 — Launch & packaging" 2027-01-03 \
  "v1.0 tag, case study, demo video, README. Exit: published and linked from portfolio."

# -------------------------------------------------------------------- labels
say "Labels"
ensure_label() { gh label create "$1" --repo "$REPO" --color "$2" --description "$3" --force >/dev/null && echo "label: $1"; }
ensure_label phase    5319e7 "Phase-level tracking issue"
ensure_label adr      0e8a16 "Involves an architecture decision record"
ensure_label data     fbca04 "Data pipeline / dataset handling"
ensure_label api      1d76db "FastAPI service"
ensure_label web      d93f0b "React front end"
ensure_label pipeline c2e0c6 "pipeline/ package"
ensure_label ci       ededed "CI/CD and workflows"

# -------------------------------------------------------------- phase issues
existing_issue_titles=$(gh issue list --repo "$REPO" --state all --limit 200 --json title --jq '.[].title')

ensure_issue() {
  local title="$1" milestone="$2"
  if printf '%s\n' "$existing_issue_titles" | grep -Fxq "$title"; then
    echo "issue exists: $title"
  else
    gh issue create --repo "$REPO" --title "$title" --milestone "$milestone" \
      --label phase --body-file - >/dev/null
    echo "created issue: $title"
  fi
}

say "Phase issues"
ensure_issue "Phase 1 — Data pipeline and codebook (weeks 2–3)" "Phase 1 — Data pipeline" <<'EOF'
Build the codebook parser and its fixture tests; write the overrides file (family, direction, display name) for all ~150 substantive variables, including the 16 midyear items. Implement ingest → clean → reshape → derive per proposal §5.2 with an explicit dtype map and sentinel handling, loading the global-with-midyear file as the primary source and joining the US file's state weights on `ID`. Write pandera schemas and the acceptance tests from §3.6. Produce `manifest.json`. Add a short exploratory notebook that documents surprises (blank strings, `WAVE_Y2 = 2` and `WAVE_MY = 11`, the two midyear administration modes, income band structure) so the README's "data quirks" section is honest.

**Exit:** `make data` is reproducible from raw files in under five minutes on a laptop, and the validation report is committed. (docs/PROPOSAL.md §7, Phase 1)
EOF
ensure_issue "Phase 2 — Statistics engine (weeks 4–5)" "Phase 2 — Statistics engine" <<'EOF'
Implement weighted mean/proportion/quantile, Taylor-linearised SE with strata/PSU, Kish fallback, paired change with `L2` and `L_1M2`, transition matrices, weighted correlations, and the suppression policy as pure functions over Arrow tables. Encode the wave-to-weight mapping (Y1 → `C1`, MY → `L_1M`, Y2 → `C2`, Y1→Y2 → `L2`, Y1→MY→Y2 → `L_1M2`) as a single table that both the engine and the API validate against. Write property-based tests (Hypothesis) for invariants. Cross-check 30 estimates against R `survey` and record tolerances. Document each estimator in `docs/METHODS.md`.

**Exit:** parity within tolerance; coverage ≥ 90% on the stats module. (docs/PROPOSAL.md §7, Phase 2)
EOF
ensure_issue "Phase 3 — API (weeks 5–7)" "Phase 3 — API" <<'EOF'
Design the query model (outcome, stat, by, filters, wave, weight) as pydantic models with validation that rejects nonsense (a Y1-only variable at Y2; a weight that doesn't apply). Implement the endpoints in proposal §5.4 over DuckDB; add ETag/Cache-Control, LRU, rate limiting, structured logs, Sentry. Containerise with the DuckDB file baked in; deploy to Cloud Run. Generate the TypeScript client from OpenAPI. Build the static aggregate exporter and publish its output to the web app's assets. Load-test with k6 and tune DuckDB threads/memory for the 512 MB Cloud Run instance.

**Exit:** contract tests pass in CI; p95 < 300 ms warm on hot queries; cold start measured and documented. (docs/PROPOSAL.md §7, Phase 3)
EOF
ensure_issue "Phase 4 — Front-end MVP (weeks 7–10)" "Phase 4 — Front-end MVP" <<'EOF'
Define design tokens and the chart component library (ranked bar with CI, dot plot, small multiples, choropleth). Build Atlas, Breakdowns, Codebook, and Methods; wire typed URL state so every view is shareable; add CSV/PNG export; implement suppression and flag rendering; add loading, empty, and error states; dark mode; keyboard navigation and screen-reader labels for charts. Run Lighthouse CI and fix.

**Exit:** public MVP at the production URL; six Playwright journeys green; a friend can answer "which country has the highest mental health rating among 18–24-year-olds?" without help. (docs/PROPOSAL.md §7, Phase 4)
EOF
ensure_issue "Phase 5 — Panel, midyear and US views (weeks 10–12)" "Phase 5 — Panel, midyear & US" <<'EOF'
Implement Change (paired shift with CI, histogram of individual change, transition matrix, retention banner; wave pairs Y1→Y2 and, for standalone-midyear respondents, Y1→MY→Y2), Compare (2–5 countries or segments across domains), What Matters (midyear importance rankings by country and age; priorities × Wave 2 flourishing; social media time × mental health; food insecurity × financial domain), and US States (state choropleth using state weights). Add the population-rescaled "all countries" option with its warning label.

**Exit:** every Y1, MY, and Y2 variable can be reached through at least one view; coverage is displayed wherever Wave 2 or midyear data appear. (docs/PROPOSAL.md §7, Phase 5)
EOF
ensure_issue "Phase 6 — Correlates and modelling (weeks 12–14)" "Phase 6 — Correlates" <<'EOF'
Add weighted correlations and adjusted associations (weighted OLS/logit with the fixed control set and country fixed effects) to the engine and API; build the Correlates view with a per-country heatmap and a ranked list; write model cards describing specification, controls, and limitations; place "associations, not causes" copy in the UI and expand the Methods page.

**Exit:** view live; methods reviewed by at least one person with a statistics background. (docs/PROPOSAL.md §7, Phase 6)
EOF
ensure_issue "Phase 7 — Hardening (weeks 14–15)" "Phase 7 — Hardening" <<'EOF'
Complete the E2E suite, run the accessibility audit (WCAG 2.1 AA), set performance budgets in CI, add security headers and CORS policy, set up alerts, write `ARCHITECTURE.md`, `DATA.md`, `METHODS.md`, and a runbook (how to rebuild data, how to roll back). Do a dependency and licence audit.

**Exit:** the launch checklists in proposal §8 are complete. (docs/PROPOSAL.md §7, Phase 7)
EOF
ensure_issue "Phase 8 — Launch and packaging (week 16)" "Phase 8 — Launch & packaging" <<'EOF'
Tag v1.0. Record a 90-second demo, write the case study (problem, architecture, three hard decisions, what you'd do differently), add résumé bullets with measurable outcomes (rows processed, p95 latency, Lighthouse scores, test counts), and post it. Send the courtesy note to COS.

**Exit:** live URL, repo, and write-up linked from the portfolio. (docs/PROPOSAL.md §7, Phase 8)
EOF

# ------------------------------------------------------------- repo metadata
say "Repo description and topics"
gh repo edit "$REPO" \
  --description "Interactive explorer for the Global Flourishing Study (Waves 1–2): survey-weighted estimates with CIs, by country, demographics, and wave." \
  --add-topic global-flourishing-study --add-topic survey-data \
  --add-topic data-visualization --add-topic fastapi --add-topic react \
  --add-topic typescript --add-topic duckdb >/dev/null
echo "description and topics set"

# ------------------------------------------------------- Projects v2 (last)
say "Project board (needs the 'project' scope)"
if ! gh project list --owner "$OWNER" --format json >/dev/null 2>&1; then
  echo "Skipping: your gh token lacks the Projects scope."
  echo "Run:  gh auth refresh -s project"
  echo "then re-run this script to create the board."
  exit 0
fi

project_number=$(gh project list --owner "$OWNER" --format json \
  --jq '.projects[] | select(.title == "Flourish Atlas") | .number' | head -n1)
if [ -z "$project_number" ]; then
  project_number=$(gh project create --owner "$OWNER" --title "Flourish Atlas" \
    --format json --jq '.number')
  echo "created project #$project_number"
else
  echo "project exists: #$project_number"
fi
gh project link "$project_number" --owner "$OWNER" --repo "$REPO" 2>/dev/null || true

project_items=$(gh project item-list "$project_number" --owner "$OWNER" --format json --jq '.items[].content.title')
gh issue list --repo "$REPO" --state all --label phase --limit 50 --json title,url --jq '.[] | [.title, .url] | @tsv' |
  while IFS=$'\t' read -r title url; do
    if printf '%s\n' "$project_items" | grep -Fxq "$title"; then
      echo "already on board: $title"
    else
      gh project item-add "$project_number" --owner "$OWNER" --url "$url" >/dev/null
      echo "added to board: $title"
    fi
  done

say "Done"
