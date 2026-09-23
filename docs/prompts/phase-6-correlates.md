# Phase 6 — Correlates and modelling

Implement Phase 6 end to end. Work efficiently: read only the files listed under
each task, edit directly rather than proposing, run the narrowest test that
proves a step, and save the full gate run for the end. No progress narration, no
summaries of files you just read, no speculative refactors, no work outside the
scope below.

## Context

Flourish Atlas: monorepo, Python 3.12 (`pipeline`, `stats`, `services/api`) plus
`apps/web` (React 18 + TS + Vite + TanStack Router/Query + Observable Plot).
Phases 0–5 shipped; the live site is at v0.5.0 with Atlas, Breakdowns, Change,
Compare, What Matters, US States, Codebook, Methods.

Phase 6 adds adjusted associations to the engine, serves `/v1/correlates`, and
builds the Correlates view. Unlike Phase 5 this **does** touch the engine and the
API, so the OpenAPI contract and the generated client change.

Standing rules (CLAUDE.md), non-negotiable:

- Weight and eligibility facts live only in `flourish_stats.weights`. Resolve the
  wave's spec; never hardcode a weight column.
- The API and the static exporter share one response envelope. Correlates rows go
  out as `EstimateRow`s in an `EstimateResponse`.
- The front end computes no statistics and owns no labels.
- Never commit data. Tests use synthetic fixtures.
- Numbers shown to users carry weight, unweighted n and CI.
- Conventional commits; every significant decision gets an ADR.

Gates: coverage **≥ 90%** on `stats/src` *and* `services/api/src`
(`--fail-under=90`, both enforced in CI); initial web route ≤ 250 kB gz;
Lighthouse ≥ 90 / ≥ 95; OpenAPI and generated-client drift checks.

---

## 1. Engine — `adjusted_association`

`stats/src/flourish_stats/correlations.py` holds the signature, the default
control set and a `NotImplementedError`. Implement it. Read that file plus
`_core.py` (for `finalize`, `check_columns`, `with_dummy`, `group_keys`),
`design.py`, and `panel.py` (for how an existing estimator assembles records).

- **numpy only.** numpy ≥ 2.1 is already a dependency. Do not add scipy,
  statsmodels or patsy.
- Continuous outcomes: survey-weighted least squares. Binary outcomes: weighted
  logistic by IRLS. Pick from the catalog's `scale_type`, not by inspecting
  values.
- **Design-based SEs**, matching `svyglm`: the sandwich estimator with Taylor
  linearisation of the score residuals over strata/PSU. When `Design` has no
  strata/psu, fall back to the Kish path exactly as the other estimators do and
  let `se_method` report it — never silently.
- Controls: the existing default tuple. Categorical controls are dummy-coded,
  first level dropped. **`country_code` is fixed effects, so it must be dropped
  from the controls whenever the caller groups `by=["country_code"]`** — a
  per-country model cannot also carry country fixed effects. Handle this in the
  function, not at the call site.
- Singular or rank-deficient design, or a group with too few complete cases:
  null `estimate`/`se` with `n` intact, mirroring `weighted_correlation`'s
  undefined case. Never raise for data reasons.
- Return through `finalize` with `ci_method="normal"`, `ci_level=0.95`, and
  `stat="beta"`. Use the `extra` mechanism to carry a `measure` key so the row
  says which quantity it is (the predictor's coefficient; add a standardized
  variant only if it costs nothing).
- Tests in `stats/tests/test_correlations.py`: weights of 1 reproduce ordinary
  least squares and ordinary logistic; a known closed-form fixture; the
  fixed-effects/`by` interaction above; rank-deficient input returns nulls;
  Kish vs Taylor both exercised. Add a Hypothesis property to
  `test_properties.py` only if it fits the existing style cheaply.

## 2. R parity

`stats/verify/` has the harness (`reference.R`, `cases.csv`, `reference.json`,
`test_parity.py`, `extract.py`). Add regression cases against
`survey::svyglm` — a handful covering one continuous and one binary outcome,
with and without `by` — following the file's existing case format and tolerance
convention. Regenerating `reference.json` needs R locally; if R is unavailable,
add the cases and the code path, mark the new parity test with the existing
skip/marker mechanism the harness already uses for that situation, and say so in
the PR rather than inventing reference numbers.

## 3. API — `/v1/correlates`

`services/api/src/flourish_api/routes/correlates.py` is a 501 stub. Read it,
`routes/aggregate.py` (the `run_aggregate` pattern), `queries.py` (parsing and
validation), `frames.py`, `schemas.py`.

