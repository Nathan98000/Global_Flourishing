# Design fixes — from the 16 September review

You are implementing the accepted findings of `docs/design-review-2026-09-16.md` in `apps/web`. Read that document first: each finding carries a reproduction URL, the reasoning, and the file to change. Everything in it was accepted, so the scope below is the whole list — but the order matters, because F1 changes what the other work is looking at.

This is **design work on a shipped MVP**, not a new phase. No new views, no Phase 5 work (Change, Compare, What Matters, US States stay out), no statistics changes.

## Ground rules

| Constraint | Where it bites |
|---|---|
| Initial route ≤ 250 kB gzipped (currently 187.5) | `pnpm -C apps/web budget` |
| Lighthouse performance ≥ 90, accessibility ≥ 95 | `lighthouserc.cjs` in CI |
| Token contrast pairs are unit-tested | `src/__tests__/tokens.test.ts` |
| Six SFI domain hues fixed across every view | proposal §4.4 |
| Charts read `var(--token)` strings only — no literal colors | CLAUDE.md |
| Every number keeps its weight, unweighted n and CI; suppression stays rendered | CLAUDE.md, proposal §4.4 |
| No new runtime dependency without an ADR line | ADR-0010 |
| Six Playwright journeys stay green | `apps/web/e2e/journeys.spec.ts` |

Two things the review explicitly rules out: **never truncate a bar's axis** (change the mark instead — that is what F1 says), and **never hide uncertainty, sample size, suppression or the direction label to make a chart cleaner**.

Run the app the way the review did: `rsync -a --delete data/static/ apps/web/public/data/` for the real tier, `make api` in one terminal, `make web` in another. Check your work at 390 px and at ~800 px in both themes — those are the widths the review verified.

## 0. Owner decisions after the wireframe walkthrough (17 September)

These override anything below them, and three of them *remove* work the review proposed.

1. **Choosing a measure is two steps, not one list of 161.** Replace the single `<select>` with **Topic → Measure**: a topic select (the catalog families, with a count on each — Flourishing index & its domains 11, Wellbeing 11, Mental health 5, Physical health & habits 6, Social & civic life 11, Character & personality 11, Religion & spirituality 45, Politics & government 5, Childhood 12, What matters to people 15, Demographics 19), then a measure select holding only that topic's items. Beside them keep a small search field — "or search all 161" — that matches name, display name and question wording and selects a measure directly, setting the topic to match. Both selects are URL state; a shared link that names only the measure infers its topic. Religion is the one oversized topic (45) — leave it whole; search is the escape hatch. Files: `AtlasView.tsx`, `BreakdownsView.tsx`, `components/controls/OutcomePicker.tsx`, `state/searchCodec.ts`.
2. **No sentence explaining the axis window.** The axis tick labels already say where the chart starts, and the subtitle names the scale and direction once: "Average score on a 0–10 scale · higher is better". Do not add "showing 5.5–8.5" or any equivalent gloss.
3. **The question is on the page, not behind a button.** Delete the "Question wording & codes" disclosure and render the wording by default under the chart title: for a single item its verbatim question; for a derived score (the index and its domains) one line saying what it is built from, with a link to the Codebook. Files: `AtlasView.tsx`, `BreakdownsView.tsx`, `components/WordingPanel.tsx`.
4. **No tier indicator anywhere.** Remove the "served from precomputed files" badge and every variant of it — Atlas, Breakdowns, Codebook, variable detail. Delete `components/TierBadge.tsx` and its tests. Which tier answered is an implementation detail; the offline banner already tells a visitor when live queries are unavailable, and it stays.
5. **Page footer carries the citation only.** Drop "associations, not causes" and the data-version string from the footer. The causation caveat stays on the Methods page, where it is explained rather than asserted; the data version stays in the CSV export's comment header and in Methods, where it is reproducibility information rather than furniture.
6. **The confidence-interval sentence was wrong and is now fixed.** The draft copy read "the line through it is the range the true value is 95% likely to sit in" — that is the usual misstatement: a 95% interval is a property of the procedure, not a probability about this particular interval. Use: *"the line through it shows how precise that average is — intervals drawn this way contain the true value 95 times out of 100."* Anywhere else the app glosses a CI, use that framing. `docs/METHODS.md` already states it correctly and needs no change.

