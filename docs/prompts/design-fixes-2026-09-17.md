# Design fixes, round two — 17 September

Twelve changes the owner asked for after using the app that shipped in PRs #30 and #31. Two of them are not front-end-only: one changes a data-governance policy across all three Python packages and the precomputed tier, and one needs a new field on the derived-score registry and the API. Read §0 before touching anything.

Same repo conventions as always (`CLAUDE.md`): conventional commits, tests beside code, ADR for a significant decision, never commit data.

## Ground rules

| Constraint | Where it bites |
|---|---|
| Initial route ≤ 250 kB gzipped | `pnpm -C apps/web budget` |
| Lighthouse performance ≥ 90, accessibility ≥ 95 | `lighthouserc.cjs` in CI |
| Token contrast pairs are unit-tested | `src/__tests__/tokens.test.ts` |
| Charts read `var(--token)` strings only | CLAUDE.md |
| Six Playwright journeys stay green | `apps/web/e2e/journeys.spec.ts` |
| One envelope, two tiers — API and exporter stay shape-identical | ADR-0008, `services/api/tests/test_static_contract.py` |
| API schema change → `make gen-client`, commit `openapi.json` + `schema.d.ts` | CI drift check |
| Coverage gates: `stats/src` and `services/api/src` ≥ 90% | CI |

**The precomputed tier bakes the suppression decision in.** Small-cell suppression is applied by `flourish_pipeline.aggregate` at build time, so after §1 you must run `make data` locally to see the app behave correctly, and the owner must re-run the `data-build.yml` workflow before the next deploy or production will keep serving the old withheld cells. Say so in the PR description.

## 0. Two things to get right before implementing

**A — turning suppression off is a governance change, not a UI tweak.** It is the owner's call and this prompt implements it, but it must be done as policy, not by deleting the machinery: keep `flourish_stats.suppression` intact and set the serving thresholds to zero, so the rule can be turned back on with an env var. Two consequences to handle rather than ignore: cells of n = 1–5 will now appear, and some of them have **no computable interval** (a lone PSU in a stratum yields a null SE). Render a missing interval as "—", never as a zero-width bar, and keep `n` visible on every row so a reader can see what a number rests on.

**B — Wave 2 follow-up leaves the estimate views entirely.** The owner has decided that follow-up (retention) is not shown with the charts or the data tables at all: not as a callout, not as a column, not as a line under the subtitle. Implement that. It is a deliberate departure from proposal §3.4, which requires coverage alongside any Wave 2 or midyear estimate, so leave one honest trace: a sentence in `docs/METHODS.md` saying the app does not display follow-up next to Wave 2 estimates, that follow-up varies from 23% (Hong Kong) to 90% (China), and that the per-variable, per-country figures remain in the Codebook. Do not remove the Codebook's "Answered, by country and wave" table — that is a different thing, and it stays.

## 1. Show every cell: suppression off (items 3 and 8)

- `stats/src/flourish_stats/suppression.py` — add `NO_SUPPRESSION = SuppressionPolicy(threshold=0, flag_below=0)` with a docstring making the arithmetic explicit (`n < 0` is never true, so nothing is suppressed or flagged). Keep `DEFAULT_POLICY` and every test that proves the 50/100 rule still works when it is asked for; this is a change of default, not a removal of capability.
- `services/api/src/flourish_api/config.py` — `suppression_threshold: int = 0` and `suppression_flag_below: int = 0` (so `FA_SUPPRESSION_THRESHOLD=50` restores the old behaviour). Build one `SuppressionPolicy` at startup; pass it to every estimator call in `routes/aggregate.py`, `routes/change.py`, `routes/states.py`, and report it in `ResponseMeta.suppression` and `/v1/meta` — those fields stay, they just carry zeros.
- `pipeline/src/flourish_pipeline/aggregate.py` — same default, threaded through `export_static(..., policy=...)`; the exported `meta.suppression` matches what the API reports.
- Front end — no row is ever hidden or marked: delete the `Suppressed` component and its styles if nothing renders it any more, drop "withheld"/"flagged" language from chart captions, the data table, the map tip and the CSV header, and render a null estimate or null CI as "—". Keep `n` everywhere it already appears.
- Tests — regenerate the golden files; rewrite the web tests that assert suppression rendering into tests that assert a small cell **appears** with its `n` and no flag; keep `stats/tests/test_suppression.py` as it is and add one API test that `FA_SUPPRESSION_THRESHOLD=50` still suppresses, proving the knob works.
- Docs — **ADR-0011** (small cells are shown, not withheld: what changed, why the old rule existed, what replaces it — n on every row, intervals that widen honestly, the env var that restores it); update `docs/METHODS.md`'s suppression section to describe the new default and to warn readers to read `n`; update the CLAUDE.md line that currently promises suppression, and the README launch-checklist item that says "suppression is rendered, not silently dropped".

## 2. The country picker (items 2 and 10)

- `components/controls/CountryFilter.tsx` — an explicit **Select all** control alongside **Clear**, with the trigger label reporting state ("All 23 countries" / "3 countries"). "Show all" as a bare heading-looking button goes.
- Close the panel on an outside click: a `pointerdown` listener on `document` while it is open, closing the `<details>` and leaving focus alone. Keep the existing Escape handling and its focus return. One vitest case per behaviour (outside click, Escape, Select all, Clear).

