# ADR-0015: Signed statistics follow the label; categorical change in share; a ranking floor; binned derived scores

- Status: Accepted
- Date: 2026-09-24
- Deciders: repo owner, Claude
- Related: ADR-0004 (curated overrides), ADR-0008 (one envelope, two
  tiers), ADR-0011 (every cell shown, with its n), ADR-0014 (adjusted
  associations), `docs/reviews/ux-qa-2026-09-24.md` (C1–C4, H4–H5, M9)

## Context

The UX/QA review of 24 September found four defects that were data
semantics, not styling:

- **Signed numbers contradicted their labels (C1, C3).** "Feeling down
  or depressed" is coded 1 = Nearly every day … 4 = Not at all, and every
  yes/no item is 1 = Yes / 2 = No. A mean change, a correlation or an
  adjusted coefficient computed on those codes reads backwards: a
  *positive* correlation with the PHQ-2 score for "Little interest or
  pleasure" meant *less* depression. The existing `direction`
  (higher/lower is *better*) does not settle it — it says which end is
  better, not which end is *more of the named thing*.
- **A mean of category codes was served as "change" (C1).** For an
  ordinal ladder ("more than once a week … never") or a yes/no item, the
  mean of the codes is not a quantity anyone can read.
- **The ranked correlates list ranked noise (C2).** With every cell
  shown (ADR-0011), a predictor answered by a handful of people could top
  a country's ranking on a spurious coefficient.
- **Derived scores had a distribution that summed to 9% (C4).** The
  flourishing index is a mean of 0–10 items with values like 7.25; a
  histogram over integer levels counted only exact integers.

## Decision

1. **Polarity lives in the catalog; signed statistics align on it.**
   Every catalog item carries `polarity: ascending | descending`
   (default ascending), set in the overrides from one table of
   `name | display_name | direction | lowest label | highest label`, read
   against the display name alone. Before any signed statistic — the
   within-person change, the individual-change histogram, plain
   correlations, adjusted coefficients — a descending item is reflected
   about its scale (`value′ = min + max − value`), a load-time transform
   in `flourish_stats.io` applied by the API's frame assembly. Means and
   shares are never re-coded. Binary items keep their 0/1 indicator of
   code 1 (the Yes), which already runs upward; derived scores are
   ascending by construction. The API and the static `variables.json`
   both serve `polarity`; the front end reads it (a rise "is better"
   follows from direction and polarity together) and never re-derives it.
2. **A categorical item's change is a change in share.** `/v1/change`
   returns, for every level of a binary/ordinal/nominal item, the paired
   difference of the 0/1 indicator (`stat = change_share`, a fraction the
   view shows in percentage points) with its design-based interval, plus
   the transition matrix; the histogram of individual change and the
   three-point panel are numeric-only. The view reuses Atlas's answer
   level control and its default level.
3. **A ranking floor, as a deliberate exception to ADR-0011.**
   `CORRELATES_MIN_N = 100` (in `flourish_stats.correlations`, overridable
   by `FA_CORRELATES_MIN_N`): the ranked sweep leaves out predictors
   resting on fewer complete cases in every group, and the envelope
   reports `min_n` and `n_excluded`. Named predictors are always served —
   the matrix shows such cells untinted, in muted ink, with the n and the
   reason — so nothing is hidden; only the *ordering* refuses to rest on
   noise.
4. **Continuous derived scores are binned by one rule.**
   `flourish_stats.outcomes.score_bins` distributes a 0–10 derived score
   over ten one-point bins ([0,1) … [9,10], the top bin closed), served
   as `level` = the bin's lower edge and labelled "0–1" … "9–10" through
   the score's value labels. The API's `stat=distribution` and the static
   exporter both bin with it; the contract test pins the shares to 100%
   per country in both tiers.

## Alternatives considered

- **Reusing `direction` for alignment.** Rejected: direction is a value
  judgement (better/worse), polarity a reading of the label; "Feeling
  down or depressed" is higher-is-better *and* descending. Conflating
  them would either flip the codebook's coded means or mislabel change.
- **A `responses_aligned` DuckDB view like `responses_oriented`.**
  Rejected for now: the load-time transform touches fewer files and
  needs no second view; the catalog column still requires a rebuild.
- **Keeping the mean change for ordinal items, on aligned codes.**
  Rejected: an aligned mean of ladder codes is still a mean of ladder
  codes; a share change per answer is what a reader can act on.
- **Ranking everything and warning.** Rejected: a footnote does not stop
  a spurious top entry from being read as the finding.
- **Half-point or quantile bins for derived scores.** Rejected: one-point
  bins match the items' own 0–10 grid and read as the same axis.

## Consequences

- The data must be rebuilt (`make data`, and `data-build.yml` before a
  deploy): `polarity` and the value labels' `short_label` are catalog
  columns.
- Every signed number in the app can now be read from its label; the
  aligned components of the PHQ-2 and GAD-2 correlate positively with
  their scores, and a `built` test pins it on the release.
- Adding a catalog item means deciding its polarity from its endpoint
  labels; the overrides test counts the descending set so a stray
  default is noticed.
- Revisit the ranking floor if the sweep ever runs on pooled countries
  (a country-level floor would then be the wrong unit), and the bin rule
  if a derived score on another scale is added.
