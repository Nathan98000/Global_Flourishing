# UX/QA fixes — 24 September

Implement the fixes from `docs/reviews/ux-qa-2026-09-24.md` (finding IDs in brackets). This prompt is self-contained. Open the review only when a task here is ambiguous, and then only the section for that ID.

## How to work (token budget matters)

- Read `CLAUDE.md` once. Don't read `PROPOSAL.md` or ADRs unless a task names one.
- Locate code with `grep` for the quoted strings and paths below. Read only the relevant ranges. Don't re-read a file after editing it.
- Change only what a task needs. No refactors, no new abstractions beyond those named, no speculative extras.
- No browser or screenshots. Verify each workstream with the tests for the files you touched, then run the full suite once at the end (see Verification).
- Branch `claude/ux-qa-fixes`. Make one conventional commit per workstream and open one PR at the end.
- If a step needs built data (`data/parquet/…`) and it is absent, do the code plus the synthetic-DB test, and list the owner step in the PR.
- Final message: per workstream, one line on what changed, plus anything deferred and why. Nothing else.

## Constraints this work hits

| Rule | Consequence |
|---|---|
| Front end computes no statistics and owns no labels | Alignment, bins, min-n, state and pool names, and short level labels are server/catalog-side. The UI only renders them. |
| One envelope, two tiers (ADR-0008) | Any `EstimateResponse`/meta change goes into both the API and the exporter. `services/api/tests/test_static_contract.py` must pass. |
| API schema change | `uv run python -m flourish_api.openapi > apps/web/openapi.json && pnpm -C apps/web gen:api`, and commit both. |
| Weight facts only in `flourish_stats.weights` | The state-weight US reference (WS6) looks its weight up there. |
| Charts use `var(--token)` only; contrast pairs are tested | New colours go in `tokens.css`, both themes, plus `src/__tests__/tokens.test.ts`. |
| Budgets | `pnpm -C apps/web budget`, Lighthouse, and Playwright journeys stay green. |

---

## WS1 · Signed numbers follow the label [C1, C3] — do first

**Invariant:** every signed number (change mean, individual-change histogram, correlation, adjusted coefficient) is computed on values where **higher = more of what `display_name` names**.

- **Catalog.** Add `polarity: ascending | descending` (default `ascending`) to `pipeline/src/flourish_pipeline/overrides/variables.yaml` handling, `VariableInfo`, `/v1/variables`, and static `variables.json`.
  - To set it, run **one** script that prints, for every servable non-derived binary/ordinal/0–10/count item: `name | display_name | direction | lowest valid code label | highest valid code label`. Decide from that table alone.
  - Set `descending` where the lowest code is the most of the named thing. Known cases: `DEPRESSED`, `FEEL_ANXIOUS`, `INTEREST`, `CONTROL_WORRY` (1 = Nearly every day), `CAPABLE`, `LIFE_BALANCE` (1 = Always), `ATTEND_SVCS` (1 = More than once a week), `TRAITS1–10` (1 = Agree strongly), `CLOSE_TO` and other 1 = Yes / 2 = No items.
  - Don't rename display names. Derived scores stay `ascending`.
- **Alignment.** Implement it the way the existing `oriented` path works (`derive.py` `responses_oriented` view + `stats/src/flourish_stats/io.py` flag), or as a load-time transform in `io.py` if that avoids a data rebuild. Choose whichever touches fewer files. The transform is `value' = min + max − value` for `descending` items.
- **Change** (`services/api/src/flourish_api/routes/change.py`, `stats/.../panel.py`, `apps/web/src/views/ChangeView.tsx`, `charts/ChangeDots.tsx`, `charts/Histogram.tsx`):
  - `scale_0_10`/`count`: mean change on aligned values.
  - `binary`/`ordinal`: the main chart shows the **change in share answering a chosen level, in percentage points** (paired difference of a 0/1 indicator), with a CI. Reuse Atlas's "Answer level" control; the default level is the one Atlas defaults to. Subtitle: `Change in share answering "<level>", percentage points · 2023 → 2024`. Value labels and axis are in pp.
  - The individual-change histogram shows only for `scale_0_10`/`count` (aligned). For `binary`/`ordinal`, the transition table is the individual-level view.
- **Correlates** (`routes/correlates.py`, `stats/.../correlations.py`): align the outcome and every predictor, in both the plain and adjusted models. Binary predictors stay 0/1 = the "Yes"/first level, as the model card already says.
- **Tests:**
  - Aligned vs raw correlation flips sign for a `descending` item.
  - The aligned components of PHQ-2 (`DEPRESSED`, `INTEREST`) and GAD-2 (`FEEL_ANXIOUS`, `CONTROL_WORRY`) correlate **positively** with their derived score. Use the synthetic DB if it derives them; otherwise test the alignment function directly.
  - Change for a binary item returns pp and the right sign.

## WS2 · Correlates: minimum n, framing, matrix [C2, H5, H4]