The wireframe canvas ("Flourish Atlas — post-review wireframes", in the owner's artifact gallery) shows all six in place, plus the F1 chart change side by side with today's bars.

## 1. F1 — fit the scales to the data

The defect: every scale spans the item's full range while the data occupies a sliver, so all four chart types show rank clearly and magnitude barely. Position and colour encodings do not need a zero baseline; bars do. So change marks and domains, not axes-on-bars.

- `src/charts/RankedBar.tsx` — for `scale_0_10` **means**, render the existing `DotPlot` mark (dot + CI) on a domain padded around the observed min/max across the rows in view; keep zero-based bars for proportions and shares, which already read well (`/?outcome=ATTEND_SVCS&wave=Y1` is the reference for "good"). Per decision 2 the axis tick labels carry the window and the subtitle names the scale and direction once — no explanatory sentence about the range.
- `src/charts/SmallMultiples.tsx` — one shared, data-fitted domain across all panels (shared so panels stay comparable; fitted so the variation is visible), with the shared axis labelled under each panel. No explanatory sentence.
- `src/charts/Choropleth.tsx` — anchor the sequential ramp to the observed range; label both legend ends with their values, title the legend with the measure, and add an explicit "no data" swatch for the countries that are not in the study.
- `src/charts/Histogram.tsx` — fit the y-domain to the tallest bin across the countries being compared, and give the hatched withheld bins a legend entry that names the rule ("hatched = withheld, n < 50").
- While you are in these files, F16: direct-label the values (every row, or every other row if they collide) now that the fitted domain leaves room. The axis currently renders once, under 23 rows.

Update the golden/snapshot expectations and any Playwright assertion that reads a bar geometry. Add a vitest case per chart asserting the domain is data-fitted **and** that the axis renders its minimum and maximum labels — a fitted window that does not say where it starts is the one way this change could mislead.

## 2. F2 + F17 — give the phone a layout

The stylesheet has no width media queries at all. Add them; keep them few.

- `src/components/AppShell.module.css` — `.nav` gets its own full-width row under the brand (`flex-basis: 100%`), a smaller gap, and tap padding on the links so they clear 44 px. This also fixes the "Methods" wrap at ~800 px.
- `AtlasView.module.css`, `BreakdownsView.module.css`, `CodebookView.module.css` — a `@media (max-width: 40rem)` block that reflows the control groups (two-up grid, label inline where it fits) so the chart starts within the first screen at 390×844.
- `src/charts/usePlot.tsx` — derive chart height from row count with a minimum per-row height (≈18 px) instead of from width. A 23-row chart should scroll on a phone, not compress to 6 px labels.
- Country picker rows (`controls/CountryFilter.tsx`) to 44 px at small widths (part of F9).

## 3. F3 — Wave 2 coverage (verify first)

**Do not write code until you have reproduced it with `make api` running.** Open `/?outcome=sfi&wave=Y2` with the API up and see whether `CoverageBanner` renders. Then:

- If it renders with the API and not without, the fix is to source coverage from the static tier, which already carries it — the Codebook detail page renders "Answered, by country and wave" fully offline from `/data/v1/<name>/variable.json`. Point the banner at the same source.
- If it does not render either way, wire it in: every Y2 and MY view shows per-country coverage alongside the estimate (proposal §3.4 — retention runs 23% in Hong Kong to 90% in China, and a Wave 2 comparison without that context is misleading).

Either way, end with a vitest case that fails when a Y2 view renders without coverage.

## 4. F4 + F5 — states and the missing sentence

- `AtlasView.tsx` — "no outcome selected" takes precedence over the offline message: *Choose an outcome to begin*. The API's availability is irrelevant when nothing has been asked for.
- `state/searchCodec.ts` — the invalid-parameter notice lists **every** rejected parameter; today an invalid `outcome` and `wave` are dropped silently while only `stat` is named.
- Collapse the stacked amber blocks: with the offline banner already up, the in-content message should not repeat it.
- `AtlasView.tsx` — one deck line under the h1 saying what this is: the study, 23 countries, 207,919 respondents, 2023–2024, and what the controls do. `--ink-secondary`, `--text-md`. Two of the three audiences arrive cold; the footer citation is two screens away.

## 5. F6–F15 — copy and the minor pile

- **Copy** (F6): offline banner → "Live data service is offline — the standard views still work; filters and medians are unavailable"; "Second breakdown (live query)" → "(needs the live service)"; the chart footnote gets a plain gloss plus a Methods link, using decision 6's interval sentence; `direction: none` on the variable detail becomes plain words. The tier badge is deleted rather than reworded (decision 4). Files: `AppShell.tsx`, `BreakdownsView.tsx`, `ChartFigure.tsx`, `CodebookDetailView.tsx`.
- **F7** — rewrite the opening paragraph of `docs/METHODS.md` so it reads as the page a visitor is on, not as a note about the file ("This page is the source for the in-app Methods view (Phase 4)…"). Keep the document as the single source; do not special-case it in the renderer.
- **F8** — move Atlas's Sort control up into the control row, matching Breakdowns.
- **F9** — country picker: close on Escape and return focus to the trigger; make "Show all" read as the reset button it is; reflect the current selection when a view (e.g. Distribution) is showing one country.
- **F10** — Distribution should carry over the current country selection rather than silently defaulting to Argentina (country code 1); if nothing is selected, ask for a choice.
- **F11** — `white-space: nowrap` on the Codebook's "chart this →" cell.
- **F12** — superseded by decision 4: the badge is removed everywhere rather than repositioned.
- **F13** — scope the offline banner to the data views; it currently shows on Methods and 404.
- **F14** — cap the Methods prose column at ~70ch; leave the data views at the full 68 rem.
- **F15** — make the theme control unambiguous: name the action, or keep the state reading with `aria-pressed` and a segmented look.

## Verification

```sh
pnpm -C apps/web test          # vitest, incl. the contrast and new chart-domain cases
pnpm -C apps/web e2e           # six journeys
pnpm -C apps/web budget        # initial route ≤ 250 kB gz
make lint typecheck
```

Then look at it, starting with the topic → measure picker: `/`, `/?outcome=sfi&wave=Y2`, `/?outcome=LONELY&view=map`, `/?outcome=sfi&wave=Y1&stat=distribution`, `/breakdowns?outcome=sfi&wave=Y1&by=age_band`, `/codebook`, `/methods` — at 390 px and ~800 px, light and dark, once with the API up and once with it down.

## How to land it

Two PRs, conventional commits, each green before it opens:

1. `claude/design-charts` — F1 and F16 (the chart domain work and direct labels), with updated snapshots and the new domain tests.
2. `claude/design-shell` — decisions 1 and 3–5 (topic → measure picker, question on the page, badge and footer removals), F2, F3, F4, F5, F6–F15, plus the METHODS.md paragraph.

Update `docs/adr/ADR-0010-frontend-rendering-stack.md` with a short "Revised (design review, September 2026)" note recording the domain rule — bars keep zero, dots and ramps fit the data, captions always name the full scale — so the next person does not re-litigate it. Close by ticking the findings in `docs/design-review-2026-09-16.md` and saying which, if any, you disagreed with and why.
