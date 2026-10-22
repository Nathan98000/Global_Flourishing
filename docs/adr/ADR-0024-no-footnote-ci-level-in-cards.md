# ADR-0024: No line under the charts; the CI's level named in every card

**Status:** Accepted · **Date:** 2026-10-21 · **Phase:** 7

Supersedes the footnote under every chart (round-2 item 7, kept by
ADR-0016 and ADR-0022) and ADR-0020's "one note under each chart" on the
Correlates page; revises ADR-0022's card interval from `CI: [X, Y]` to
`95% CI: [X, Y]`.

## Context

Reviewing PR #65, the owner asked on 21 October 2026 to delete the line
under the charts — "Lines are 95% confidence intervals · weighted so
each country's sample stands for its adult population · hover a bar for
its sample size. How these numbers are made" — and for the hover card's
interval to read "95% CI: [X, Y]".

## Decision

- **Nothing under a chart.** `ChartFigure` renders its caption, its
  intro and the chart; `footnoteCopy`, the Methods link under it and the
  Correlates page's note ("Weighted so each country's sample stands for
  its adult population.") are gone, with the props that fed them
  (`response`, `marks`, `unit`, `footnote`, `note`). The one view-specific
  sentence that rode on that line — the US States national-weight
  figure — moves up beside the state-weight figure it is compared with.
- **The level travels with the interval.** A card's interval reads
  "95% CI: [7.66, 7.76]", the level from the row's own `ci_level`
  (`format.ts ciLabel`, never a literal 95); an interval that cannot be
  computed reads "95% CI: none (one sampling unit only)". Medians and
  plain correlations still carry no CI line.

## Alternatives considered

- **Keep the weighting clause, drop the rest** — the owner asked for the
  statement gone; the weighting is explained on Methods, a nav click
  away.

## Consequences

Easier: a chart block that is only its title, its question and its
marks. Harder: a reader learns that a median or a correlation has no
interval only from its card's missing line and from Methods; the
weighting is no longer stated on the data pages. Revisit if readers
misread the whiskers without the legend line.
