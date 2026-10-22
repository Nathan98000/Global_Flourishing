# ADR-0027: Change shows the overall change, not where people moved

**Status:** Accepted · **Date:** 2026-10-21 · **Phase:** 7

Removes the Change page's "Where people moved between answers" matrix
(Phase 5); the engine and the API still estimate transitions.

## Context

For a categorical item with countries chosen, the Change page drew,
under the change in share, one transition matrix per country: of the
people who gave each answer first, the share giving each answer later.
The owner asked on 21 October 2026 for that section to go — the overall
change is enough.

## Decision

- **No transition matrix on the page.** A categorical item's Change
  view is its change in the share giving the chosen answer, country by
  country, and nothing under it, whatever countries are chosen.
- **The engine is untouched.** `/v1/change` still serves `transition`
  rows (the R parity harness checks a full matrix); the page reads only
  the change in share. The web app's `TransitionTable` and its helpers
  go; the tinted table they were built on stays, renamed `HeatTable`
  after itself.
- A numeric measure's histogram of individual change ("How individual
  answers moved") is not this section and stays.

## Alternatives considered

- **Keep it, folded** — the owner asked for the section to go, not to
  move.

## Consequences

Easier: one chart per categorical item, one thing to read. Harder: who
switched from which answer to which is no longer on the page; the API
still answers it.

## Revised (third design review, 22 October 2026 — ADR-0033)

The API now sends what the page draws. `/v1/change` returns the
transition matrix only with `include=transitions` (an unknown `include`
is a 422); by default a categorical item's response carries its
`change_share` rows and a numeric item's its `change` and
`change_distribution` rows. A categorical Change view was 594 kB
uncompressed, 1,150 of its rows transitions the page stopped drawing.
The engine still computes them, and the R parity harness still checks
a full matrix; a golden pins the `include=transitions` payload.