## 3. Sorting (items 4, 5, 13)

- Labels are exactly **By value** and **A–Z** (`views/AtlasView.tsx`, `views/BreakdownsView.tsx`).
- Add a reverse control — a direction toggle (ascending/descending) that applies to whichever sort is active, carried in the URL as its own parameter (`dir=asc|desc`, default descending for value and ascending for A–Z, and omitted from the URL when it is the default, per the existing search-codec rule).
- The data table renders in the same order as the chart, direction included. Today it does not; make the ordering a single function both consume (`charts/` or a small `sortRows` helper next to the table) so they cannot drift.

## 4. Captions, callouts and the map (items 6, 7, 9)

- **Item 6** — remove the `OutcomeCoverage` callout from `AtlasView` and `BreakdownsView`, and do not replace it with an inline figure or a table column (§0 B). Delete `components/CoverageBanner.tsx`, `components/OutcomeCoverage.tsx` and `src/coverage.ts` if nothing else uses them, and drop their tests.
- **Item 7** — the chart footnote says only that the intervals are 95% confidence intervals, e.g. "Lines are 95% confidence intervals · weighted so each country's sample stands for its adult population · n shown per row", with a Methods link. No sentence explaining what a confidence interval means.
- **Item 9** — the map tip carries **country, value, and interval** and nothing else; drop `n` and any suppression or weight text from it (`views/MapPanel.tsx` builds the tip string, `charts/Choropleth.tsx` renders it). `n` stays in the data table.

## 5. Derived scores in the Codebook (item 11)

Today `/v1/variables/{name}` for `sfi`, the six `sfi_*` domains and the four screener outcomes returns a display name and a description — no wording, no labels — because the derived branch in `routes/variables.py` has nothing to draw on. Give it something:

- `stats/src/flourish_stats/outcomes.py` — add `components: tuple[str, ...]` to `DerivedOutcome` and fill it from the pipeline's own definitions (`pipeline/src/flourish_pipeline/derive.py`: `SFI_DOMAINS`, `SFI_ITEMS`, `PHQ2_ITEMS`, `GAD2_ITEMS`). Read that file rather than trusting this list: at the time of writing the domains are happiness (`HAPPY`, `LIFE_SAT`), health (`PHYSICAL_HLTH`, `MENTAL_HEALTH`), meaning (`WORTHWHILE`, `LIFE_PURPOSE`), character (`PROMOTE_GOOD`, `GIVE_UP`), plus the relationships and financial pairs; the screeners are `DEPRESSED`/`INTEREST` and `FEEL_ANXIOUS`/`CONTROL_WORRY`. Also carry the scoring rule already implied by `SFI_MIN_ITEMS` and `SCREEN_POSITIVE_AT`.
- `services/api/src/flourish_api/routes/variables.py` and `schemas.py` — `VariableDetail` gains `components: list[VariableDetail]`-shaped entries (name, display name, wording, value labels) for derived outcomes, empty for ordinary ones. Then `make gen-client` and commit both generated files.
- `pipeline/src/flourish_pipeline/aggregate.py` — the static `v1/<name>/variable.json` for derived outcomes carries the same components, so the Codebook works with the API offline.
- `views/CodebookDetailView.tsx` — render the scoring rule, then each component question with its exact wording and its response options, the same way a single variable's detail already renders them.

## 6. Data tables (item 12)

`components/EstimateTable.tsx` shows: the columns that identify the row (country, and the breakdown or answer-option level where the view has one), **Estimate**, the **95% CI**, and **n**. Drop the Weight column and anything else. Keep the caption naming the weight once, above or below the table, so the information is not lost — it just stops being a column on every row.

## Verification

```sh
uv run pytest                                  # goldens, contract, built-data tests
pnpm -C apps/web test
pnpm -C apps/web e2e
pnpm -C apps/web budget
make lint typecheck
make data                                      # rebuild the precomputed tier without suppression
rsync -a --delete data/static/ apps/web/public/data/
make api && make web                           # then look at it
```

Look at, at 390 px and ~800 px, light and dark: the Atlas with a 0–10 mean; a breakdown deep enough to produce n < 50 cells, which must now render with their n and no flag; a Wave 2 view, which must carry no follow-up text anywhere; the map tip; `/codebook/sfi` and `/codebook/phq2_positive`; the country picker (Select all, Clear, Escape, outside click); both sorts in both directions, chart and table agreeing.

## How to land it

Two PRs, each green before it opens:

1. `claude/round2-policy` — §1 (suppression off across engine, API, exporter, tests, docs, ADR-0011) and §5 (derived-score components, API + exporter + client + Codebook view). These are the changes with server and data consequences; land them first so the rebuilt tier is available for the second.
2. `claude/round2-views` — §2 (country picker), §3 (sorting and table order), §4 (callout, caption, map tip), §6 (table columns).

In the second PR's description, list the twelve requests with a line each on how it was satisfied, and call out explicitly: that follow-up coverage no longer appears with estimates and where the trace of that decision lives (§0 B), and that the owner must re-run `data-build.yml` before the next deploy or production keeps serving withheld cells.
