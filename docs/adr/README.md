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
| [ADR-0010](ADR-0010-frontend-rendering-stack.md) | Front-end rendering stack | Accepted |
| [ADR-0011](ADR-0011-small-cells-shown.md) | Small cells are shown, not withheld (policy default; env-restorable) | Accepted |
| [ADR-0012](ADR-0012-visual-identity.md) | Visual identity — warm paper, serif structure, quiet controls | Accepted |
| [ADR-0013](ADR-0013-phase-5-serving-and-display.md) | Phase 5 — API-only views, a progress affordance that is not a spinner, retention kept off the screen | Accepted |
| [ADR-0014](ADR-0014-adjusted-associations.md) | Phase 6 — adjusted associations on numpy, the `svyglm` sandwich, a fixed control set, ranked correlations without intervals | Accepted |
| [ADR-0015](ADR-0015-label-aligned-signs-and-display-rules.md) | Signed statistics follow the label; categorical change in share; a ranking floor; binned derived scores | Accepted |
| [ADR-0016](ADR-0016-home-page-design-pass.md) | The home-page design pass — no world map, interval-only tooltips, no orient checkbox, scale endpoints, server-owned subtopics | Accepted |
| [ADR-0017](ADR-0017-compare-retired-segments.md) | Compare retired as redundant with a single-country split; Breakdowns renamed Segments; the old addresses redirect | Accepted |
| [ADR-0018](ADR-0018-correlates-views-and-adjusted-off.md) | Correlates in four views (a ranked list, across countries, two questions side by side, a table of several); overlap left out of the ranking; two pair endpoints; the adjusted models off the page and off by default | Accepted |