Parameters: `outcome`, `wave`, `against` (one predictor; omitted means the ranked
sweep), `method` (`pearson` | `spearman`), `adjusted` (bool), `by`, `filter`,
`limit`. Resolve the weight from the wave spec as the other routes do.

- Ranked mode correlates the outcome against every other servable catalog item.
  That is ~160 estimators per request: cap it with `limit` (sensible default),
  compute in one pass over one frame rather than one frame per predictor, and
  **report the warm timing for a ranked sweep in the PR description**. If it is
  slow enough to be a problem, say so with the number rather than optimising
  speculatively.
- `adjusted=true` routes to `adjusted_association`; otherwise
  `weighted_correlation`. Unadjusted rows carry `ci_method="none"` — the view
  must not draw an interval that does not exist.
- Reject a predictor that is not servable, and a `by` column outside
  `BREAKDOWNS`, with the same error shape the other routes use.
- Tests in `services/api/tests/`: contract test against the envelope, validation
  failures, a golden-file case, and the suppression policy honoured. Keep
  `services/api/src` coverage ≥ 90%.
- Run `make gen-client` afterwards and commit `openapi.json` and
  `apps/web/src/api/schema.d.ts` — CI drift-checks both.

## 4. Web — the Correlates view

Route `/correlates`, lazy like the others. Read `router.tsx`, `state/search.ts`
(the `parse*Search` / `*SearchParams` / `*Request` pattern), `api/estimates.ts`,
`views/ChangeView.tsx` (the closest sibling), `charts/ChartFigure.tsx`,
`charts/TransitionTable.tsx`, `charts/RankedBar.tsx`, `components/controls/*`.

- **Ranked list**: "What travels with X?" — the outcome's strongest associations,
  ranked, built on `RankedBar` if it fits honestly.
- **Per-country heatmap**: reuse `TransitionTable`'s tinted-matrix pattern rather
  than writing a new chart module; extend it if needed, don't duplicate it.
- **Adjusted toggle**: a segmented control, unadjusted by default. When adjusted
  is on, the figure links to the model card. When it is off, no confidence
  intervals are drawn.
- Visual system is ADR-0012 and the Phase 5 conventions: hairline rules, no
  cards, quiet controls, `var(--token)` colours only, `LoadingBlock` for the
  slow-fetch affordance, the route's warm-up ping. Correlation coefficients are
  a diverging scale — add diverging ramp tokens to `tokens.css` and extend
  `tokens.test.ts` rather than reaching for a hex literal.
- Nav gains a ninth item; check the header at 390px and collapse rather than
  shrink if it no longer fits.
- **"Associations, not causes" belongs on this view**, in the deck under the h1
  and in the figure footnote — as plain sentences in the existing type, not a
  tinted callout box. The owner removed decorated callouts from chart figures in
  the September design round; do not reintroduce one.
- Component tests for the new chart and controls, hook tests for the search
  schema round-trip including invalid params degrading to defaults, and one
  Playwright journey: pick an outcome, read the ranked list, switch to adjusted,
  open the model card.

## 5. Model cards and documents

- `docs/model-cards/` — one card per model family (continuous, binary). Each
  states the specification, the control set, the weight and eligibility rule, the
  SE method, what the coefficient means in words, and the limitations: no causal
  claim, residual confounding, cross-sectional design, country fixed effects
  absorbing between-country variation.
- `docs/METHODS.md` — expand with a plain-language section on adjusted vs
  unadjusted association and why "controlling for" is not "accounting for".
- **New ADR** (next number after 0013): the estimator choices — WLS/IRLS on
  numpy, the sandwich SE, the fixed control set, the country-FE/`by` rule, and
  serving ranked correlations without CIs.
- README: add Correlates to the feature list.

## Out of scope

The population-rescaled "all countries" option; extending the static exporter;
anything in Phase 7. The proposal's Phase 6 exit also requires a review by
someone with a statistics background — that is the owner's step, not yours. Note
it in the final PR description.

## Verification

Run the narrow tests as you go. At the end, once:

```sh
uv run pytest --cov=flourish_api --cov=flourish_pipeline --cov=flourish_stats
uv run coverage report --include='stats/src/*' --fail-under=90
uv run coverage report --include='services/api/src/*' --fail-under=90
pnpm -C apps/web test && pnpm -C apps/web budget && pnpm -C apps/web e2e
make lint typecheck
```

## Shape

Four stacked PRs, each green before the next: **(1)** engine + parity,
**(2)** API + regenerated client, **(3)** the view, **(4)** model cards, ADR and
docs. Conventional-commit subjects. In each PR description give only: what
changed, the gate numbers, and anything that surprised you. Stop before tagging
or deploying.
