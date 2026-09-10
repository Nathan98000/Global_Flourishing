# Methods

How Flourish Atlas turns 207,919 questionnaires into the numbers on the
screen. This page is the source for the in-app Methods view (Phase 4);
the implementation is the `flourish_stats` package, verified against R's
`survey` package (see [R parity](#verified-against-r) below).

## Survey weights: why every number carries one

The Global Flourishing Study did not interview a random slice of each
country: some kinds of people are easier to reach than others, and each
country's sample was recruited its own way. Every respondent therefore
carries a **weight** — roughly, how many adults of their country that
person stands for, scaled so weights average 1 within each country. A
plain average of the raw answers would describe *the sample*; the weighted
average describes *the population*. That is why every figure in the app
names the weight it used, alongside the unweighted number of respondents
(n) behind it.

Weights are normalised to mean 1 **within** each country, so pooling
countries without re-scaling would count Türkiye's 1,473 respondents the
same as the United States' 38,312. Until the population-rescaled "all
countries" option ships (Phase 5), figures are per-country.

## Which weight, when

One table in the code (`flourish_stats.weights`, served by the API at
`/v1/meta`) is the only place the weight rules live. The global rows:

| Waves | Weight | Who is eligible | Why this weight |
|---|---|---|---|
| Wave 1 | `w_c1` | everyone | Wave 1 cross-section: every respondent was interviewed at Wave 1, and w_c1 calibrates them to their country's adult population. |
| Wave 2 | `w_c2` | retained at Wave 2 | Wave 2 cross-section: only retained respondents were interviewed, and w_c2 re-calibrates them to the population, absorbing attrition. |
| Midyear | `w_l1m` | has a midyear interview | Midyear cross-section: w_l1m adjusts the 63% with a midyear interview back to the Wave 1 population. |
| Wave 1 → Wave 2 | `w_l2` | retained at Wave 2 | Wave 1 → Wave 2 change for the same people: w_l2 is the attrition-adjusted longitudinal weight, the default for change. |
| Wave 1 → Wave 2 (alt.) | `w_r2` | retained at Wave 2 | Alternative "rectangular" panel weight for complete-both-waves analyses. Quirk: the release populates w_r2 for all 207,919 rows, including the 79,051 not retained at Wave 2, so eligibility must come from the retained_y2 flag, never from the weight being non-null. |
| Wave 1 → Midyear | `w_l1m` | has a midyear interview | Wave 1 → midyear change: w_l1m adjusts midyear respondents back to the Wave 1 population. |
| Wave 1 → Midyear → Wave 2 | `w_l1m2` | retained **and** has midyear | Three-point panel: w_l1m2 covers the 116,038 respondents with all of Wave 1, the midyear survey and Wave 2. |
| Midyear → Wave 2 | `w_l1m2` | retained, has midyear, **standalone midyear only** | Midyear → Wave 2 change is restricted to standalone midyear interviews (midyear_type = 1): for type 2 the midyear items were asked in the Wave 2 interview itself, so the two answers are the same day and their difference is not change over time. |

US-state figures use the same table on the state-calibrated weight columns
(`w_state_*`, and the `_adj_` variants for the post-Wave-1 weights),
restricted to US respondents with a state.

Two release quirks the table encodes so nothing downstream can trip on
them:

- **`w_r2` is not a retention indicator.** It is populated for every one
  of the 207,919 rows — including the 79,051 respondents with no Wave 2
  interview — and differs from both `w_c1` and `w_l2` on every row.
  Row eligibility is always the explicit flag (`retained_y2`,
  `has_midyear`, `midyear_type`), never "the weight is non-null".
- **The midyear survey was administered two ways.** For 77,129
  respondents the midyear items were appended to the Wave 2 interview
  (`midyear_type = 2`), so their "midyear" and Wave 2 answers are from
  the same day. Any midyear → Wave 2 comparison is therefore restricted
  to the 54,358 standalone midyear interviews, and the engine applies
  that restriction itself.

## Confidence intervals: the survey design matters

The GFS did not sample individuals independently. In eleven countries,
interviewers went to sampled locations — **primary sampling units**
(PSUs) — inside **strata** (regions, or recruitment groups), and people
from the same place tend to resemble each other. Treating such a sample
as independent draws understates the uncertainty, sometimes badly.

The engine computes standard errors by **Taylor linearisation** over the
release's 411 strata and 136,781 PSUs — the same estimator as R's
`survey` package and Stata's `svy` for a stratified design with PSUs
sampled with replacement. In sketch: each respondent's weighted deviation
from the estimate is summed within their PSU; the variance is built from
how much PSU totals vary within each stratum. In countries where each
respondent is their own PSU (Japan, the US, Sweden, Hong Kong, China),
this reduces to the familiar formula; in clustered countries (for
example Egypt with 125 PSUs or Kenya with 250) the design-based SE is
genuinely larger than the naive one — that difference is real information
about the survey, not a bug.

Some strata contain a **single PSU** (38 in the release itself, and many
more once you zoom into subgroups). A one-PSU stratum has no internal
comparison to estimate variance from, so the engine adopts R's
`survey.lonely.psu = "adjust"` policy (with
`survey.adjust.domain.lonely = TRUE`): the lonely PSU's total is measured
against the average of all PSU totals rather than its own stratum's mean —
a conservative, standard choice. The parity suite pins this behaviour to
R exactly, including its subtleties for subgroups.

Intervals shown are **95% confidence intervals**, estimate ± 1.96
standard errors (normal-based, like R's `confint` on a `svymean`). With
the study's sample sizes the normal approximation is comfortable; tiny
cells are suppressed long before it breaks down.

## Subgroups (domain estimation)

An estimate for one subgroup — an age band inside a country, say — is not
computed by pretending the subgroup was its own survey. The engine keeps
the **full design** in view: everyone outside the subgroup still shapes
the variance through their strata and PSUs, exactly as R's
`svyby`/`subset` do. Respondents who skipped a question are handled the
same way (complete-case per item: excluded from the estimate, kept in the
design). Because GFS strata never cross a country border, a per-country
figure is identical either way — a fact the test suite asserts.

## Small cells: suppression and flagging

Deep cross-tabs can produce cells with a handful of respondents —
statistically meaningless and potentially misleading. Cells with
**unweighted n below 50 are suppressed** (the estimate is withheld; the
cell still shows its n so the gap is honest), and cells with **n from 50
to 99 are flagged** as small. For categorical breakdowns the rule applies
per answer option, and in transition matrices per cell. The thresholds
are parameters of the engine, not magic numbers scattered through it.

## Change over time

Change figures follow the **same people** across waves — never the
difference of two cross-sections — using the longitudinal weights
(`w_l2`, `w_l1m2`), which re-balance the retained panel back toward the
original Wave 1 population. That matters because attrition is far from
random: retention ranges from 90% in China to 23% in Hong Kong. A
difference of two cross-sectional estimates would mix real change with
changes in who answered; the longitudinal weights are the only defensible
basis for "how did the same people move". Where Wave 2 and midyear
coverage differ by country, the app shows coverage alongside the
estimate.

Mean change is estimated on complete pairs (both waves answered), with
the same design-based CI machinery; distributions of individual change
and transition matrices ("of the people who said X in 2023, what did
they say in 2024?") come with the same per-cell uncertainty and
suppression.

## Medians and correlations

**Quantiles** (like medians) are computed from the weighted cumulative
distribution: the median is the smallest answer at which half the
weighted population sits at or below (R `svyquantile`, `qrule = "math"`).
They are shown **without confidence intervals** for now — survey CIs for
quantiles (Woodruff intervals) are a recorded backlog item.

**Correlations** are weighted Pearson coefficients (or Spearman: ranks
first, then weighted Pearson on the ranks — one of several defensible
definitions of a weighted rank correlation; it reduces to the classical
one when weights are equal). They are shown as point estimates without
CIs in this phase.

## Associations, not causes

Nothing in this app is a causal estimate. "People who attend services
weekly report higher meaning" is a statement about who reports what, in
one survey, at one time — attendance, meaning, and a hundred unmeasured
things travel together. Adjusted associations (Phase 6) will control for
a fixed set of demographics, which narrows, but does not close, that gap.
The app says "associated with", and means exactly that.

## Verified against R

The engine is cross-checked against R's `survey` package on **30
estimates** spanning the designs that make survey inference hard:
self-representing countries, countries with lonely PSUs (Brazil, Israel),
genuinely clustered samples (Egypt, Kenya, India, Nigeria, the
Philippines), subgroup estimates, all five weights, the standalone-midyear
restriction, proportions, a median, a correlation and a full transition
matrix. The case list is `stats/verify/cases.csv`; the committed
reference (`stats/verify/reference.json`, aggregates only) records the R
and `survey` versions and the data version it was computed from; `make
parity` regenerates and re-checks it. Tolerances: point estimates agree
within 10⁻⁹, standard errors within one part in 10⁶, medians exactly.

## Data

Global Flourishing Study, Waves 1–2 (2023–2024), with the midyear survey.
Center for Open Science / Gallup / Harvard Human Flourishing Program /
Baylor Institute for Global Human Flourishing.
<https://doi.org/10.17605/OSF.IO/3JTZ8>. Study profile: VanderWeele et
al., *Nature Mental Health* (2025). The app displays the exact data
version (from `data/manifest.json`) in its footer; this repository
contains no microdata, and the app serves aggregates only.
