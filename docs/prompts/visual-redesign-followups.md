# Visual redesign — follow-ups

**Read this file and nothing else before you start.** It carries the context, the
file/line anchors and the exact values. Do not read `PROPOSAL.md`, the ADRs, the
earlier prompts in this folder, or any file not named below. Do not sweep the repo
for related code — every call site you need is listed. Do not run the data
pipeline, the API, or `make deploy`.

## Context (all you need)

Flourish Atlas is a public explorer for the Global Flourishing Study. Monorepo;
**this task touches `apps/web` only**, plus one README line at the end. React 18 +
TypeScript + Vite, TanStack Router/Query, CSS Modules, Observable Plot for charts.
Design tokens live in `apps/web/src/styles/tokens.css`; light/dark via
`prefers-color-scheme` plus `data-theme`.

A visual redesign shipped in commits `15479c6`, `59b4fa0`, `f7a1769`. Comparing it
against the approved wireframes surfaced **ten corrections**, all of them CSS,
tokens, chart config or copy. **No new components, no new dependencies, no new
routes, no data or statistics changes.** Where a value is given below, use that
value.

Invariants you must not break:

- Initial route ≤ 250 kB gzipped (`pnpm -C apps/web budget`).
- Lighthouse ≥ 90 performance, ≥ 95 accessibility.
- `src/__tests__/tokens.test.ts` parses `tokens.css` for contrast. If a change
  trips it, fix the token — never loosen the test.
- Chart code passes colours as `var(--token)` strings only, never hex literals.
- Six Playwright journeys in `e2e/journeys.spec.ts` stay green. **Items 7 and 9
  change copy those journeys assert on — update the assertions in the same pass**
  (anchors listed under each item).

Work through the items in order; they are independent apart from §2, which is a
sweep that should land before you touch the other CSS.

---

## 1. Segmented groups get an outline and dividers

`src/components/controls/RadioRow.module.css`. `.row` is a bare tinted field
today; restore the frame the wireframe drew.

```css
.row {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--control-bg);
  overflow: hidden;
}

.option + .option {
  border-left: 1px solid var(--border);
}
```

Selected treatment unchanged (`--control-selected` plus
`inset 0 -2px 0 var(--control-rule)`). Keep `overflow: hidden` on `.row` so the
2px selected rule is clipped by the 1px frame rather than doubling it. The
`@media (max-width: 40rem)` block already switches `.row` to a grid — the border
and dividers must survive that switch.

## 2. Reconcile the type scale

`src/styles/tokens.css:51-56` currently defines `--text-xs/sm/base/md/lg/xl`;
`--text-lg` (20px) and `--text-xl` (26px) are **unused** while the redesign's real
sizes sit as px literals at call sites. Replace the ladder with:

```css
--text-xs:    0.75rem;     /* 12 — chart labels, legends, footnote captions */
--text-sm:    0.8125rem;   /* 13 — nav, control labels, buttons, table cells */
--text-base:  0.9375rem;   /* 15 — default UI body */
--text-prose: 1.03125rem;  /* 16.5 — serif reading column (Methods) */
--text-deck:  1.1875rem;   /* 19 — deck lines and the Methods lead */
--text-h2:    1.3125rem;   /* 21 — section headings */
--text-brand: 1.375rem;    /* 22 — wordmark */
--text-h1:    1.75rem;     /* 28 — page and chart titles */
```

Delete `--text-lg` and `--text-xl`. `--text-md` (17px) has exactly three call
sites — `styles.css:48` (`h3`), `components/Stat.module.css:9` (`.estimate`),
`views/CodebookDetailView.module.css:40` (a blockquote). Move each to
`--text-base` or `--text-deck` as it reads best, then delete `--text-md` too.

Then replace every remaining px font-size literal. The complete list:

| File:line | now | use |
|---|---|---|
| `styles.css:39` (`h1`) | 28px | `--text-h1` |
| `styles.css:44` (`h2`) | 21px | `--text-h2` |
| `charts/ChartFigure.module.css:28` (`.title`) | 28px | `--text-h1` |
| `components/AppShell.module.css:27` (wordmark) | 22px | `--text-brand` |
| `views/MethodsView.module.css:12` (`.summary p`) | 19px | `--text-deck` |
| `views/MethodsView.module.css:36` (`.prose`) | 16.5px | `--text-prose` |
| `views/AtlasView.module.css:4` (deck) | 19px | `--text-deck` |
| `components/WordingPanel.module.css:4` (`.panel`) | 14px | `--text-sm` |
| `views/CodebookView.module.css:68` (`thead th`) | 11.5px | `--text-xs` |
| `views/CodebookView.module.css:90` (`.nameCell a`) | 14.5px | `--text-base` |

