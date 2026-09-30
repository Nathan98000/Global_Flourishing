# Methods

How Flourish Atlas turns 207,919 questionnaires into the numbers on the
screen: which weights are applied and why, how the margins of error are
computed, and how small cells are shown. Everything described here runs
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
countries would count Türkiye's 1,473 respondents the same as the United
States' 38,312. Figures are per-country — and the Correlates page's **All
countries** is the average of the countries' own figures, never one figure
over everyone ([below](#all-countries-the-average-of-the-countries)).

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

## All countries: the average of the countries

On the Correlates page, **All countries** is the plain average of the
countries' own numbers. Each country's estimate is taken on its own
people and its own weights, exactly as when that country is chosen, and
the results are averaged with every country counting the same: Hong Kong
as much as China. The average is of the unrounded numbers on their own
scale (a correlation is not transformed first), so it is exactly what you
get by averaging the dots on the country-by-country chart.

Why not put every country's people into one estimate? Because a
correlation over everyone mixes two things: how answers go together
*within* countries, and how the countries differ *from each other*.
Religious service attendance and life evaluation go together in 20 of the
23 countries, but the countries where more people attend services also
report lower life evaluations on average. One estimate over everyone,
each country weighted to its adult population, reads 0.00; the average of
the countries reads +0.10. The average answers what readers ask of "All
countries": how the relationship typically looks inside a country.

A country that wasn't asked a question drops out of every average that
involves it, and out of the country-by-country chart. The subtitle says
so ("Average of 21 countries (not asked in China or Egypt)", naming the
countries when three or fewer are missing), as does the tooltip of any
row or cell that covers fewer countries than all ("Asked in 21 of 23
countries.").

In Compare two's grid, each cell is the average, over the countries, of
the share of that column's people who gave the row's answer. A country
where nobody gave the column's answer drops out of that column, so every
column still adds to 100%. The bars above the grid are the average of the
countries' shares. The countries are independent samples, so an average
of K countries' estimates has standard error √(Σ SE²) ⁄ K, and its
interval is the usual 95% normal one.

An average's **n** is the complete cases summed over its countries.
Find related ranks a question for All countries when that total reaches
the floor (100) and the average covers at least half the countries: 12 of
the 23, or half of however many a release holds, rounded up. A question
asked in fewer countries cannot stand in a list that speaks for all of
them, but it is never out of reach: it has its list in each country that
asked it, and its average wherever a reader names it (Compare two,
Compare several). Chosen in Find related for All countries, a question
that was itself asked in fewer than half the countries gets a line saying
how many asked it, in place of a list.

The small-sample asterisk marks an average of correlations only when
*every* country in it rests on few people; a grid cell is starred on the
same thresholds as a country's, applied to the summed counts. Each
country's correlation for every pair of questions the views can ask for
is computed when the app is built, by the same estimator the API runs on
demand, and checked equal to it within 10⁻¹²; the averages and both
country-by-country views are read from that file.

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
standard errors (normal-based, like R's `confint` on a `svymean`); the
Correlates page's tooltips call the interval the *likely range*. With
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

## Signed numbers follow the label

Every signed number in the app — a within-person change, a correlation,
an adjusted coefficient — is computed on values arranged so that **higher
means more of what the measure's name says**. The catalog records each
item's *polarity*: whether the highest code or the lowest code is the
most of the named thing. "Feeling down or depressed" is coded 1 = Nearly
every day … 4 = Not at all, so its lowest code is the most depressed;
every 1 = Yes / 2 = No item names its Yes. Before a signed statistic is
taken, such an item is reflected about its scale (value′ = min + max −
value), which keeps its range, its spacing and its non-response. Means
and shares are never re-coded — an average of "Feeling down or
depressed" is still the average of the codes the codebook prints — and
the reflection changes nothing about a statistic's uncertainty, only
the direction its sign reads in. Binary items enter associations as a
0/1 indicator of their Yes, which already runs upward. Derived scores
(the flourishing index and the screeners) run upward by construction.

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

**Categorical items change in share, not in mean.** An item whose
answers are categories — yes/no, an ordered ladder such as "more than
once a week … never" — has no meaningful mean of its codes. For those
the Change view reports, for a chosen answer, the **change in the share
giving it**, in percentage points: the paired difference of a 0/1
indicator (answered it in 2024 minus answered it in 2023), averaged over
the same people with the longitudinal weight, with a design-based
interval. The transition matrix is the individual-level view of such an
item; the histogram of individual change is drawn only for 0–10 scales
and counts.

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

## Distributions of derived scores

The flourishing index and its six domains are means of 0–10 items, so
they take values like 7.25 rather than whole numbers. Their distribution
is shown over ten one-point bins — 0–1, 1–2, … 9–10, the last closed so
a perfect 10 is counted — each bin a weighted share with its own
interval, computed by the same rule in the live service and the
precomputed tier, so the shares of a country sum to 100%. Items coded
0–10 keep their eleven answer bins.

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

**Which measures are ranked.** The Correlates view's ranked list leaves
out any measure resting on fewer than 100 respondents with both answers
in that country (`FA_CORRELATES_MIN_N`; the constant lives with the
other correlates rules in the engine). This is a deliberate exception to
the "every cell shown" rule: the list is an ordering, and an ordering of
noise misleads. The cells themselves are still served — the cross-country
matrix shows each with its value and an asterisk (see "Few people behind
an estimate" below). For All countries the floor reads the complete cases
summed over the countries in the average, and the list ranks only
questions whose average covers at least half the countries
([above](#all-countries-the-average-of-the-countries)); a ranked row
that covers fewer countries than all says how many asked it.

**One construct, once.** A score and the questions it is built from are
associated by construction, so a ranked list never holds two measures
that share answers: of two such measures in the list, only the one built
from more answers stays (the PHQ-2 depression score over its two
questions), and of two built from as many, the score over its yes/no
screen flag. The list then fills up again from further down the ranking,
so it always holds as many measures as it shows; the response names what
stood in for what (`meta.dropped_overlap`). Only measures that made the
list compete: a score ranked below the cut never displaces its own
question.

**Two questions side by side** (Compare two). For two questions in one
country, the view shows a weighted cross-tab of their answers: each
column is one answer to the first question, and each cell is the
weighted share of that column's people who gave the row's answer to the
second — so every column adds to 100%, and a trend reads as a diagonal
band even where few people answered. These are the same proportions,
weights and design-based intervals as every share in the app (a
proportion of the second question within each answer to the first).
Bars above the grid show the weighted share of the people who answered
both who gave each answer to the first question, and the header gives the
two questions' weighted correlation. A question with more than eleven
answers (a count such as age, or a score that is an average of answers)
is cut, on either axis, into equal-width ranges between its weighted 1st
and 99th percentiles — ten ranges for a score, whole-number ranges for a
count — the two end ranges taking in the few people beyond them, and
their labels say so. Both axes run from least to most of what the
question's label names, the most of the second question at the top. The
tints use fixed steps (0, 5, 10, 20, 30, 45 and 60% or more), so a shade
means the same share in every pair. Only shares of people are shown; no
individual's answers ever are. "Country by country" shows the pair's
correlation in each country instead.

**A table of several** (Compare several) sets 2 to 10 questions against
each other in one country: every pair's weighted correlation, as the
ranked list would compute it, on the people who answered both, tinted on
a fixed −1 to 1. A pair built from the same answers is marked and not
computed. "Similar together" orders the questions so those that go
together sit side by side: average-linkage hierarchical clustering on
the distance 1 − |r| (a pair built from the same answers counts as
distance 0, a pair with no estimate as 1), ties broken toward the order
the questions were added.

**Few people behind an estimate.** Every estimate is shown; one that
rests on few people wears an asterisk ("* small sample size") and a
dashed outline, in the chart and in its tooltip. In Compare two a cell is
flagged when
fewer than 30 people gave that pair of answers or its column holds fewer
than 100 (`FA_PAIR_CELL_FLAG_BELOW`, `FA_PAIR_COLUMN_FLAG_BELOW`); a
correlation — a matrix cell, a ranked row — when fewer than 100 people
answered both (`FA_CORRELATES_MIN_N`).

**The midyear survey beside another wave.** The midyear survey's
questions were asked only then, so a correlation between one of them and
another question uses the same people's answers from two interviews:
the midyear question's own answers, and the other question's answers from
2023 or from 2024 (the reader chooses). The pairing decides who is in the
estimate and how they are weighted — both weights calibrate to the Wave 1
population:

| Paired with | People | Weight | Time between the two answers |
|---|---|---|---|
| 2023 | the 131,487 midyear respondents | `w_l1m` | usually 8–12 months |
| 2024 | the 116,038 who also did Wave 2 | `w_l1m2` | the same interview for two in three; about six months for the rest |

For the 2024 pairing, every respondent in China, Hong Kong, Israel,
Japan, Sweden and the United States answered the midyear questions inside
their Wave 2 interview, and in ten other countries every one answered them
about six months before it; the page words the time between the two
answers for the country on screen, from each country's own split. That is why the midyear → Wave 2 *change* is
restricted to standalone midyear interviews (above), and why a
*correlation* is not: two answers given the same day go together or not
like any others. A table of several questions at the midyear survey takes
every pair on the same people — two questions from another wave included
— so such a pair can differ slightly from the same pair at its own wave,
which counts everyone asked then. A pair or table needs at least one
midyear question; Find related ranks, for a midyear question, every
midyear question and every question from the chosen year, and for any
other question the midyear questions only.

## Adjusted and unadjusted associations

Every association on the Correlates page is **unadjusted**: the plain
weighted correlation above. The statistics engine can also compute
**adjusted** associations; they are not on the site (the API offers them
only where a server switches them on, `FA_ADJUSTED_ENABLED`), but the
difference between the two is what "associations, not causes" means, so
both are described here.

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
measures live on different scales, the coefficient is also reported per
one standard deviation of the measure — the fit you would get by
standardising the measure first, an exact rescaling — so a 0–10 item and
a three-level item can share one ranked list. Standard errors are design-based (the same Taylor
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
(`docs/model-cards/`) stating the specification, the weight, the standard
error and the limitations in full.

Two smaller rules the Correlates page follows. Yes/no items enter every
correlation (and model) as 0/1 indicators of "Yes" (the release codes Yes
as 1, No as 2; the derived screeners code "positive" as 1). And a ranked
list leaves out any measure built from the same answers as the outcome —
the flourishing index and one of its component questions, or two
screeners that share an item — because they are associated by
construction, not by anything in the world; items with no order (nominal
codes) have no correlation and are left out too.

## Associations, not causes

Nothing in this app is a causal estimate. "People who attend services
weekly report higher meaning" is a statement about who reports what, in
one survey, at one time — attendance, meaning, and a hundred unmeasured
things travel together. Adjusted associations control for a fixed set of
demographics, which narrows, but does not close, that gap (see the
section above). The app says "associated with", and means exactly that.

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
