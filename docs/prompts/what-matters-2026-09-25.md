# What Matters — 25 September

Implements `docs/reviews/what-matters-2026-09-25.md` for `apps/web/src/views/WhatMattersView.tsx`, with the owner's two decisions below.

## Owner decisions (override the review)

1. **No takeaways.** No generated summary sentences and no highlighting of each row's top item.
2. **One chart on screen at a time.** A view switcher picks the chart. The charts not picked are not rendered. Don't add alternative chart forms, such as a different chart on phones.

## How to work

- Read `CLAUDE.md` once. Touch only the files named here plus the tests and copy they break. Don't re-read files after editing them. No refactors beyond what the tasks need.
- Branch `claude/what-matters` from `main`.
- One conventional commit per task. Include this prompt file and the review in the first commit.
- Open one PR. Don't merge, tag or deploy.
- End with one line per task.

## Tasks

### 1 · One view at a time

- Replace the "On this page" anchor nav and the three stacked sections with one segmented `RadioRow` placed under the lede. Options: **By country** (default) · **Within a country** · **Other questions**.
- Only the selected view's controls and chart mount. The other views' queries don't run; gate them with `enabled`.
- New URL param `view` = `country | within | questions`, default `country`, omitted from the URL when default. Add it in `state/search.ts` the same way as the other params, and add it to `search.test.ts`.
- Old links: on load, `#by-country`, `#within-country` or `#other-questions` selects the matching view. Use replace navigation and drop the hash.
- Delete the section `h3`s and `.anchors` styles; the switcher labels replace them. Each view keeps its `ChartFigure` title.
- Switching views keeps each view's own params.

### 2 · All seven columns fit

- Column label: the variable's `short_label` if set. Otherwise use `display_name` without a leading "Importance: ", with the first letter capitalized ("Being a good person", "Money", …).
  - Add this as a helper in `views/whatMattersRows.ts` with a unit test.
  - Use it for the column headers and the sort options.
- The subtitle says the scale once: "How important, 0–10 · Midyear survey, Nov 2023–Dec 2024".
- In `charts/TransitionTable.tsx` (`HeatTable`), add an optional `columnWidth` prop and let header text wrap. Correlates and Change keep their current widths unless they pass the prop.
  - What Matters passes a width so that 7 columns plus the row-header column fit the content column at ≥ 1024 px with no horizontal scroll (~96 px).
  - On narrow viewports, pass the smallest width at which the short labels wrap to at most three lines. Horizontal scroll with the sticky first column is fine there, but every visible cell must show its number.
- `HeatTable`'s overflow hint becomes a `<button>` that scrolls the box right by its visible width. Label: "N more →". This applies to every `HeatTable`.

### 3 · Tint by column, with a legend

- In `ImportanceMatrix`, shade each column on its own min–max across the rows shown, with one `quantizeSequential` per column.
- Give each column's range a minimum span of 1.0 point, centred on its midpoint. Otherwise tiny gaps (US money by age runs 7.46–7.66) would fill the whole ramp.
- Add a unit test for the per-column ranges, including the minimum span, in `whatMattersRows.ts`.
- Replace the caption "Deeper tint, higher importance (…)" with a legend.
  - The legend is seven swatches drawn from `SEQUENTIAL_RAMP`, labeled "Lower" and "Higher", then "· each column shaded on its own range".
  - Reuse the map's legend from `charts/mapScale.tsx` if it fits; otherwise build a small inline component.
  - Because the swatches come from the tokens, the legend is correct in dark mode.
- Update the figure's `ariaLabel`: drop "deeper tint", and say "item" instead of "thing".

### 4 · Sort: visible, marked, and independent

- **By country:** always show the controls inline; remove the "Options — sort" disclosure.
  - Label: "Sort countries by". Options: "Country name" plus the short labels.
  - The sorted column's header shows ▼ or ▲ and sets `aria-sort`.
  - On narrow viewports, scroll that column into view after a sort.
- **Other questions:** give the chart its own params, `qsort` (`estimate | name`, default `estimate`) and `qdir` (default from `defaultDir`), with the same Sort and Order controls and defaults as Atlas.
  - `itemRows` must stop reading `sort`/`dir`. That coupling is the bug: sorting the matrix re-sorts this chart.
  - Add the params to `search.test.ts`.

### 5 · Within a country uses the same matrix

- Replace `SmallMultiples` here with `ImportanceMatrix`:
  - Rows are the split's groups, in `levelDomain` order.
  - Columns are the same seven items, shaded per column across the groups.
  - Row-header corner: "{Split} ↓ · what matters →".
- Country defaults to the United States: look it up by `iso3 === 'USA'` in meta, falling back to the first country alphabetically. Remove the "Choose a country…" option and the hint.
- Omit groups with no rows at all for that country (e.g. Japan × "Out of work (reserve duty)"). Keep groups that have rows but no estimate or interval (ADR-0011).
- Leave `SmallMultiples.tsx` untouched; Segments uses it.

### 6 · Matrix tooltips

- Replace `HeatTable`'s native `title` with a styled tooltip that matches the Plot tips (`TIP_OPTIONS` colors and type).
  - It appears immediately on pointer hover, and on tap for touch.
  - Content is the same as today: value, row · column, interval.
  - Don't make the cells tab stops. Confirm that the data table under each figure carries the interval.
- This applies to every `HeatTable`.

### 7 · CI whisker on bars

In `charts/theme.ts` `whiskerOverBars`:

- Drop the surface-coloured halo.
- Draw one `INK` rule at 1.25 px with short end caps (~6 px).
- Update the doc comment.
- Check contrast on Atlas and on What Matters › Other questions, in light and dark themes.

### 8 · Copy and control layout

- **Long lede**, built from the items in column order and their count (no hard-coded names):
  > How important people say {n} things are in their lives, rated 0–10: {list}. From the midyear survey (Nov 2023–Dec 2024), a short questionnaire between the two annual waves.
- **Short lede:**
  > How important people say {n} things are in their lives, rated 0–10, in the midyear survey.
- Don't mention administration modes; the comment in the What Matters Playwright journey explains why.
- Every control on this page uses a stacked label above the control, as `RadioRow`'s legend does. Remove the inline "Question [select]" / "Country [select]" pattern here.

## Verification

- **Per task:** run only the affected vitest files.
- Update the What Matters Playwright journey (`e2e/journeys.spec.ts` ~line 303) so that:
  - the default view shows the matrix;
  - Within a country shows the United States by default;
  - Other questions shows the bar chart;
  - exactly one `ChartFigure` is on screen in every view.
- **End, once:** `make lint typecheck`, `pnpm -C apps/web vitest run`, and the Playwright journeys.
- Then take Playwright screenshots of each view at 1470, 768 and 390 px, in light and dark themes. Don't commit them. Look at them and confirm:
  - all seven columns are visible at 1470 px;
  - visible cells show numbers at 390 px;
  - the legend is correct in dark mode;
  - there is no horizontal page overflow.
- Push and open the PR.
