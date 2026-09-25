# What Matters — UX & data-viz review

**Date:** 2026-09-25 · **Build:** local dev, branch `claude/segments`, data `gfs-w2my.0.2.0.23e22391`
**Method:** used the page as a first-time visitor in Chrome at 1470, 1280, 768 and 390 px, light and dark themes; changed every control, hovered cells and bars, followed the on-page links, checked the console. Code was read only to confirm causes.

## Verdict

| Criterion | Score | One line |
|---|---|---|
| Visually coherent and appealing | 3.5 / 5 | Calm, editorial look; undermined by a matrix that is mostly one dark color and a CI style that looks like a rendering glitch. |
| Easy to navigate | 3.5 / 5 | The three on-page links work; the second section is empty until you act, and the only sort control is hidden in a disclosure. |
| Intuitive for a first-time user | 2.5 / 5 | Most of the matrix is off-screen, sorting the top table silently re-sorts the bottom chart, and the scroll hint is not a control. |
| Understandable without technical knowledge | 3 / 5 | Plain labels, but "midyear survey" is never explained and uncertainty is only in hover tooltips. |
| Communicates the data | 2 / 5 | The color scale hides the differences that matter, there is no takeaway, and "Within a country" does not show the ranking shift it promises. |
| Free of obvious bugs | 3 / 5 | Three functional bugs (sort coupling, clipped facet labels, empty facet) plus a dark-mode legend that is wrong. |
| Data site, not corporate dashboard | 4 / 5 | Yes: serif headings, restrained palette, heat table and small multiples are the right forms. |

**Owner decisions (25 Sep):** no takeaways (H4 and the top-item highlight are dropped), and one chart on screen at a time: other charts appear only when the user picks them. Implementation prompt: `docs/prompts/what-matters-2026-09-25.md`.

**Do these five first:** (1) make all seven columns fit (short labels, narrow columns); (2) change the tint so within-item differences show, and add a legend; (3) decouple the bottom chart's sort; (4) add a one-sentence takeaway and mark each country's top item; (5) replace "Within a country" small multiples with a dot plot and give it a default country.

---

## High

### H1 · Most of the main matrix is hidden at every width — Design
- **Seen:** 1470 px shows 3 of 7 columns (table 1585 px inside an 896 px box); 768 px shows 2; 390 px shows **no complete column and no numbers at all** — just colored blocks under a fade.
- **Cause:** column width is set by labels like "Importance: religious or spiritual life" (144–247 px) for a four-character number.
- The hint "4 more things →" is a plain `<p>`: it looks like a link, does nothing on click, and "things" is vague.
- **Fix:** use short labels (Good person · Relationships · Happiness · Health · Meaning · Money · Religion), wrap headers to two lines, fix columns at ~84 px. Seven columns plus a 150 px country column ≈ 740 px, so the whole matrix fits on desktop and tablet. Put "How important is… (0–10)" in the caption instead of repeating "Importance:" seven times. On phones, either allow ~52 px columns with two-line abbreviated headers or switch to one row per country with seven dots on a 0–10 strip. If horizontal scroll remains anywhere, make the hint a button that scrolls the box.

### H2 · The color scale hides the interesting differences — Design
- **Seen:** one ramp spans 2.76–9.65 across all items. The range is set by religion; everything else sits between ~7 and ~9.6, so 78% of cells land in the two darkest steps. "Being a good person" runs 6.84 (Japan) to 9.50 (Argentina), but almost every country looks identical.
- No legend swatch: the caption states a range but not what each step means.
- **Fix:** tint each column on its own range ("darker = higher than other countries on this item"), which answers "where does money matter more?". Add a small stepped legend. Separately, mark each row's top item (bold number or outline) so "what matters most in this country" is visible without reading 161 numbers.

### H3 · Sorting the top table re-sorts the bottom chart — Bug
- **Seen:** choosing *Sort countries → By Importance: money* or flipping *Order* in "By country" also reorders the "Other midyear questions" bar chart, which is two screens away and has no sort control of its own.
- **Cause:** `WhatMattersView.tsx` line ~165 sorts `itemRows` with the same `sortKey`/`dir` as the matrix.
- **Fix:** give the bottom chart its own state (e.g. `qsort`, `qdir`) and its own control; default High → low, since the chart is a ranking.

### H4 · No takeaway — Design
A first-time visitor gets 23 × 7 numbers and has to find the story alone. Add one or two generated sentences above the matrix, e.g. "In every country, relationships, health and being a good person score near the top. Religion varies most: from 2.8 in X to 9.7 in Y." This is also the main thing that makes the page feel like analysis rather than a dashboard.

## Medium

### M1 · "Within a country": long facet labels are clipped — Bug
With *Split by → Employment status*, the longer group names are cut off at the facet edge (the SVG clips overflow). Wrap labels, widen the label gutter, or put the group name above each facet.

