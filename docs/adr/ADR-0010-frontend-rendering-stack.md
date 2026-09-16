# ADR-0010: Front-end rendering stack

**Status:** Accepted · **Date:** 2026-09-16 · **Phase:** 4

## Context

Phase 4 turns the API and the static tier into the public product. The
constraints: charts must carry uncertainty and suppression honestly,
both themes must stay WCAG-AA, the six SFI domain hues are fixed across
every view (proposal §4.4), the initial route has a 250 kB gzipped
budget, and a world map must show all 23 countries — including Hong
Kong, which most world topologies omit or render sub-pixel.

## Decision

**Observable Plot** for every chart, behind thin typed wrappers
(`src/charts/`) that take `EstimateResponse` rows and never fetch. Plot
gives grammar-level marks (bars, rules, dots, facets, geo) with d3
underneath and no runtime the app doesn't already need; wrappers keep
its API at one arm's length.

**Colors are tokens, end to end.** Chart code contains no hex: every
fill/stroke is a literal `var(--token)` string in the SVG, so dark mode
recolors live charts without re-rendering, and PNG export inlines the
computed values at save time. The map's sequential scale is *quantized*
onto the seven discrete ramp tokens — no color interpolation ever needs
a resolved value. A vitest computes WCAG contrast from `tokens.css` for
both themes and pins the dark media block byte-equal to the dark stamp.

**The six domain hues** map onto the dataviz reference palette's
validated slots (happiness=yellow, health=aqua, meaning=violet,
character=blue, relationships=magenta, financial=orange). Validator
results: light worst-adjacent CVD ΔE 9.1 / normal 19.6; dark 8.4 /
19.3; all dark marks ≥ 3:1 on the surface. Three light hues (yellow,
aqua, magenta — and `--series-3`, which shares aqua) sit below 3:1 by
design under the **relief rule**: every chart ships direct labels and a
`<details>` data table, so hue never carries meaning alone. Suppression
is hatch + text; flags are a dagger + text.

**CSS Modules + custom-property tokens** over Tailwind: the token sheet
*is* the design system (two themes in one file, testable), per-component
modules keep styles co-located, and no utility framework's bytes or
naming enter the bundle. Controls are native elements (select/optgroup,
radio groups, `<details>`) — no Radix or combobox re-implementation.

**The map: `world-atlas` countries-50m.** Verified empirically: 110m
has no Hong Kong feature; 50m carries `344 Hong Kong` (and all 23
catalog countries). Cost: 756 kB raw / **230 kB gzipped**, shipped as a
hashed asset fetched only inside the lazy map chunk. Two Natural Earth
sharp edges, found by rendering the real release and now pinned by
tests against the shipped topology: (a) ids repeat — `036` is Australia
*and* Ashmore and Cartier Is., so the join keeps the principal
(largest-extent) feature per id; (b) Hong Kong is ~0.18 sq° — any
feature under 1 sq° gets a labelled centroid marker so no country
silently disappears from a map of 23. Equal-earth projection,
Antarctica dropped, scale anchored to the item's `[min, max]`
(sequential only in Phase 4 — nothing shown so far has an honest
diverging midpoint).

**A second breakdown renders as a facet-column grid, not colors**: past
three levels a categorical palette cannot clear the all-pairs floors,
so identity rides on position (one hue everywhere) and the cap problem
never arises.

**`marked`** renders `docs/METHODS.md` (imported `?raw` — the document
is the single source; a test asserts every H2 reaches the page) inside
the lazy Methods chunk.

New runtime dependencies, all justified above: `@observablehq/plot`,
`topojson-client`, `world-atlas`, `marked`.

## Measured (production build over the synthetic fixture tier)

| Number | Value |
|---|---|
| Initial route (entry JS + CSS, gzipped) | **187.5 kB** (budget ≤ 250 kB) |
| — of which Observable Plot ≈ | ~90 kB |
| Lazy: countries-50m asset | 224.7 kB gz |
| Lazy: Methods (marked + METHODS.md) | 19.1 kB gz |
| Lazy: map / breakdowns / codebook chunks | 3.5 / 3.2 / 1.9 kB gz |
| Lighthouse, mobile emulation (by hand, real build) Atlas | perf 0.98 · a11y 1.00 |
| Lighthouse, mobile emulation Codebook | perf 0.97 · a11y 1.00 |
| Lighthouse, desktop preset (the CI gate) both routes | perf 1.00 · a11y 1.00 |
| Playwright journeys (local) | 6 passed in ~4 s |

The CI gate asserts the unchanged ≥ 0.90 / ≥ 0.95 targets under the
**desktop preset**: mobile emulation multiplies a shared runner's own
slowness by the 4× simulated CPU throttle, and the fixture page's LCP
lands on post-fetch repaints of small content — the same build scored
0.77 on a runner and 0.98 locally, i.e. the number measured the runner.
Mobile numbers above are measured by hand on the real build; the
`aria-prohibited-attr` audit also caught Plot's `aria-label` on plain
`<g>` mark groups, now excluded from the a11y tree (`aria-hidden` on
the SVG — the figure's `role="img"` summary and the data table are the
accessible path).

## Alternatives considered

- **Vega-Lite** — a JSON spec layer plus a larger runtime for charts
  that still need custom suppression marks; more bytes, less control.
- **Recharts / visx** — component-tree charting makes shared scales,
  facets and geo harder; Plot's facet/geo marks are exactly the need.
- **D3 by hand** — maximal control, but every chart re-implements
  scales/axes/facets; Plot is d3 with those solved.
- **Tailwind** — utility classes don't give a testable two-theme token
  sheet; the token file does.
- **Radix primitives** — accessible, but native controls already meet
  the need at zero bytes.
- **countries-110m + centroid dot for HKG** — 38 kB gz instead of
  230 kB, but Hong Kong would exist *only* as a synthetic marker; the
  owner decision (phase prompt §0c) prefers the real feature when one
  exists, and the bytes sit outside the budgeted route.

## Consequences

Easier: new charts inherit theming, suppression rendering, tips and the
table path from `ChartFigure` + `theme.ts`; Phase 5's Compare/Change
views can reuse DotPlot/SmallMultiples as-is. Harder: Plot renders to
an SVG string world — per-mark React interactivity would need a
different approach (fine so far; tips cover it). Revisit the map bytes
if a lighter topology gains an HKG feature, and the facet-grid choice
if a Phase 5 view genuinely needs ≥ 4 colored series (the answer will
still probably be facets).
