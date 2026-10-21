# ADR-0022: Charts without data tables; hover cards that name the statistic and carry its CI and n

**Status:** Accepted · **Date:** 2026-10-21 · **Phase:** 7

Supersedes ADR-0016 decision 2 (cards carry the interval only, in
`ciText`'s `95% CI [a, b]`; the n lives in the data table) and ADR-0019's
"no n in any tooltip"; and, in ADR-0012, "the one bordered surface left
in the chart block is the expanded data table". ADR-0019's asterisks and
ADR-0020's coverage line stand.

## Context

The owner asked on 21 October 2026 to remove the data tables from every
page — the graphs are enough by themselves — and to make the hover cards
on a graph's data points easier to understand. A first pass kept the
tables for screen readers only and called the interval a "likely range";
the owner then asked for the tables to be deleted entirely, for "mean"
and "median" where they apply instead of "average", for the interval as
`CI: [X, Y]`, and allowed sample sizes in the cards if they read easily.

Every chart sat in a `ChartFigure` whose "Data table" disclosure held its
numbers with their n. The cards read "7.71  Philippines / 95% CI [7.66,
7.76]" — value first, jargon second.

## Decision

1. **No data table, anywhere.** `ChartFigure` renders the chart, its
   caption and its footnote; `EstimateTable` is deleted, and the chart
   summaries no longer promise a table. The CSV keeps every number; the
   footnote says to hover a mark for its sample size.
2. **One card format** (`charts/theme.ts` `tipText`), its first line set
   apart in ink at 600:
   - the heading — what the mark is (a country, a state, a cell) — and,
     where needed, a line placing it ("Age band: 30–39", a period, a
     pooled state's group);
   - the value as what it is: "Mean: 7.71 on a 0–10 scale", "Median:
     8.00", "45.0% answered “Yes”", "23.0% scored 7–8", "Mean change:
     +0.05", "Change in share: +3.2 percentage points", "Correlation:
     +0.25*";
   - the interval as `CI: [7.66, 7.76]` (the footnote names its level);
     none for a statistic shipped without one (a median, a plain
     correlation), "CI: none (one sampling unit only)" where it cannot be
     computed;
   - the unweighted n in words, saying what it counts: "Based on 1,204
     people" (a mean, a median), "… who answered both times" (a change),
     "… who answered both" (a correlation; an average's n summed over its
     countries). On a share's row the n counts the people who gave that
     answer — the engine's `proportion_records` — so a share's card says
     "312 people in the sample gave this answer", a transition cell's
     "… made this move", a Compare two cell's "… gave both answers".
3. **Two renderers, one look.** Plot's tips keep their title-string
   content and get the heading from a render transform in `TIP_OPTIONS`
   that sets the first line's weight before Plot measures the box; the
   HTML cards (the matrices, the Correlates list's rows) draw the same
   lines (`TipCard.tsx`, `tipLines.ts`). Cards are 13px (`--text-sm`) at
   line height 1.3; `format.ts ciText` is gone.

## Alternatives considered

- **Keep the table for screen readers only** (the first pass) — the
  owner asked for it gone; the summaries and the CSV remain the
  non-visual path.
- **The share's denominator as its n** — not on the row (the engine
  ships the count at the level); summing the levels' counts in the
  client would make the front end compute what the server should say.
- **Plot's channel-based tips** (bold label, value) — a label per
  channel cannot hold a per-mark heading or a sentence.

## Consequences

Easier: one card format, learned once; the n is a hover away on every
page. Harder: a screen reader hears each chart's summary, not its every
number — the CSV is the full path. Revisit if the API ships a share's
denominator (the card could then say "of 2,800 asked"), or if readers
want the table back.
