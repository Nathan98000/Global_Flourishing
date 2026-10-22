# ADR-0030: Display fixes from the 21 October review — What Matters on one range, US States opens on the chart, whole-number bands in Compare two

**Status:** Accepted · **Date:** 2026-10-22 · **Phase:** 7

Revises, in ADR-0019: §7's "ten equal-width bins for a scale longer than
eleven" for derived 0–10 scores (Compare two's bands). Records two display
choices that never had an ADR: What Matters' per-column shading (PR #53),
and US States opening on the map.

Related: ADR-0010 (fitted windows, `var(--token)` colours), ADR-0011
(every cell shown), ADR-0015 (binned derived scores), ADR-0019 (the
cross-tab and its asterisks), ADR-0028 (every state on its own),
ADR-0029 (the question bar and the chart toolbar).

## Context

The design review of 21 October 2026 (`docs/reviews/design-2026-10-21.md`)
found three places where the display said something the data did not:

- **What Matters' matrix (F2)** shaded each column on its own range, so
  the same tint meant 8.1 in one column and 9.4 in the next. The key had
  to explain it ("each column shaded on its own range"), and a reader
  comparing across columns — the matrix's whole point — was misled.
- **US States (F1, F14)** opened on the map. A choropleth gives Wyoming,
  resting on a few dozen people, the same visual weight as California,
  and shows no interval at all. The page also showed two US figures side
  by side (state weights, national weight) with no word on why.
- **Compare two (F12)** cut a derived 0–10 score into ten equal-width bins
  between its weighted 1st and 99th percentiles, giving bands such as
  "8.1–9.0", "7.1–8.1" and "below 1.4" — numbers on no scale a reader
  knows, which changed from country to country.

## Decision

1. **What Matters' matrix is shaded on one window** fitted to all its
   cells (ADR-0010's fitted-window rule, a minimum span so near-equal
   cells are not stretched to the ramp's ends). One key, "Lower (x) …
   Higher (y)", gives its ends; the same tint is the same value in every
   column. The matrix's columns fill the page column. Choosing "Within a
   country" writes `by=none`, so it opens on the country's ranking; a
   bare `?view=within` link keeps its `age_band` default.
2. **US States opens on the chart.** With no `view` in the URL the page
   shows each state's dot and 95% CI beside the "United States overall"
   reference line (the figure on state weights, with its CI and n);
   `view=map` links keep the map, whose legend row says smaller states
   rest on fewer people and points to the chart. **Find a state** — a
   select in the chart's toolbar listing the states with data, view state
   kept out of the URL — outlines the state in ink on the map, sets its
   row in ink on the chart and pins its hover card until cleared. The
   national-weight figure moves into a fold, "Why two US figures?", under
   the chart's header, its CI and n intact.
3. **Compare two cuts a derived 0–10 score at whole numbers.** For a
   derived score whose `scale_type` is `scale_0_10`
   (`flourish_stats.outcomes`), the edges of the weighted 1st–99th
   percentile range are rounded outward to whole numbers and each band is
   one point wide: "2–3" … "9–10", at most ten. A band holds its lower
   edge. An end band that takes in a tail says so: "below 3", "9 and
   above". Items in whole numbers keep their rule (whole-number-wide
   bins, at most ten); a column resting on few people keeps its asterisk
   (ADR-0019's thresholds, unchanged).

## Alternatives considered

- **Per-column shading with a clearer key.** The key was already the
  problem: a reader should not need it to compare two cells.
- **A per-row (per-country) window for the matrix.** Same flaw turned
  sideways; one window is the only reading where a tint is a value.
- **Map first with intervals as hatching or opacity.** Encoding
  uncertainty on a choropleth is hard to read and still gives area to
  the smallest samples; the chart shows the interval directly.
- **Persist Find a state as `state=OH`.** It would add a parameter for a
  passing highlight that changes no number; a shared link to a state is
  not a need anyone raised.
- **Quantile bands (deciles) for derived scores.** Equal-count bands
  vary by country and still give fractional edges.
- **Fixed bands 0–1 … 9–10 for every country.** Empty bands at the bottom
  in most countries; rounding the fitted range outward keeps the bands
  the data needs.

## Consequences

- A tint in the What Matters matrix now reads the same in every column;
  differences within a column whose values are close are subtler than
  before, which is the honest picture.
- Links to `/states` without `view` change what they show (the chart,
  not the map); `view=map` is unchanged. The URL contract keeps its
  parameter names.
- Compare two's bands for a derived score change labels and count (up to
  ten, one point each). The API's `PairLevelModel` description changed
  ("one whole-number bin"); the generated client was regenerated. The
  bands depend only on the data, so no data rebuild is needed for them.
- Revisit the bands if a derived score on another range appears (the
  rule is for 0–10 scores), or if one-point bands prove too coarse for a
  country whose answers crowd one point.