### M2 · "Within a country": empty facet — Bug
Japan × Employment status draws a facet titled "Out of work (reserve duty)" with no bars. Drop groups with no estimates, or show "Not asked in Japan".

### M3 · "Within a country" starts empty and doesn't show what it promises — Design
- By default the section shows only "Choose a country to see how the ranking shifts by age band." That's a large blank area on first visit. Default to a country (the US, or the one last chosen elsewhere).
- Once filled, eight stacked dot panels (one per group) make you compare dot positions across panels to see a "ranking shift". The same matrix as "By country" (rows = the split's groups, per-column tint) answers it in one view.
- The page intro says "by country and by age", but the section offers seven splits. Say "by age, gender, income and more".

### M4 · CI styling in "Other midyear questions" looks like a glitch — Design
The interval is drawn with a white halo over the bar, so it reads as a white scratch inside the bar plus a dark tail outside. Use a thin dark whisker with small caps and no halo, or a lighter bar with a darker whisker.

### M5 · Uncertainty only in native `title` tooltips — Design
- Matrix CIs appear only in the browser's native tooltip: about a one-second delay, unstyled, and never shown on touch or keyboard focus.
- This is inconsistent with the Plot tooltips elsewhere on the site.
- **Fix:** use the site's tooltip component on hover *and* focus; make cells focusable; include CI columns in the CSV and data table.

### M6 · Dark mode: the legend is wrong and the ramp changes hue — Bug
In dark mode, high values render pale beige and low values teal, but the caption still says "Deeper tint, higher importance". The beige → teal hue shift also reads as categories rather than amounts. The ramp itself follows the map's convention (lighter = higher on a dark page), so keep it. Replace the caption with a swatch legend drawn from the ramp tokens, labeled Lower → Higher, so it's right in both themes.

### M7 · Sorting by an off-screen column — Design
Sorting by "money" reorders rows by a column the user can't see (at 1470 px it's column 6 of 7), and nothing marks the sorted column. Make column headers the sort control (arrow plus `aria-sort`) and highlight the sorted column. Mostly moot once H1 is fixed.

### M8 · Heading and control clutter in "By country" — Design
- A section heading "By country" sits directly above the chart title "What matters most, by country"; keep one.
- The only control is hidden behind a disclosure called "Options — sort".
- Options read "By Importance: being a good person".
- **Fix:** show an inline "Sort countries by [Country name ▾]" with short item names as options.

## Low

- **L1** The intro lists items in a different order (money, relationships, meaning…) from the columns (good person, relationships, happiness…). Match them.
- **L2** "Midyear survey (Nov 2023–Dec 2024)" is never explained, and "The other midyear questions" assumes you know what that is. Add one line plus a Methods link. Consider renaming the section "More from the midyear survey".
- **L3** Control labels mix layouts: "Question [select]" inline, "Answer level" stacked above a segmented control, "Country" / "Split by" stacked. Pick one.
- **L4** Numbers are right-aligned in wide cells while headers are left-aligned, so each value sits far from its header. Align both (moot after H1).
- **L5** No visible page title: the "What Matters" h2 is visually hidden, and only the nav underline says where you are. Check whether that's intended site-wide.
- **L6** The CSV and data table are long format (161 rows), not the country × item shape shown. Offer the wide shape.
- **L7** Anchor jumps put the heading flush against the top edge. Add `scroll-margin-top: 1rem`.

## What works

- No console errors; no horizontal page overflow at 390 or 768 px; the matrix scrolls inside its own box with a sticky country column.
- On-page anchor links work, and all state (country, split, question, sort) is in the URL, so views are shareable.
- CSV and PNG download on every chart; CIs are drawn on the bar chart.
- The tone suits a data site: serif headings, muted palette, no KPI tiles or gradients.
- Alphabetical default order is predictable for finding a country.

## Things you may not notice because you know the site

1. You know the matrix scrolls sideways. On a Mac with hidden scrollbars, the fade is the only cue, and on a phone you see no numbers at all.
2. You know hovering gives intervals. Nothing on the page says so, and touch users can't get them.
3. You know the sort lives in "Options — sort", and that it also drives the bottom chart.
4. You know what "midyear" means.
5. You know the scale is 0–10. It appears only in the subtitle, not near the numbers.
6. In dark mode the legend describes the opposite of what you see.

## Environment note (not a site bug)

During the 390 px pass, the local static tier briefly served synthetic fixtures ("Testland", one "Importance of money" column). On reload, real data was back and `data/static` matches `apps/web/public/data`. This was most likely a concurrent `make web-fixtures` or test run. If local screenshots look odd, re-run `rsync -a --delete data/static/ apps/web/public/data/`.
