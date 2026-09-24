# ADR-0014: Phase 6 — adjusted associations on numpy, the `svyglm` sandwich, a fixed control set, and ranked correlations without intervals

- Status: Accepted
- Date: 2026-09-23
- Deciders: repo owner, Claude
- Related: ADR-0005 (stats as a package), ADR-0006 (estimator design —
  Taylor linearisation matching R `survey`), ADR-0008 (one envelope, two
  tiers), ADR-0011 (every cell shown, with its n), ADR-0013 (API-only
  views, the progress affordance), proposal §5.3 and §7 Phase 6,
  `docs/model-cards/`

## Context

Phase 6 adds "what travels with a measure": the weighted correlations the
engine has carried as point estimates since Phase 2, and adjusted
associations — a regression of one measure on another under a fixed set
of controls — served at `/v1/correlates` and drawn by the Correlates
view. Five questions had no answer in earlier records:

1. **How to fit the models.** The engine is polars plus numpy; the
   obvious shortcuts (scipy, statsmodels, patsy) are heavy dependencies
   for a 512 MiB Cloud Run image and none of them computes the standard
   error a stratified, clustered survey design needs.
2. **Which standard error.** ADR-0006 committed every estimate to R
   `survey`'s Taylor linearisation with its lonely-PSU and domain rules.
   A regression coefficient must meet the same bar or it cannot sit in
   the same envelope.
3. **Which controls, and what a country is.** Weights are calibrated
   within country, strata nest within country, and the view groups by
   country; a country fixed effect in a per-country model is
   collinear with the intercept.
4. **Whether to draw an interval on a correlation.** The engine has none
   (Phase 2 shipped point estimates); a Fisher-z interval assumes simple
   random sampling and would be wrong for this design.
5. **What a ranked sweep costs.** "What travels with X" means one
   estimate per other servable item — a hundred or more — per request.

## Decision

**Weighted least squares and logistic IRLS on numpy, nothing else.** A
continuous outcome (0–10 scale, count, ordinal) is fitted by least
squares on `√w·X`; a binary outcome (a yes/no item, a derived screener)
by iteratively reweighted least squares, stopping on R's rule — a
relative change in the deviance below 10⁻¹¹ — so a control level with no
events, whose dummy walks to −∞ while the deviance settles, converges as
it does in R. The family is the caller's choice from the catalog's
`scale_type`, never inferred from the values. Binary items enter as 0/1
indicators of code 1 (the release codes Yes as 1 and No as 2; the
derived screeners code positive as 1).

**The design-based sandwich, through the machinery that already exists.**
The coefficient's influence values, `(XᵀWX)⁻¹ x_i w_i (y_i − μ_i)`, go
through the same `taylor_variance` as every mean: R `svyglm` builds its
variance from the same quantities (`estfun %*% cov.unscaled` into
`svyrecvar`), so the recentering, lonely-PSU and padded-PSU rules apply
verbatim, and six `svyglm` cases in the parity harness confirm it (|Δβ| ≤
1e-9, SE relative ≤ 1e-6). Without strata and PSUs the engine falls back
to a model-based variance on the Kish effective sample size — for an
intercept-only model, exactly the mean estimator's Kish SE — and
`se_method` reports it; the fallback is never silent.

**A fixed control set: age band, gender, education (three levels),
employment, marital status, country fixed effects.** Every entry is
categorical, dummy-coded with the first level dropped. The set is the
same for every outcome and predictor — never tuned per pair — and the
model cards state it. Control dummies aliased with each other or the
intercept are dropped, as R's `glm` pivots them out (the predictor's
coefficient does not depend on which full-rank parametrisation of the
controls remains); only a predictor that is itself unidentified — a
constant, or a function of the controls — returns a null estimate, with
its n intact. Too few complete cases, a binary outcome that never varies
and a fit that does not converge return the same honest null. Nothing in
the engine raises for a data reason.

**The country fixed effect leaves with `by=country_code` — in the engine,
not at the call site.** Any control that is also a grouping column is
constant within every group and is dropped for that call; a one-country
frame drops it the same way (one level, no dummy). The API reports the
controls actually in the model as `meta.controls`, and the view says them
in words.

**Two rows per group, `beta` and `beta_per_sd`.** The raw coefficient is
what the model card describes; the same coefficient per one weighted
standard deviation of the predictor — the fit on `x / sd(x)`, an exact
rescaling with the same interval — is what compares across measures on
different scales, so it ranks the sweep and is what the charts draw. Both
sit in the data table.