`styles.css:84` is `font-size: 0.9em` on inline code — leave it. Chart-internal
sizes stay numeric (Plot needs numbers) but come from the same ladder: 11, 12,
13.5.

## 3. Long-label groups become a select under 30rem

The mechanism already exists: `RadioRow` takes `selectOnNarrow` and swaps to a
native `<select>` below `SELECT_VIEWPORT` (`src/useMediaQuery.ts:25`, `30rem`).
It is passed at `views/AtlasView.tsx:200` (Statistic) only. Pass it to the
remaining long-label groups — the ones already marked `wide`:
`views/AtlasView.tsx:329` (Answer level), `views/BreakdownsView.tsx:322` and
`:339`. Same options, same URL state, accessible name still from the legend.

## 4. Axis ticks at 11px

Plot-level `style.fontSize` drops from `'12px'` to `'11px'` in
`charts/DotPlot.tsx`, `RankedBar.tsx`, `Histogram.tsx`, `SmallMultiples.tsx`,
`Choropleth.tsx`. This governs the value axis; row labels get their own size in
§6.

## 5. Methods lead line-height

`views/MethodsView.module.css:13`, `.summary p`: `line-height: 1.5` (was 1.45).

## 6. Row labels larger and darker

Country (and level) labels down the left of every chart are 12px
`--ink-secondary`; the wireframe has them at **13.5px in `--ink`**. That is what
holds the row hierarchy — label and value at comparable weight, the axis quieter
than both. Set the y-axis ticks explicitly — `Plot.axisY({ fontSize: 13.5, fill:
INK })` or the equivalent knob per chart — rather than raising the plot-level
size, which would drag the value axis with it. Applies to `DotPlot`, `RankedBar`
and `SmallMultiples`' facet labels. `INK` is the existing `var(--ink)` export in
`charts/theme.ts:13` — pass that, never a hex literal.

## 7. The chart title drops the wave

`views/AtlasView.tsx:145` builds
`` `${display_name} — ${WAVE_TITLES[wave]}` `` and `views/BreakdownsView.tsx:173`
does the same with the breakdown column. The year then appears in both title and
subtitle and the title wraps to two lines on a phone.

- Title: the measure alone — **`Secure Flourishing Index`** (Breakdowns keeps its
  `× Age group` clause; it loses only the wave).
- Subtitle carries the rest, wave last:
  **`Average score, 0–10 · higher is better · Wave 1, 2023`**.

`scaleSubtitle()` in `src/labels.ts:19` already produces
`Average score on a 0–10 scale · higher is better`. Shorten its range clause to
`, 0–10` and append `` ` · ${WAVE_TITLES[wave]}` `` at the two call sites; change
`WAVE_TITLES` (`views/AtlasView.tsx:39`) to `Wave 1, 2023` / `Midyear survey` /
`Wave 2, 2024` so the parenthesis goes away everywhere at once. Where the
subtitle is currently `undefined` (distribution, and proportion without a level
label) the wave clause still shows.

Tests asserting the old string, all of which need the new title:
`src/__tests__/app.test.tsx:260,296,311`; `e2e/journeys.spec.ts:15,22,30,36,43,57,85,126`.
`src/__tests__/export.test.ts:39-46` only feeds a title into the PNG stamp — leave
it.

## 8. Two controls before the phone fold

Under 40rem (`NARROW_VIEWPORT`) only **Measure** and **Wave** stay visible.
Today `OutcomePicker` renders three fields — Topic, Measure, search — all above
the fold, and the `wide` Answer level group sits outside the disclosure at
`views/AtlasView.tsx:329`.

Give `OutcomePicker` a `fields?: 'all' | 'measure' | 'topic-and-search'` prop
(default `'all'`) that renders that subset; the `query` state lives with the
search field, so the two narrow instances share nothing. Then in `AtlasView` and
`BreakdownsView`, when `narrow`: render `<OutcomePicker fields="measure" />`
above the fold, and `<OutcomePicker fields="topic-and-search" />` first inside
`displayOptions`. Move the Answer level group into `displayOptions` as well.

