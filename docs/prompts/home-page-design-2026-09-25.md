# Home-page design pass — 25 September

The owner's page-by-page review, starting with the Atlas (home) page. Most changes live in shared components, so they apply on every view that uses them. That is intended.

## How to work (token budget matters)

- Read `CLAUDE.md` once. Don't read `PROPOSAL.md`, the ADRs or earlier prompts unless a task names one.
- Locate code with `grep` for the quoted strings and the paths given. Read only the relevant ranges. Don't re-read a file after editing it.
- Change only what each task needs. No refactors beyond the ones named, no extras.
- Branch `claude/home-page-design` from `main`. Make one conventional commit per task and include this prompt file in the first one. At the end, open one PR; **do not merge, tag or deploy**.
- End with one line per task: what changed, plus the owner steps. Nothing else.

## Constraints this work hits

| Rule | Consequence |
|---|---|
| Front end computes no statistics and owns no labels | Subtopic *membership* and answer labels come from the server. Only subtopic *display names* may live in `apps/web/src/topics.ts`, like topic names (owner decision, 25 Sept). |
| One envelope, two tiers (ADR-0008) | A new catalog field goes into `/v1/variables` **and** the static `variables.json`; `test_static_contract.py` must pass. An API schema change means regenerating the client: `uv run python -m flourish_api.openapi > apps/web/openapi.json && pnpm -C apps/web gen:api`. |
| Charts use `var(--token)` only; budgets and tests stay green | `pnpm -C apps/web budget`, Lighthouse, and the Playwright journeys (update any journey a removal breaks). |

## Tasks

### 1 · Page no longer jumps to the top when a control changes

Changing a search param (a select, a segmented button, a country checkbox) scrolls the page to the top. This is TanStack Router's default reset on `navigate`.

- Search-only navigations keep the scroll position: `resetScroll: false`. Apply it in one place: a shared helper used by every view's `navigate({ search })` (`AtlasView` `setSearch`, `ChangeView`, `CompareView`, `CodebookView` and the rest), or a router-level default if the installed version (`@tanstack/react-router` ^1.130) supports one.
- Route changes from the nav still start at the top.
- The country popover stays open while several countries are ticked in a row.
- **Test:** one Playwright check in an existing journey. Scroll to the country control, tick two countries, and assert `scrollY` barely moves and the popover stays open.

### 2 · Remove the world map everywhere

Too few countries for a map to inform.

- Remove Atlas's Chart/Map toggle and the `view` search param.
- An old URL carrying `view=map` just loads the chart. Drop that param without an "invalid parameter" notice.
- Delete `views/MapPanel.tsx`, `charts/worldTopology.ts`, the world parts of `charts/Choropleth.tsx`, and the `world-atlas` dependency.
- **Keep the US States map.** Move the helpers it imports from `Choropleth.tsx` (`mapDomain`, `quantizeColor`, `MapLegend`) into a small shared module.
- Update the tests and README/docs lines that mention the world map.

### 3 · Tooltip interval format: `95% CI [X, Y]`

- Add one formatter in `src/format.ts`, built on the existing `ciLabel`, e.g. `95% CI [7.59, 7.68]`.
- Use it in every tooltip:
  - `charts/theme.ts` `tipText`
  - `charts/TransitionTable.tsx` `intervalText`
  - `charts/StateChoropleth.tsx`
  - the matrix tooltips in `views/WhatMattersView.tsx` and `views/CorrelatesView.tsx`
- The data tables already use brackets; leave them.

### 4 · No n in tooltips

- Remove the `n = …` line/clause from every tooltip, including the hidden screen-reader strings. Places: `theme.ts:195`, `TransitionTable.tsx:226–228`, `StateChoropleth.tsx:48`, `WhatMattersView.tsx:536–538`, `CorrelatesView.tsx:474–478`.
- For Correlates' below-floor cells, the tip says "Too few respondents to rank (fewer than 100)".
- n stays in the data tables and CSVs.
- Update the CLAUDE.md line "Numbers shown to users always carry weight, unweighted n, and CI" to say n lives in the data table.

### 5 · Remove the "Orient so higher = better" checkbox

- Remove it from `views/AtlasView.tsx` (~line 357).
- Remove the Atlas `oriented` search param and the `oriented` branch of `labels.ts` `scaleSubtitle`.
- Delete client code that only served it. Leave the API's `oriented` parameter alone.

### 6 · Less blank space around the lede

- Tighten the vertical space above and below the intro sentence ("How 207,919 people…"). It currently sits in a tall band (`views/AtlasView.module.css` and the shared lede style).
- Target: the lede sits close under the nav and close above the controls, with spacing taken from the existing spacing tokens.
- Every view's lede uses the same spacing.

### 7 · Subtopics for Religion & spirituality (45 measures)

**Server side:**
- Add a `subfamily` code to the catalog, set in `pipeline/src/flourish_pipeline/overrides/variables.yaml`.
- Thread it through `VariableInfo`, the catalog, `/v1/variables` and the static `variables.json`.
- Religion membership, all 45:

