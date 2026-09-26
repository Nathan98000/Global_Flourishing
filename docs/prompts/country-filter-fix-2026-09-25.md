# Country filter: stop the jump — 25 September

**Bug.** On the Atlas, the country button jumps from the start of the second control line (showing "Countries: all 23") to the end of the first line (after picking one country, "Countries: 1").

**Cause.** `.controls` in `views/AtlasView.module.css` is a wrapping flex row, and the trigger in `components/controls/CountryFilter.module.css` is `width: fit-content`. The label's width therefore decides whether the button fits on line one.

A second problem: the panel is `position: absolute` and anchored left, so when the trigger sits at the right edge the panel sticks out past the page column.

## How to work

- Read `CLAUDE.md` once. Touch only `components/controls/CountryFilter.tsx`, its CSS module, and the tests and copy named below.
- Don't re-read files after editing them. No refactors.
- If branch `claude/home-page-design` exists, commit there (same PR). Otherwise branch `claude/country-filter` from `main` and open a PR.
- Don't merge, tag or deploy.
- End with one line per change.

## Changes (shared component, so it fixes Atlas, Change, Compare and Breakdowns)

1. **Label it like the other controls.**
   - Add a visible "Countries" label above the trigger, using the same label style as the `RadioRow` groups (Wave, Sort, Order), so it lines up with them.
   - Shorten the trigger text:

     | State | Trigger text |
     |---|---|
     | All countries | `All 23` |
     | Some selected | `3 selected` |
     | Capped selection | `3 of 5 selected` |
     | Capped, none selected | `Choose up to 5` |

   - The accessible name still includes "Countries".
2. **Stable width.** Give the trigger a `min-width` that fits the longest of those strings, so a selection change never changes its width and never moves it to another line.
3. **Keep the panel inside the page.**
   - Cap its width: `max-width: min(20rem, calc(100vw - 2 * var(--space-4)))`.
   - On open, if a left-anchored panel would overflow its page column, anchor it to the trigger's right edge instead (`right: 0; left: auto`).
   - Select all, Clear, outside-click and Escape behave exactly as now.
4. **Copy and tests that name the old text.**
   - Update the Atlas distribution empty state and Change's "pick up to four countries" prompt to refer to the "Countries" control.
   - Grep for `Countries: all` and `Countries: ` in `src` and `e2e`, and update the matches.

## Tests

- **Vitest:** the trigger text for all four states above.
- **Playwright** (add to an existing Atlas journey):
  - At 1280 px, the trigger's bounding box is unchanged (±2 px) before and after ticking one country.
  - With the panel open, its right edge is ≤ the `main` column's right edge, at 1280 px and at 390 px.
- **End:** `pnpm -C apps/web vitest run`, `make lint typecheck`, and the Playwright journeys. Then push.