- **Minimum n.** Add a `CORRELATES_MIN_N = 100` constant next to the other correlates constants in `flourish_stats`, overridable via `FA_CORRELATES_MIN_N` in `config.py`.
  - The ranked list excludes predictors with n < min in that country.
  - Add `min_n` and `n_excluded` to the correlates meta. This is an envelope change (see Constraints).
  - Footnote: "N measures with fewer than 100 respondents are not ranked."
  - In the matrix, cells below the minimum are untinted and in muted ink, and their tooltip says "n = 7 — too few to rank".
- **Adjusted framing.**
  - Toggle labels: "Correlation" / "Adjusted difference".
  - Subtitle states the unit ("<outcome> points per 1 SD of each measure") and the control set, with control names taken from the server.
  - Add an axis title, and use a fitted domain rather than a fixed −1…1.
  - Add a one-line hint for Pearson/Spearman.
  - Default country: United States.
- **Matrix** (the generic tinted matrix used by `CorrelatesView.tsx` / `TransitionTable.tsx`):
  - Fix the page-level horizontal overflow at 390 px. The `<caption>` measures full table width; the page must not scroll sideways.
  - Make the first column sticky.
  - When the table overflows, show a right-edge fade and an "N more countries →" hint.
  - Use 5 tint steps per sign, with a stronger end step (tokens).

## WS3 · Distribution of derived scores [C4, M9]

- Continuous derived scores (`is_derived` and `scale_0_10`) are distributed over ten 1-point bins `[0,1)…[9,10]`, labelled "0–1"…"9–10".
  - Put the single rule in `flourish_stats.outcomes`, used by both API `stat=distribution` and the static exporter.
  - Axis label: "Score (0–10), 1-point bins".
- Test: shares per country sum to 100 ± 0.5 for `sfi`, in both tiers (contract/exporter test). Regenerate web fixtures.
- Display only: a CI bound below 0% renders as 0.0%. Never print "−0.0%".

## WS4 · Faceted charts and scale windows [C5, H1, M7, M8]

- **`charts/SmallMultiples.tsx`, `CompareDomains.tsx`, `Histogram.tsx`, `ChangeDots.tsx`:**
  - Put `fx` labels at the **top** (`fx: { axis: "top" }`).
  - Add enough facet padding that adjacent tick labels can't touch.
  - Move each facet's bottom axis off the last row so the tick labels clear the row label and dots.
  - Every tooltip includes all facet values (country, level).
- **Compare split:**
  - Show the domain name once per row as a row header, not repeated in each column.
  - One ink colour instead of six hues.
  - Value labels like Atlas.
- **Short level labels** (server-owned): extend overrides with short labels for breakdown levels over ~30 characters. `EDUCATION_3` becomes "Primary or less / Secondary / Tertiary". Check the other breakdowns and shorten the same way.
- **`charts/domain.ts` `fittedScale`:** clamp to the measure's bounds after niceing: catalog `min`/`max` for means, 0–100 for shares, −1…1 for r. Clip whiskers at the bound. This fixes the 2–12 and 0–15 axes.
- **Minimum plot height** for 1–3 rows, so ticks don't touch the first row and the zero line isn't a stub.

## WS5 · What Matters restructure [H7, H11, M15]

- Replace the 23-panel chart with **one matrix** that reuses the WS2 tinted-matrix component.
  - Rows are countries. Columns are the 7 importance items in catalog order. Each cell is the mean with a sequential tint; the tooltip shows CI and n.
  - Sort control: "A–Z" or "By <item>" (a select of the 7 items). This replaces the undefined "By value".
  - On phones the matrix scrolls inside its container with a sticky country column.
- Delete the "Two things that travel together" section and its dead code.
- Add three in-page anchor links under the lede. Section headings must not be visually smaller than the chart titles inside them.

## WS6 · US States [C6, H9, H3]

- **Reproduce** with `make api`:
  - `curl -si 'localhost:8080/v1/states?outcome=sfi&wave=Y2&stat=mean'`
  - `curl -si 'localhost:8080/v1/states?outcome=NATURE&wave=MY&stat=mean'`

  Fix the root cause and add synthetic-DB API tests for Y2 and MY.
- **Server errors.** Unhandled exceptions must return a JSON 500 *with* CORS headers: add an exception handler that runs inside the CORS middleware. Add a test.
- **Web (`components/ErrorState.tsx`, `AppShell.tsx`).**
  - Show the offline banner only when `/health` fails.
  - When health is fine but a request fails, show "Couldn't load this view — the data service returned an error."
- **Reference line and header line.** Use the US estimate on the **state weight** (look it up in `flourish_stats.weights`), labelled "US overall (state weights)". Give the national-weight figure in the footnote.
- **Names** (server-owned):
  - Full state names in chart rows and tooltips.
  - Pooled groups read like "North Dakota, South Dakota & Wyoming (pooled)", wherever the `ND_SD_WY` keys are defined.
  - On the map, give pooled members an outline or hatch and a legend entry.