**Verify by measuring, not by eye**: at 390×844 the chart's `<figure>` top must
sit above 844px from the document top.

## 9. Copy from the wireframe

- **Search control** (`components/controls/OutcomePicker.tsx:110-112` label, `:127` placeholder): label
  **"Or search"**, placeholder **"Search all {n} measures"**. Today the label is
  `or search all {servableCount}` and the placeholder is a list of examples. `n`
  and the Codebook's count must both derive from the one `variables` list rather
  than from two different filters: the Codebook counts every question, the search
  counts the measures it can actually return (`searchMeasures` keeps its
  `servable` filter). If the two numbers differ, that is correct — what must not
  happen is either number being hardcoded. Update
  `src/__tests__/app.test.tsx:167` (`getByLabelText(/or search all/)`).
- **Order options** (`views/AtlasView.tsx:227-240`, and the matching group in
  `BreakdownsView`): **"High to low" / "Low to high"**; **"A to Z" / "Z to A"**.
  Drop the arrow glyphs.
- **Question wording** (`components/WordingPanel.tsx:20`): remove the
  `What this score is` / `What people were asked` mini-label entirely. The
  sentence stands alone; for derived measures it reads **"Mean of the twelve
  index items (at least ten answered)."** followed by the existing
  **"See all twelve questions →"** link. Update `e2e/journeys.spec.ts:60`.
- **Codebook** (`views/CodebookView.tsx`): `<h2>Codebook</h2>` at :102 becomes an
  `<h1>` with the deck **"Every question in the study, with its exact wording,
  its answer options and how many people answered it."** Column headers at
  :186-189 become **Question · Topic · Answers · Asked** (the fifth header stays
  visually hidden). The count line at :176-178 reads **"{n} questions"** when
  unfiltered and **"{n} of {total} questions"** when filtered — update
  `e2e/journeys.spec.ts:49` (`/1 of \d+ variables/`).
- **Answer types** render as words, never catalog codes — `variable.scale_type`
  at `views/CodebookView.tsx:206` and the `Scale` filter options at :167-171:
  `scale_0_10` → **"0–10 scale"**, `binary` → **"Yes / no"**, `ordinal` →
  **"Ordered scale"**, `nominal` → **"Categories"**, `count` → **"Count"**. Put
  the map in `src/topics.ts` beside `TOPIC_NAMES`, with the same
  prettify-the-code fallback so an unknown type cannot break the page.

## 10. The chart spans the column

`charts/usePlot.tsx:13-16` treats the design width as a ceiling, so a dot plot
never exceeds 660px inside a 960px column. Invert it:

```ts
export function chartWidth(designWidth: number, available: number | null): number {
  if (available === null || available <= 0) return designWidth
  return Math.max(300, Math.floor(available))
}
```

Then check each caller: `DotPlot` (660), `RankedBar` (660), `Histogram`
(420–900), `Choropleth` (720), `SmallMultiples` (700/820). A world map at the
full column is fine — confirm the projection still fits its height; confirm facet
panels don't stretch so wide that dots drift away from their labels. If one chart
genuinely needs a ceiling, give **that chart** its own `maxWidth` argument rather
than restoring the global cap.

---

## Verification

```sh
pnpm -C apps/web test && pnpm -C apps/web budget && pnpm -C apps/web e2e
make lint typecheck
```

`e2e` is required this round — items 7 and 9 change asserted copy.

Then look, at 390px and 1280px, both themes: the Atlas chart (full width, 13.5px
row labels, 11px ticks, title without the wave), the phone fold (two controls,
chart in the first screen), a segmented group at 30rem and just below it, the
Codebook headers and answer types, the Methods lead.

## Documents

`docs/adr/ADR-0012-visual-identity.md` already carries a "Revised — 18 September
2026" section recording these decisions, and
`docs/prompts/visual-redesign-2026-09-18.md` already points here — **do not edit
either.** The only doc work left: refresh the README screenshot if the full-width
chart changes it materially.

Commit in logical groups (tokens sweep / controls / charts / copy + tests),
conventional-commit subjects, and stop before pushing.
