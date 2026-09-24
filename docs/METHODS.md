# Methods

How Flourish Atlas turns 207,919 questionnaires into the numbers on the
screen: which weights are applied and why, how the margins of error are
computed, and when a number is withheld. Everything described here runs
in open code, and the results are checked against an independent
implementation (R's `survey` package — see
[R parity](#verified-against-r) below).

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
the study's sample sizes the normal approximation is comfortable for
typical cells; in the very small cells the app now shows (see below),
read the interval — and the n — with care, and a cell resting on a
single sampling unit has no computable interval at all, shown as "—".

## Subgroups (domain estimation)

An estimate for one subgroup — an age band inside a country, say — is not
computed by pretending the subgroup was its own survey. The engine keeps
the **full design** in view: everyone outside the subgroup still shapes
the variance through their strata and PSUs, exactly as R's
`svyby`/`subset` do. Respondents who skipped a question are handled the
same way (complete-case per item: excluded from the estimate, kept in the
design). Because GFS strata never cross a country border, a per-country
figure is identical either way — a fact the test suite asserts.

## Small cells: shown, with their n

Deep cross-tabs can produce cells with a handful of respondents. Since
[ADR-0011](adr/ADR-0011-small-cells-shown.md) the app **shows every
cell, however small** — nothing is withheld or flagged. What protects
the reader instead is context that never leaves a number's side: the
unweighted **n** on every row (read it before leaning on a small cell),
and a confidence interval that widens honestly as cells shrink. A cell
resting on a single sampling unit has no computable interval and shows
"—" in its place.

The suppression machinery itself is intact and parameterised, not
deleted: the engine still takes a threshold pair, and setting
`FA_SUPPRESSION_THRESHOLD=50` / `FA_SUPPRESSION_FLAG_BELOW=100` on the
API (and passing the same policy to the static exporter) restores the
previous rule, under which cells below n = 50 were withheld and cells of
50–99 flagged.

## Change over time

Change figures follow the **same people** across waves — never the
difference of two cross-sections — using the longitudinal weights
(`w_l2`, `w_l1m2`), which re-balance the retained panel back toward the
original Wave 1 population. That matters because attrition is far from
random: retention ranges from 90% in China to 23% in Hong Kong. A
difference of two cross-sectional estimates would mix real change with
changes in who answered; the longitudinal weights are the only defensible
basis for "how did the same people move".

The app **does not display follow-up rates next to Wave 2 estimates** —
a deliberate owner decision (September 2026) departing from the
proposal's §3.4. Follow-up varies widely, from 23% of the Wave 1 sample
in Hong Kong to 90% in China, so treat cross-country Wave 2 comparisons
with that in mind; the per-variable, per-country figures remain in the
Codebook, in each variable's "Answered, by country and wave" table.

Mean change is estimated on complete pairs (both waves answered), with
the same design-based CI machinery; distributions of individual change
and transition matrices ("of the people who said X in 2023, what did
they say in 2024?") come with the same per-cell uncertainty, and every
cell is shown with its n.

## The same people a year later

The Change view shows how the **same people** answered a year later —
never the difference between the 2023 average and the 2024 average, which
would mix real change with changes in who answered. Each country's figure
is the average of (2024 answer − 2023 answer) across the respondents who
answered the question both times, weighted with the longitudinal weight
`w_l2` (or `w_l1m2` for the three-point 2023 → mid-2024 → 2024 panel),
which re-balances the retained group back toward the original Wave 1
population. Zero on the chart means no average change.

**Why fewer second answers widen the interval.** Only respondents
retained at Wave 2 who answered the question both times form a pair, so
a country's follow-up group is always smaller than its Wave 1 sample —
and how much smaller varies a great deal. Retention runs from 23% of the
Wave 1 sample in Hong Kong to 90% in China; several countries kept
fewer than half of their Wave 1 respondents, and item non-response
thins the pairs a little further. This is why a Change figure can rest
on a few hundred people in one country and many thousands in another
while the two sit side by side on the same chart. A smaller group means
a larger standard error, and the confidence interval widens
accordingly — that widening is the app's signal of the uncertainty, not
a rate or a warning. The attrition adjustment built into the
longitudinal weights corrects *who* the retained group stands for (the
people who were not re-interviewed differ, on average, from those who
were), but it cannot add back the people who were not interviewed, so
it narrows the bias, not the interval. Read a country's change together
with its interval and its n: a wide interval around a small change is a
country whose follow-up group was thin, and a comparison between two
such countries deserves the same caution as any comparison of two
uncertain numbers. No follow-up rate is shown in the views — the
interval and the n carry it — and this section is where the picture is
spelled out.

**Where to find the n.** Every row of every data table carries the
unweighted n behind it — for a change figure, the number of complete
pairs — and the CSV export repeats it, alongside the Wave 1 n in the
Atlas's own table for the same measure. The Codebook's "Answered, by
country and wave" table gives the full per-variable picture. The
histogram of individual change and the transition matrix ("of the people
who said X in 2023, what did they say in 2024?") are estimated on the same
pairs, with the same per-cell interval and n.

## Medians and correlations

**Quantiles** (like medians) are computed from the weighted cumulative
distribution: the median is the smallest answer at which half the
weighted population sits at or below (R `svyquantile`, `qrule = "math"`).
They are shown **without confidence intervals** for now — survey CIs for
quantiles (Woodruff intervals) are a recorded backlog item.

**Correlations** are weighted Pearson coefficients (or Spearman: ranks
first, then weighted Pearson on the ranks — one of several defensible
definitions of a weighted rank correlation; it reduces to the classical
one when weights are equal). They are shown as **point estimates without
confidence intervals**: no interval is computed for a correlation, and
the Correlates view draws none — its footnote says so rather than naming
an interval level. A design-based interval (a delta method over the four
totals R's `svyvar` estimates) is the recorded backlog item; a textbook
Fisher-z interval would assume simple random sampling and is not offered.

## Adjusted and unadjusted associations

The Correlates view answers "what travels with this measure?" in two
ways, and the difference between them is the most important thing on
the page.

**Unadjusted** means the plain weighted correlation above: how far two
answers move together across everyone in a country, on a −1 to 1 scale.
A correlation of +0.5 between two 0–10 items says people who score high
on one tend to score high on the other; it says nothing about why.

**Adjusted** means a regression of the outcome on the measure *and a
fixed set of controls*: age band, gender, education (three levels),
employment status and marital status — each entered as a set of
indicator variables — plus a country fixed effect whenever more than one
country is in the frame. The number shown is the measure's coefficient:
for a 0–10 outcome, the change in the outcome (in points of its scale)
associated with a one-unit change in the measure *among people who are
alike on every control*; for a yes/no outcome, the same thing on the
log-odds scale (the model is a weighted logistic regression). Because
measures live on different scales, the view charts the coefficient per
one standard deviation of the measure — the fit you would get by
standardising the measure first, an exact rescaling — so a 0–10 item and
a three-level item can share one ranked list; the data table carries
both quantities. Standard errors are design-based (the same Taylor
linearisation as every mean in the app, applied to the coefficient's
influence values — R `svyglm`'s number), and the interval is a 95%
normal interval.

**"Controlling for" is not "accounting for".** Holding five demographics
fixed removes the part of an association that runs through those five
things — a measure that only tracks the outcome because older people
answer both differently will shrink toward zero once age is held fixed.
It does nothing about the hundred things the survey did not ask or the
model does not include: an adjusted coefficient is *still* an
association, among people who happen to be alike on five recorded facts.
Residual confounding remains; the survey is cross-sectional, so nothing
about order in time is learned; and a country fixed effect absorbs every
difference *between* countries, so the pooled coefficient is a
within-country association and says nothing about why countries differ.
The set of controls is the same for every outcome and every measure — it
is never chosen per pair — and each model family has a card
(`docs/model-cards/`, rendered in the app) stating the specification, the
weight, the standard error and the limitations in full.

Two smaller rules the view follows. Yes/no items enter every model as
0/1 indicators of "Yes" (the release codes Yes as 1, No as 2; the derived
screeners code "positive" as 1). And a ranked list leaves out any
measure built from the same answers as the outcome — the flourishing
index and one of its component questions, or two screeners that share an
item — because they are associated by construction, not by anything in
the world; items with no order (nominal codes) have no correlation and
are left out too.

## Associations, not causes

Nothing in this app is a causal estimate. "People who attend services
weekly report higher meaning" is a statement about who reports what, in
one survey, at one time — attendance, meaning, and a hundred unmeasured
things travel together. Adjusted associations control for a fixed set of
demographics, which narrows, but does not close, that gap (see the
section above). The app says "associated with", and means exactly that —
in the deck of the Correlates view and in the footnote of every figure
on it.

## How the API applies all of this

Every `/v1` response says what it did: the `meta` block names the data
version, the weight rule it resolved (by its key in the table above) and
the weight column, the SE method, the serving policy (no suppression by
default — ADR-0011), and the unweighted counts behind the estimate — and
each row repeats the weight, n and CI, so a number can never be quoted
without its context. The API never chooses a weight itself; it looks the rule up in
the table, which is also served verbatim at `/v1/meta`. Subgroup filters
are applied as domains (the design is kept whole), and requests that
don't make sense — a question not asked at that wave, a statistic that
doesn't fit the scale, pooling countries without saying so — are refused
with an explanation rather than answered wrongly. The precomputed files
behind the app's common views carry the identical structure, produced by
the same engine at build time.

## Verified against R

The engine is cross-checked against R's `survey` package on **36
estimates** spanning the designs that make survey inference hard:
self-representing countries, countries with lonely PSUs (Brazil, Israel),
genuinely clustered samples (Egypt, Kenya, India, Nigeria, the
Philippines), subgroup estimates, all five weights, the standalone-midyear
restriction, proportions, a median, a correlation, a full transition
matrix, and six `svyglm` coefficients — the adjusted models above, a
continuous and a binary outcome, with and without a subgroup, in a
clustered design and the self-representing United States. The case list
is `stats/verify/cases.csv`; the committed reference
(`stats/verify/reference.json`, aggregates only) records the R and
`survey` versions and the data version it was computed from; `make
parity` regenerates and re-checks it. Tolerances: point estimates and
coefficients agree within 10⁻⁹, standard errors within one part in 10⁶,
medians exactly.

## Data

Global Flourishing Study, Waves 1–2 (2023–2024), with the midyear survey.
Center for Open Science / Gallup / Harvard Human Flourishing Program /
Baylor Institute for Global Human Flourishing.
<https://doi.org/10.17605/OSF.IO/3JTZ8>. Study profile: VanderWeele et
al., *Nature Mental Health* (2025). The app displays the exact data
version (from `data/manifest.json`) in its footer; this repository
contains no microdata, and the app serves aggregates only.