| Code | Display name (in `topics.ts`) | Members |
|---|---|---|
| `affiliation` | Religious affiliation (9) | `REL1`–`REL9` |
| `beliefs` | Beliefs & experiences (5) | `BELIEVE_GOD`, `AFTER_DEATH`, `LOVED_BY_GOD`, `GOD_PUNISH`, `REL_EXPERIENC` |
| `practice` | Religious practice (4) | `ATTEND_SVCS`, `PRAY_MEDITATE`, `SACRED_TEXTS`, `TELL_BELIEFS` |
| `daily_life` | Religion in daily life (5) | `REL_IMPORTANT`, `LIFE_APPROACH`, `COMFORT_REL`, `CONNECTED_REL`, `CRITICAL` |
| `teachings` | Importance of teachings, by tradition (15) | `TEACHINGS_1`–`TEACHINGS_15` |
| `teachings_country` | Importance of the country's main religion (7) | `CNTRY_REL_*` |

- Add an overrides test that pins the counts: 9 / 5 / 4 / 5 / 15 / 7.

**Picker** (`components/controls/OutcomePicker.tsx`, used by every view):
- When the chosen topic has subfamilies, show a **Subtopic** select between Topic and Measure. It defaults to the current measure's subtopic, and Measure lists only that subtopic.
- Topics without subfamilies look unchanged.
- The search box still searches everything.
- Add a vitest.

**Data:** this needs `make data` (catalog column). Run it locally if `data/raw/` exists, then `rsync -a --delete data/static/ apps/web/public/data/` to check the picker. List the rebuild as an owner step.

### 8 · Long answer lists (e.g. Current religion, 17 answers)

- Above 6 options, the shared answer-level control (`components/controls/RadioRow.tsx`, labelled "Answer level") renders as a compact **Answer** `<select>`: same label, same values, same URL param. It currently overflows the page and wraps into tall cells.
- 6 or fewer options stay segmented.
- Fix it in the shared component so Atlas, Compare, Change, US States and What Matters all get it.
- **Test:** a vitest for the >6 switch; at 390 px no page-level horizontal overflow on `/?outcome=REL2`.

### 9 · Describe scale endpoints, not "better"

**Subtitles:**
- `labels.ts` `scaleSubtitle` and `theme.ts:158–160` stop saying "higher/lower is better".
- For an item with labelled endpoints, name them from its value labels (lowest and highest valid code; skip blank middle labels): `Average score, 0–10 (0 = Not true of you at all, 10 = Completely true of you)`. Use the labels exactly as the server gives them.
- Derived scores (the index, its domains, PHQ-2/GAD-2 scores) show just the range: `Average score, 0–10`.

**Codebook:** remove the "· lower is better / no better-or-worse direction" phrase from the detail meta line (`labels.ts` `directionPhrase`). The value-labels table shows the endpoints.

**Leave as is:** Change's "a rise is better/worse" note (owner decision, 24 Sept) and the catalog `direction` field.

### 10 · Answer labels, not codes, in data tables

- In `components/EstimateTable.tsx`, the "Level" column shows the answer label from the variable's value labels (the ones Atlas already uses via `outcomeLevels(detail)`), e.g. "Always", "Not at all".
- Rename the column to "Answer".
- Fall back to the code only where no label exists (a blank label counts as none, as on the middle of 0–10 scales).
- Derived-score bins keep their "0–1" … labels.
- **Test:** a vitest.

### 11 · Readable download file names

- One helper names CSVs and PNGs: `flourish-atlas_<measure>_<view>_<waves>[_by-<breakdown>][_<country>].<ext>`.
  - Each part is a lowercase ASCII slug of the display text (strip diacritics, so Türkiye becomes turkiye).
  - No codes and no `data_version`.
  - Examples: `flourish-atlas_has-someone-to-confide-in_change_2023-to-2024.csv`, `flourish-atlas_secure-flourishing-index_by-country_2023.png`.
- Replace `export/csv.ts` `csvFilename` and `export/png.ts` `pngFilename`.
- The server CSV name in `services/api/src/flourish_api/routes/export.py` `_filename` must produce the same string: it gets the display name from the catalog. Keep one test on each side pinning an identical example.

### 12 · No data version in the PNG footer

- `export/png.ts` `stampLines`: the footer is just the citation line. Drop `data ${dataVersion}`.
- Update its test.

## Docs

- **ADR-0016** (MADR, brief): the home-page design pass. Cover:
  - no world map (too few countries);
  - tooltips carry the interval only, with n in the table;
  - no orient checkbox;
  - scale endpoints described instead of "better";
  - server-owned subtopics.
- Update CLAUDE.md where these change a stated rule: the n rule (task 4), and the topics/subtopic-names exception (task 7).

## Verification

- **Per task:** run only the affected tests, e.g. `pnpm -C apps/web vitest run <files>`, `uv run pytest <pkg>/tests/<file> -q`.
- **End, once:** `make lint typecheck test`, `pnpm -C apps/web budget`, and the Playwright journeys.
- **PR description:**
  - Owner steps: `make data` locally; re-run `data-build.yml` before deploying.
  - Eyeball URLs:
    - `/?outcome=REL2` at 390 and 1280 px
    - `/?outcome=PROMOTE_GOOD`
    - `/?outcome=CAPABLE`, then open the data table
    - the Religion subtopics in the picker
    - a tooltip on any chart
    - one CSV and one PNG download
    - an old `/?view=map` URL
