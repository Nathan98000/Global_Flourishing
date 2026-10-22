# Architecture Decision Records

MADR-style records of significant decisions. Copy `template.md` to
`ADR-NNNN-short-title.md`, number sequentially, and link the PR that adopted
it.

| ADR | Title | Status |
|---|---|---|
| [ADR-0001](ADR-0001-stack-and-hosting.md) | Stack and hosting | Accepted |
| [ADR-0002](ADR-0002-duckdb-over-postgres.md) | DuckDB over Postgres | Accepted |
| [ADR-0003](ADR-0003-pipeline-engine-and-storage.md) | Pipeline engine and storage layout | Accepted |
| [ADR-0004](ADR-0004-codebook-parsed-not-transcribed.md) | Codebook as source of truth, parsed not transcribed | Accepted |
| [ADR-0005](ADR-0005-stats-as-third-workspace-package.md) | Statistics engine as a third workspace package | Accepted |
| [ADR-0006](ADR-0006-estimator-design.md) | Estimator design — Taylor linearisation matching R `survey` | Accepted |
| [ADR-0007](ADR-0007-api-data-tier.md) | API data tier — baked read-only DuckDB, absent-data mode | Accepted |
| [ADR-0008](ADR-0008-one-envelope-two-tiers.md) | One response envelope for two tiers; request-keyed caching | Accepted |
| [ADR-0009](ADR-0009-static-first-fetch-layer.md) | Static-first fetch layer | Accepted |
| [ADR-0010](ADR-0010-frontend-rendering-stack.md) | Front-end rendering stack | Accepted; the ranked charts' `role="img"` node revised by ADR-0032 (a labelled group) |
| [ADR-0011](ADR-0011-small-cells-shown.md) | Small cells are shown, not withheld (policy default; env-restorable) | Accepted; the flag set at 30 people by ADR-0031 |
| [ADR-0012](ADR-0012-visual-identity.md) | Visual identity — warm paper, serif structure, quiet controls | Accepted; the dark theme removed by ADR-0023 |
| [ADR-0013](ADR-0013-phase-5-serving-and-display.md) | Phase 5 — API-only views, a progress affordance that is not a spinner, retention kept off the screen | Accepted |
| [ADR-0014](ADR-0014-adjusted-associations.md) | Phase 6 — adjusted associations on numpy, the `svyglm` sandwich, a fixed control set, ranked correlations without intervals | Accepted |
| [ADR-0015](ADR-0015-label-aligned-signs-and-display-rules.md) | Signed statistics follow the label; categorical change in share; a ranking floor; binned derived scores | Accepted |
| [ADR-0016](ADR-0016-home-page-design-pass.md) | The home-page design pass — no world map, interval-only tooltips, no orient checkbox, scale endpoints, server-owned subtopics | Accepted; tooltip format and the data table's n superseded by ADR-0022; the two-step picker and its Subtopic step revised by ADR-0029 (the one question picker's browse column) |
| [ADR-0017](ADR-0017-compare-retired-segments.md) | Compare retired as redundant with a single-country split; Breakdowns renamed Segments; the old addresses redirect | Accepted |
| [ADR-0018](ADR-0018-correlates-views-and-adjusted-off.md) | Correlates in four views (a ranked list, across countries, two questions side by side, a table of several); overlap left out of the ranking; two pair endpoints; the adjusted models off the page and off by default | Accepted; views, Compare two's chart, tooltips and dashes superseded by ADR-0019 |
| [ADR-0019](ADR-0019-correlates-organized-by-task.md) | Correlates organized by task: three views with their own pickers, a heat grid for two questions, asterisks for thin estimates, no n in any tooltip | Accepted; flag copy, tooltips and footnotes superseded by ADR-0020; no-n-in-tooltips superseded by ADR-0022; the United States default and the scope toggle revised by ADR-0029 (All countries; one Where); derived scores' bins revised by ADR-0030 (whole-number bands) |
| [ADR-0020](ADR-0020-correlates-all-countries-and-midyear-pairs.md) | Correlates: all countries as the plain average of the countries, each country's correlations precomputed with the image, an All countries list ranking only questions asked in at least half the countries; the midyear survey paired with 2023 or 2024; one note under each chart | Accepted; the note under each chart removed by ADR-0024; the default country revised by ADR-0029 |
| [ADR-0021](ADR-0021-codebook-through-methods.md) | The Codebook reached through Methods, not the nav; Methods written for reading — summaries in bullets, fine print folded, six diagrams, a contents list | Accepted |
| [ADR-0022](ADR-0022-charts-alone-cards-with-ci-and-n.md) | Charts without data tables; hover cards that name the statistic (mean, median, share) and carry `CI: [X, Y]` and the n in words | Accepted; card CI label revised by ADR-0024; the ranked charts' cards opened by keyboard too, their chart node a group, by ADR-0032 |
| [ADR-0023](ADR-0023-light-theme-only.md) | One light theme: the dark theme, its toggle and the OS-preference switch removed | Accepted |
| [ADR-0024](ADR-0024-no-footnote-ci-level-in-cards.md) | No line under the charts (the footnote and the Correlates note removed); the card's interval reads `95% CI: [X, Y]` | Accepted |
| [ADR-0025](ADR-0025-answer-distributions-on-the-atlas.md) | Every answer's share on the Atlas: a categorical question's Distribution as stacked bars, served from its share file | Accepted |
| [ADR-0026](ADR-0026-what-matters-sorted-from-headers.md) | What Matters sorted from its column labels (the corner for country names; again to reverse); its sort drop-down and Order buttons removed | Accepted; extended to every chart and the corner's name sort removed by ADR-0029 |
| [ADR-0027](ADR-0027-change-shows-overall-change.md) | Change shows the overall change alone: the matrix of where people moved between answers removed from the page (the API still serves transitions) | Accepted; transitions served only with `include=transitions` by ADR-0033 |
| [ADR-0028](ADR-0028-every-state-on-its-own.md) | Every US state on its own: respondents keyed by the state they live in (`REGION1`), not the release's four pooled small-state groups | Accepted |
| [ADR-0029](ADR-0029-question-bar-chart-toolbar-one-picker-value-order.md) | Controls: a question bar on top (what, then when and where), a toolbar on the chart (how it's drawn), one question picker, every chart ordered by value and sorted from its value label; Correlates opens on All countries | Accepted; Correlates' Year and Where in the Options sheet on a phone by ADR-0033 |
| [ADR-0030](ADR-0030-display-fixes-from-the-21-october-review.md) | Display fixes from the 21 October review: What Matters shaded on one range, US States opens on the chart (Find a state, the two US figures in a fold), Compare two's derived 0–10 scores in whole-number bands | Accepted; What Matters' equal steps revised by ADR-0031 (equal-count steps) |
| [ADR-0031](ADR-0031-display-fixes-from-the-22-october-review.md) | Display fixes from the 22 October review: thin estimates flagged at 30 people (a share by its group's answerers), no zero-width intervals, Segments in each country's own order, What Matters in equal-count steps | Accepted |
| [ADR-0032](ADR-0032-ranked-chart-rows-read-by-keyboard.md) | A ranked chart's rows read by keyboard — one tab stop, ↑ ↓ Home End, each row's card on focus — its chart node a labelled group, not an image | Accepted; row names carry their values, and Change and Segments read by keyboard, by ADR-0033 |
| [ADR-0033](ADR-0033-fixes-from-the-third-design-review.md) | Fixes from the third design review: keyboard rows on Change and Segments, values in row names, no outage band (nav marks, one health retry), Correlates' answer on a phone's first screen, the question carried by the nav, Segments' rows per country and its phone stepper, gzip and transitions on request | Accepted |
