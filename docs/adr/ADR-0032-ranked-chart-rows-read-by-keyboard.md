# ADR-0032: A ranked chart's rows read by keyboard; its chart node a labelled group

**Status:** Accepted · **Date:** 2026-10-22 · **Phase:** 7

Revises, for the ranked charts (`charts/RankedBar.tsx`: the Atlas, US
States, What Matters' rankings and its other questions, Compare two
country by country), the chart node's `role="img"` — ADR-0010's choice,
kept by ADR-0022 as the non-visual path beside the CSV. ADR-0018's
labelled group for a chart that holds controls is the precedent.
ADR-0022's no-table rule and its card format stand.

Related: ADR-0010 (SVG out of the accessibility tree), ADR-0018 (the
Correlates list's row buttons), ADR-0022 and ADR-0024 (the hover card),
ADR-0030 (Find a state).

## Context

The second design review (`docs/reviews/design-2026-10-22.md`, G18)
walked every page by keyboard: the controls were all reachable, a mark
never was. Since ADR-0022 removed the data tables, a number's 95% CI and
its n live only in its hover card, so a keyboard user could not read
them at all.

Every chart sat in `ChartFigure`'s `role="img"` node, its summary as the
label. An image's children are presentational: focusable rows inside it
would be hidden from assistive tech, and axe's `nested-interactive` rule
fails them — which would take Lighthouse's accessibility score below the
0.95 gate. PR #68 fixed the rest of the review and left this one out for
that reason.

## Decision

1. **A keyboard reads the rows one by one.** Every ranked chart whose
   rows are not already buttons draws a layer over its plot: a list, one
   list item per row, each a band across the row (label and mark alike)
   named by its label. The chart is **one tab stop** (a roving
   tabindex): ↑ and ↓ move a row, Home and End go to the ends. The row
   in focus shows its ring and opens its card — `tipText`'s words, the
   same as on hover — beside its mark, referenced by `aria-describedby`
   so a screen reader reads it out. Escape closes the card where it
   stands (WCAG 1.4.13).
2. **The tab stop stays where the reader is.** It starts on the first
   row, moves to the found row when Find a state finds one, and survives
   a rebuild of the chart (a resize, a new render): the same row keeps
   the stop, and takes focus back if it had it.
3. **The pointer is unchanged.** The rows never take the pointer; hover
   and tap keep Plot's own tip. Find a state's pinned card stays open,
   and steps aside only while its own row's keyboard card is open.
4. **Those charts are labelled groups.** `ChartFigure` renders them
   `interactive`: `role="group"`, with the same summary as its label.
   A chart with nothing to focus — the distributions, the stacked
   shares, the map, Change, Segments, a matrix without cell buttons —
   stays an image. The chart node carries `data-chart`, so code that
   looks for it (Find a state's scroll) no longer goes by its role.
5. **One layer, two uses.** The Correlates list's row buttons (ADR-0018)
   and the readable rows share the layer and its card (`rowLayer`: the
   row geometry, the card's placement, Escape). The buttons keep their
   own tab stop each and their click.

## Alternatives considered

- **The rows beside the image, not inside it** — they would still have
  to sit over the plot, and would lose the chart's summary as the name
  of what they belong to.
- **A listbox of options** — the keys come for free, but it says the
  rows are a choice, and screen readers call each row "not selected".
- **A grid, or a table for screen readers only** — ADR-0022 removed the
  tables; a one-column grid adds two-axis keys and adds nothing to read.
- **Every row its own tab stop** (as the Correlates list's buttons) —
  23 stops on the Atlas, 50 on US States, before the next control.
- **Focusing Plot's SVG marks** — the SVG stays out of the accessibility
  tree (ADR-0010), and one HTML layer serves dots and bars alike.

## Consequences

Easier: every number on a ranked chart — its value, CI and n — is a key
press away, and a screen reader hears it on focus. Lighthouse
accessibility stays at 1.00 on the Atlas, the Codebook, US States, What
Matters and Compare two's country-by-country chart.

Harder: a `ChartFigure` around a ranked chart must pass `interactive`,
or its rows sit inside an image again; tests find these charts as
groups. In a screen reader's browse mode the arrow keys move the
reader's own cursor, which reads each row's name but not its card; the
card comes with focus. Checked against the accessibility tree and axe,
not a real screen reader.

Revisit if screen-reader testing shows browse mode needs the value in
each row's name, or to give the other dot plots (Change, Segments'
panels) the same rows.

## Revised (third design review, 22 October 2026 — ADR-0033)

The review's H2 and H3 answered this ADR's "revisit" line:

- **A row's name carries its value.** "Indonesia, 8.10" — the value the
  chart prints, from the served row — with ", few people" when flagged
  and ", no estimate" when there is none. A screen reader's browse mode
  now hears the numbers; the card, with the 95% CI and n, stays the
  row's description on focus.
- **Change and Segments read by keyboard too.** The row layer moved to
  `charts/readableRows.ts` and serves the ranked charts, Change's dots
  and Segments' panels. Segments' chart is one tab stop over every
  country: each country a list named by it, ↑ ↓ within it, Home and End
  to its ends, Page Down and Page Up to the same group of the next and
  previous country. Both charts are labelled groups.
- **The Correlates list's buttons** share the one tab stop: ↑ ↓ Home End
  between them, Enter to open the pair (H18).