**Ranked correlations are served without intervals, and the view says
so.** Unadjusted rows carry `ci_method = "none"` and null `se`, `ci_lo`,
`ci_hi`; `meta.se_method` is `"none"` too. The view draws no whisker for
them, the footnote reads "point estimates — no confidence interval is
computed for a correlation" instead of naming an interval level, and the
data table drops its interval column. The adjusted toggle is where
intervals live. A design-based interval for a correlation (a delta method
over the four totals `svyvar` estimates) is possible and is the
recorded backlog item; a Fisher-z interval was rejected as wrong for the
design.

**One frame, one pass, and a stated exclusion.** The ranked sweep pivots
every servable item at the wave onto one frame in DuckDB (16 items per
query — one 104-column hash aggregate over 208k respondents needs about
330 MB, past the 256 MB the API grants DuckDB) and evaluates every pair
in a single polars group-by (`weighted_correlations`, numerically the
pairwise estimator to 1e-12). Nominal items are excluded (a nominal code
has no order and no correlation), and so are scores built from the same
answers as the outcome — a score and one of its components, or two
scores sharing a question, are associated by construction. Predictors
are ranked by the median absolute association across the groups and cut
to `limit` (default 20). `against` may name several predictors, which the
view uses to ask for its ranked list's own items across every country in
one request.

**The adjusted all-countries sweep is slow and is not optimised here.**
On the release, warm: unadjusted one country 0.6 s, unadjusted by country
1.8 s, adjusted one country 3.0 s, adjusted by country 20.8 s (104 fits ×
23 groups, roughly two thirds polars per-call overhead). The view never
takes that path — its cross-country matrix asks for the ranked list's
items by name (about 6 s adjusted) — and the LRU serves repeats. The lead,
if the sweep itself must be fast, is a numpy-only design-matrix build
and a shared per-group control matrix (Phase 7).

## Alternatives considered

- **statsmodels / scipy for the fits** — two heavy dependencies on a
  free-tier image, and their robust ("cluster") standard errors are not
  `survey`'s stratified linearisation with lonely-PSU handling; parity
  would have been lost, not gained.
- **Model-based (OLS / Fisher information) standard errors** — wrong for
  a stratified, clustered design (ADR-0006's whole point).
- **Fisher-z or bootstrap intervals on correlations** — Fisher-z assumes
  simple random sampling; a bootstrap over 136k PSUs per request is not a
  free-tier operation. Point estimates with a stated absence, and the
  adjusted model where an interval is wanted.
- **Choosing controls per pair** — the garden of forking paths; a fixed,
  published set is what a model card can stand behind.
- **Country dummies inside per-country models** — collinear with the
  intercept; the engine drops them so no call site can get it wrong.
- **Ranking by the raw coefficient** — not comparable across a 0–10 scale
  and a three-level item; the per-SD coefficient is.
- **Nulling any rank-deficient design** (the first implementation) —
  the synthetic catalog's demographics are collinear by construction and
  R still reports the predictor there; dropping aliased *controls* is
  what `glm` does.
- **Precomputing the sweep into the static tier** — 161 outcomes × three
  waves × two estimators × 24 groups; the views' visit counts do not
  justify it, and the API answers in a second unadjusted.
- **Twenty per-predictor requests for the cross-country matrix** — the
  same numbers, but twenty requests against a 60/min rate limit; one
  request with `against` repeated is the same work for the server.

## Consequences

- Every adjusted coefficient in the app carries the same kind of
  standard error as every mean, and the parity harness proves it against
  R for both families, with and without domains.
- Readers of an unadjusted correlation see its sign, size and n, and are
  told no interval exists — never a whisker that is not there.
- The response envelope gains optional fields (`predictor`, `adjusted`,
  `controls`, `model`); the static tier is untouched and validates as
  before.
- The adjusted all-countries sweep is a 20-second request; the view does
  not make it, and this is the Phase 7 performance item.
- The proposal's Phase 6 exit also requires a review of these methods by
  someone with a statistics background; that review is the owner's step
  and is pending.
- Revisit when: a design-based interval for correlations is wanted
  (delta method over `svyvar`'s totals); the population-rescaled "all
  countries" option lands (a pooled model would then be meaningful); or
  the sweep must answer in under a second adjusted.
