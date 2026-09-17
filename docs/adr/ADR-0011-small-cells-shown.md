# ADR-0011: Small cells are shown, not withheld

**Status:** Accepted · **Date:** 2026-09-17 · **Phase:** post-4 (design fixes, round two)

## Context

From Phase 2 the serving pipeline applied small-cell suppression
(proposal §3.7): cells with unweighted n below 50 were withheld (the n
stayed visible) and cells of 50–99 were flagged. The rule existed for
two reasons. First, **disclosure risk**: the app republishes aggregates
of a restricted-use survey, and very small cells edge toward describing
individuals. Second, **statistical honesty**: a mean of a dozen people
carries an uncertainty that a casual reader may not price in.

Using the shipped app, the owner found the rule doing more harm than
good in practice: deep breakdowns of a 207,919-person study produced
walls of "withheld (n = …)" where the interesting variation lives, and
the estimates behind them are already survey-weighted aggregates with
design-based intervals — the data-use terms require aggregates, not a
particular cell-size floor, and the app never serves microdata either
way.

## Decision

**Every cell is served and rendered, however small.** This is a change
of default policy, not a removal of capability:

- `flourish_stats.suppression` is untouched; the new
  `NO_SUPPRESSION = SuppressionPolicy(threshold=0, flag_below=0)` makes
  the arithmetic vacuous (`n < 0` is never true, so nothing is
  suppressed or flagged), and `DEFAULT_POLICY` (50/100) plus every test
  proving it still exist.
- The API builds one policy at startup from
  `FA_SUPPRESSION_THRESHOLD` / `FA_SUPPRESSION_FLAG_BELOW` (default 0/0)
  and passes it to every estimator call; `ResponseMeta.suppression` and
  `/v1/meta` keep reporting the active thresholds — they now carry
  zeros. Setting `FA_SUPPRESSION_THRESHOLD=50` restores the old rule at
  request time, and a test proves it.
- The static exporter takes the same policy (default `NO_SUPPRESSION`).
  **The precomputed tier bakes the decision in at build time**, so a
  policy change needs a `make data` locally and a `data-build.yml`
  re-run before deploy.

What replaces the rule is context that never leaves a number's side:

- **n on every row** — in the data table, the tooltips and the CSV — so
  a reader can see what a number rests on.
- **Intervals that widen honestly.** Small cells carry wide CIs; that is
  the uncertainty story, told quantitatively instead of by censoring.
- **A missing interval is data too.** A cell resting on a lone PSU in a
  stratum has no computable SE; the UI renders "—" for the interval —
  never a zero-width whisker or an invented bound — and the tooltip says
  "no interval (single sampling unit)".

The front end no longer carries suppression rendering (hatched stubs,
"withheld (n = …)" text, the † flag); if the env var is ever used to
re-enable suppression, withheld cells arrive with null estimates and
render as "—" without further explanation — acceptable for an
emergency knob, revisit if it becomes a mode.

## Consequences

Easier: deep breakdowns are readable end to end; the chart, table and
CSV agree; no special-cased marks in four chart components. Harder: the
disclosure-risk posture now rests on "aggregates only" plus the survey's
own design (weights, strata) rather than a cell-size floor — if the
study's terms ever demand a floor, `FA_SUPPRESSION_*` plus one exporter
run restores it in an afternoon. Readers can now quote a 5-person cell;
the n and the interval beside it are the defence the app chose.
