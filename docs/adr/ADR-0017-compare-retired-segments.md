# ADR-0017: Compare retired; Breakdowns renamed Segments

**Status:** Accepted · **Date:** 2026-09-25 · **Phase:** 7

## Context

Compare (Phase 5, ADR-0013) set two to five countries — or one
demographic's levels within each — side by side across the six SFI
domains, plus one added measure. In the owner's page review on
25 September 2026 (`docs/prompts/segments-2026-09-25.md`) it proved
redundant: a single-country split is what Breakdowns already does, for
any measure, one panel per country. The same review renamed Breakdowns,
for readers, to Segments.

## Decision

1. **Compare is retired.** Its view, chart, row helpers, URL codec and
   tests go, with everything only Compare used: the country filter's
   five-country cap, the per-entry dot colour, `SFI_DOMAINS` and the
   "Add a measure" styles. This retires the Compare bullet of ADR-0013.
   The API and the static exporter are unchanged.
2. **Breakdowns is called Segments in everything a reader sees**: the
   address `/segments`, the nav label, the tab title ("Segments — Flourish
   Atlas"), the headings and the other views' mentions. Its behaviour,
   URL params and download names (this view's part is `by-country`) are
   unchanged, and so are the internal names (`BreakdownsView`,
   `parseBreakdownsSearch`, `meta.breakdowns`).
3. **The old addresses redirect**, client-side and replacing the history
   entry. `/breakdowns` keeps every param, so a shared link shows the
   same view (an invalid param still raises the notice). `/compare`
   keeps `outcome` and `wave` when the URL codec accepts them and drops
   every other param without a notice.

## Alternatives considered

- **Keep Compare beside Segments.** Two pages would answer the same
  question, and the nav would stay a view longer.
- **Carry all of Compare's params.** Its `countries` chose the units to
  set side by side and its `by` split every domain; on Segments the same
  names filter panels and pick the split. Only the measure and the wave
  mean the same thing on both pages.
- **Rename the code as well.** `meta.breakdowns` comes from `/v1/meta`
  and its static mirror; renaming it for a word readers never see would
  touch the server contract. The router comment and the view's header
  record the two names.

## Consequences

- The nav has eight items. On a phone the primary four are Atlas,
  Change, What Matters and Correlates (Correlates leaves "More"), which
  still fit one 13px row at 390px; the other four sit behind "More".
- The bundle is 4.4 kB gz smaller: the 4.0 kB Compare chunk, and 0.4 kB
  off the initial route (197.9 kB of the 250 kB budget).
- New copy that names this view says Segments and links `/segments`.
- The two redirect routes stay while old links matter; removing one
  sends its links to the not-found page.