- **Copy.**
  - The chart-view footnote says "each state's sample" (`ChartFigure.tsx` unit).
  - The disabled adjusted-weights checkbox gets a plain visible reason.

## WS7 · Maps [H2]

- In `Choropleth.tsx`, `StateChoropleth.tsx` and `tokens.css`:
  - "No estimate" and unsurveyed land use a hatch, or a neutral with an outline, that is clearly distinct from the lowest bin in **both** themes.
  - The ramp's first step must be visibly tinted.
  - Both legend ends use the same precision.
- Add token contrast pairs to the tokens test.

## WS8 · Theme bugs [H8, M5, M10]

- **Plot tooltips.** Set `--plot-background` to the surface token in both themes; this is the tip fill. The tip stroke uses the rule token and the text uses a ≥ 12 px token. Test contrast of tip text on the tip fill.
- **Native controls.** In `tokens.css`, set `color-scheme: light` under `[data-theme="light"]` and `dark` under `[data-theme="dark"]`, so they follow the manual theme.

## WS9 · Change: dead options and discoverability [H6, M6]

- **Wave pairs.** Show only the pairs that at least one servable variable supports, computed from `waves_available`. Today that leaves just 2023 → 2024.
  - Render a single pair as static text plus one line: "The midyear survey asked different questions, so change is measured 2023 → 2024."
  - Keep the pair code path so more options reappear automatically if the data changes.
- **Measure picker.** On Change, list only measures available at both waves of an enabled pair. The search placeholder count follows.
- **Country picker.**
  - Put the "pick up to four countries" prompt next to the country button.
  - `components/controls/CountryFilter.tsx` label reads "Countries: all 23" / "Countries: 3" everywhere.
  - Compare preselects Indonesia, United States and Japan when the URL has none.
  - Update the Atlas Distribution empty-state copy to match the new label.

## WS10 · Copy and shell [M1, M2, M3, M4]

- **Internal codes.**
  - Drop the weight code from tooltips (`charts/theme.ts` `tipText`); keep `n`.
  - Drop variable codes from search results and second-breakdown options.
  - Remove "(needs the live service)".
  - Replace "tints span ±…" with plain words.
- **Wave names, one set.** Controls: "2023 / Midyear / 2024". Pairs: "2023 → 2024". Midyear dates: "Nov 2023–Dec 2024". Codebook uses the same names instead of `Y1/MY/Y2`. Remove "mid-2024" and "midyear survey of 2024" (`src/waves.ts` and view copy).
- **Footnotes.** `charts/ChartFigure.tsx:30–31`: the noun matches the stat, so median says "a median", not "a correlation".
- **`docs/METHODS.md`.** Delete the stale "Until the population-rescaled … (Phase 5)" sentence and "when a number is withheld". Add sections for WS1–WS3.
- **`document.title`.** Set it per route to "<Page> — Flourish Atlas" (`router.tsx`).
- **Codebook** uses the standard shell (896 px container, nav row). The table scrolls inside its container on phones: fix the 66 px overflow. The "Family" filter is renamed "Topic".
- **Breakdowns** gets a one-sentence lede like the other views.
- **Model cards** gets a "← Correlates" back link.
- **Nav.** No link wraps between 640 and 800 px: `white-space: nowrap` and raise the "More" breakpoint (`AppShell.module.css`).

## WS11 · Polish [Low] — quick, all required

- Axis ticks use "−" and keep a fixed precision per chart.
- Bar-chart CI whiskers are visible over bars.
- Subtitles start with a capital letter.
- Focus rings use `:focus-visible` only.
- Codebook detail shows "valid %" only when it is below 100%.

## Docs

- **ADR-0015** (MADR, brief): label-aligned polarity; categorical change as a pp share change; correlates min-n ranking as a deliberate exception to ADR-0011; derived-score distribution bins.
- Update the CLAUDE.md lines that these change, if any.

## Verification

- **Per workstream:** run only the affected tests, e.g. `uv run pytest stats/tests/<file> -q`, `uv run pytest services/api/tests/<file> -q`, `pnpm -C apps/web vitest run <file>`.
- **After tier changes:** run `make web-fixtures` once. After schema changes: regenerate the client and run the contract test.
- **End, once:** `make lint typecheck test`, `pnpm -C apps/web budget`, and the Playwright journeys. If built data exists: `make data` and `built`-marker tests.
- **PR description:**
  - The owner steps: `make data`, re-run `data-build.yml` before deploy.
  - An eyeball checklist:
    - `/change?outcome=CLOSE_TO`
    - `/change?outcome=ATTEND_SVCS`
    - `/correlates` (Germany)
    - `/?outcome=sfi&stat=distribution`
    - `/compare` split by age band
    - `/breakdowns` + Education
    - `/what-matters` at 390 px
    - `/states?wave=Y2`
    - Any chart tooltip in dark mode

## Out of scope

Verifying the Egypt attendance data, export redesign, the all-countries pooling option, new views, and any re-theme beyond the token fixes above.
