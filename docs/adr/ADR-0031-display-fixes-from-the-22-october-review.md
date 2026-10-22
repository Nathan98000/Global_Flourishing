# ADR-0031: Display fixes from the 22 October review — thin estimates flagged at 30, no zero-width intervals, Segments in each country's own order, What Matters in equal-count steps

**Status:** Accepted · **Date:** 2026-10-22 · **Phase:** 7

Revises, in ADR-0011, the serving policy's flag (`flag_below` 0 → 30;
every cell is still shown). Revises, in ADR-0030, §1's equal-step window
for What Matters' matrix. Records how Segments orders its countries,
which never had an ADR.

Related: ADR-0010 (fitted windows), ADR-0011 (every cell shown), ADR-0017
(Segments), ADR-0019 (asterisks for thin estimates on Correlates),
ADR-0022 and ADR-0024 (the hover card), ADR-0030 (What Matters on one
range).

## Context

The second design review (`docs/reviews/design-2026-10-22.md`) found the
app saying "sure" where it should say "unsure":

- **Nothing outside Correlates was ever flagged (G2).** ADR-0011's serving
  policy set both thresholds to 0, so `flagged` was false on every row.
  1,602 of the 73,653 group means served rest on one person, and 34
  country estimates do. A one-person estimate came out as [9.00, 9.00]:
  no whisker at all — the look the new chart key teaches a reader to
  read as "very certain". On the Atlas, "Taoist teachings important"
  (2023) put four one-person countries at the top at 10.0 [10.0, 10.0].
- **Segments ordered its countries by a client-side average of group
  means (G1)**, so one person in Egypt who preferred not to give a gender
  (9.00) put Egypt first under "Highest first".
- **What Matters' one range (ADR-0030) put 126 of its 161 cells in its two
  darkest shades (G15)**: Sweden's 2.76 for religious life stretched the
  window, and the differences between 8 and 9.6 — most of the grid — all
  but vanished.

## Decision

1. **Thin estimates are flagged at 30 people.** The serving policy is
   `flourish_stats.SERVING_POLICY = SuppressionPolicy(threshold=0,
   flag_below=30)`: nothing is withheld (ADR-0011 stands), and an
   estimate with fewer than 30 people behind it is flagged. The API's
   `FA_SUPPRESSION_FLAG_BELOW` defaults to it and the static exporter
   bakes it in; `meta.suppression` says `{threshold: 0, flag_below: 30}`.
   Thirty is Correlates' cell rule too (`FA_PAIR_CELL_FLAG_BELOW`).
2. **A share is flagged by its group's answerers.** A share's `n` stays
   the people who gave that answer (the cell the suppression threshold
   protects, and what the card counts), but its flag counts the people in
   the group who answered the question — the share's denominator, which
   the engine knows (`n_base`, never served). A 0.5% share of 1,000
   people is well measured and not flagged; every share of a 20-person
   group is. A row with no estimate has nothing to flag.
3. **No interval of zero width.** When an estimate's SE is zero up to
   floating point (one person, or every answer in the cell the same —
   including a share of exactly 0% or 100%), the server serves
   `ci_lo = ci_hi = null`; the SE stays as computed. The card says why
   there is no interval.

## Consequences

- The static tier must be rebuilt (`flourish-pipeline run --from
  aggregate`, then the release's Data build) for the files to carry the
  flags and the missing intervals; the API applies both at once.
- Correlates already flagged pairs under its own floors (ADR-0019,
  ADR-0020); its precomputed rows now flag exactly as `finalize` does.
- The CSV's suppression line reads "none (all cells shown); n<30 flagged".
- **Not decided here:** an interval that runs past a scale's end (Mexico's
  [7.38, 11.50] on a 0–10 scale, from two people) is a statistics question
  — a different interval method for small or bounded cells — left open.
