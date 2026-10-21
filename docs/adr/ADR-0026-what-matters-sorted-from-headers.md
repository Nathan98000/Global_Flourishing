# ADR-0026: What Matters sorted from its column labels

**Status:** Accepted · **Date:** 2026-10-21 · **Phase:** 7

Revises how the By country matrix is sorted (the "Sort countries by"
drop-down and the Order buttons of the What Matters PR, ADR-0018's
sort column); the URL state (`sort`, `dir`) is unchanged.

## Context

The owner asked on 21 October 2026 for What Matters to be sorted by
clicking a column label on the chart — what matters, or by country — a
second click reversing it, and for the drop-down and control buttons to
go.

## Decision

- **The labels are the control.** `HeatTable` takes an `onSort`: every
  column label, and the corner ("Country"), becomes a button. An item's
  label sorts the countries by it, high first; the corner sorts them by
  name, A to Z; the label already sorted on reverses the order. The
  sorted label wears ▼ or ▲ and `aria-sort`, as before, and a new sort
  still scrolls its column into view on a phone.
- **No other sort control.** The By country view loses its drop-down and
  Order buttons; one line under the matrix says how to sort it. The
  links stay what they were (`?sort=MONEY&dir=asc`).
- **A group, not an image.** With buttons inside, the matrix's chart node
  is a labelled group (`ChartFigure interactive`), as the Correlates
  list's is, so assistive tech reaches them.

The Within a country matrix (rows in the demographic's own order) and
the Other questions chart keep their controls.

## Alternatives considered

- **Keep the drop-down beside the headers** — the owner asked for one
  control; two that do the same thing invite doubt about which wins.

## Consequences

Easier: sorting where the eye already is. Harder: a reader who never
hovers a label may not find the sort — the line under the matrix says
it.
