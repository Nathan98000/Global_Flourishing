# Correlates — 25 September

Implements `docs/reviews/correlates-2026-09-25.md` for `apps/web/src/views/CorrelatesView.tsx`, with the owner's decisions below, and adds two new views.

## Owner decisions (override the review)

1. **No adjusted model on the page.** Remove every trace of "Adjusted difference" / "accounting for age, gender…" from the Correlates UI:
   - the Model control;
   - the adjusted subtitles, axis title and hint;
   - the adjusted footnote text;
   - the model-card link.

   Server side, take the middle path (task 4):
   - keep the statistics code and its tests;
   - turn `adjusted=true` off in the public API behind a setting that defaults to off;
   - retire the model-card page.
2. **Two new views:** compare two questions (task 7), and build your own correlation table (task 8).
3. **Everything else in the review is approved.**
4. **Standing rules from earlier pages:**
   - No generated takeaways or summary sentences.
   - One chart on screen at a time; other charts appear only when picked in the view switcher.

## How to work

- Read `CLAUDE.md` once. Touch only the files named here plus the tests and copy they break. Don't re-read files after editing them.
- **Branch:** the What Matters PR edits `HeatTable` and `CorrelatesView.tsx`.
  - If that PR is merged, branch `claude/correlates` from `main`.
  - Otherwise branch from `claude/what-matters`, and say so in the PR.
- ADR-0017 is taken on `claude/segments`. Use ADR-0018 for this work: views, the dedupe rule, the two new endpoints, dropping adjusted from the UI, and switching it off server side.
- One conventional commit per task. Include this prompt file and the review in the first commit.
- Open one PR. Don't merge, tag or deploy.
- End with one line per task.

## Tasks

### 1 · One view at a time

- Replace the stacked sections with one segmented `RadioRow` (the What Matters pattern) under the controls.
  - Options: **In {country}** (default) · **Across countries** · **Compare two** · **Compare several**.
  - URL param `view` = `ranked | countries | pair | matrix`, omitted when default. Parse it in `state/search.ts` and add it to `search.test.ts`.
- Only the selected view mounts, and only its queries run (gate them with `enabled`).
- Views share the top controls: Topic, Measure, search, Wave, Country and Method.

### 2 · Controls and copy

- **Lede (long):** "Pick a question to see which other answers tend to go with it, in one country. Things that go together aren't necessarily cause and effect."
- **Lede (short):** "Which other answers go with the one you pick, in one country."
- **Method disclosure:** the only method control left is correlation type. Move it into a closed-by-default disclosure button labelled "Method: straight-line correlation" / "Method: by-rank correlation".
  - Inside: "Correlation type" with **Straight-line (Pearson)** · **By rank (Spearman)**.
  - Under it: "Straight-line: how closely two answers follow a line. By rank: how consistently one rises with the other."
  - Remove the always-visible Pearson/Spearman sentence.
- **Search stays visible at every width.** On narrow screens, remove the "More options — model, correlation, topic" disclosure. Put Topic and Measure side by side above Wave, with Country and the Method button side by side after Wave.
- **Disabled options say why.** When a Wave button is disabled, show a line under the control: "Midyear isn't available: this question wasn't asked in the midyear survey." (or the equivalent for 2023/2024), linked to the button with `aria-describedby`.
- **Invalid params:** drop `adjusted` from the Correlates search schema. An incoming `adjusted` goes through the usual invalid-param notice.
- **Countries A–Z** everywhere on this page: the Country select and every country axis. Sort by name, not code.
- **Topics (`topics.ts`):** list the PHQ-2 and GAD-2 scores and screen flags under **Mental health**, not "Flourishing index & its domains". Web-side mapping only. Update `app.test.tsx`.

### 3 · The ranked chart ("In {country}")

- **Axis:**
  - For correlations, always use −1 to 1 with ticks at −1, −0.5, 0, 0.5, 1. `RankedBar` gets an optional fixed domain; don't use `fittedScale` here.
  - Under the plot, label the ends "← goes with lower {short name}" and "goes with higher {short name} →". Drop the "Weighted correlation (Pearson) →" title; the subtitle carries the stat.
- **Key above the chart:** a teal dot "Goes with higher {short name}" and a rust dot "Goes with lower {short name}".
- **Title:** "What goes with {measure}". **Subtitle:** "{country} · {wave title} · correlation, −1 to 1".
- **Tooltip:** "{±r} · {label}", then "{n} people answered both". Drop "point estimate — no interval…".
- **Labels:** fit the label gutter to the longest label, capped at 300 px; wrap longer labels to two lines. Nothing clips. Currently "Importance: religious or spiritual life" loses its "I".
- **Clickable rows:** each row (dot or label) opens **Compare two** with this measure on Y and that row on X. Make rows real buttons or links and keyboard-reachable. Add a one-line hint under the chart: "Select a row to see the two questions together."
- **Narrow screens:**
  - Put each label on its own line with its value right-aligned, and the dot track underneath at full width.
  - Use three ticks: −1, 0, 1.
- **Footnote:** drop the adjusted text. When the dedupe from task 4 removed items, add "PHQ-2 and GAD-2 are shown as their scores; their individual questions and screen-positive flags are left out." Build it from what was removed; don't hard-code it.

### 4 · API: dedupe the ranking; turn adjusted off by default

- In `services/api/src/flourish_api/routes/correlates.py`, after ranking: when two kept predictors `shares_answers`, keep only the one built from more answers (`_answers` size). On a tie, keep the non-binary one.
  - Example: `phq2_score` beats its items `DEPRESSED` and `INTEREST`, and beats `phq2_positive`.
  - Backfill from further down the ranking so `limit` still holds.
- Report the dropped names in response meta (e.g. `dropped_overlap`) for the footnote.
- Add a pytest.

**Adjusted off by default.** The adjusted sweep is the API's most expensive request, and nothing on the site will use it.
- Add `adjusted_enabled: bool = False` to `Settings` in `services/api/src/flourish_api/config.py` (env `FA_ADJUSTED_ENABLED`).
- When it's off, `/v1/correlates?adjusted=true` returns 422: "Adjusted associations are not offered on this server." Validate this before any work is done.
- Keep `adjusted_association` in `flourish_stats` and every adjusted branch in the API. Don't delete that code.
- Existing adjusted API tests run with the setting switched on through a fixture override, so the code stays tested. Add one test for the default: a 422 with no computation.
- Update the OpenAPI description of `adjusted` to "disabled unless the server enables it".
- Don't set the variable in `deploy.yml`, so production stays off.

**Retire the model-card page.** Its copy describes "the adjusted associations on the Correlates view".
- Remove the `/model-cards` route and `ModelCardsView.tsx`, plus any nav, sitemap or Methods links to it.
- Keep `docs/model-cards/*.md` in the repo; ADR-0014 cites them.
- An old `/model-cards` link falls through to the router's not-found page.
- Record this in ADR-0018 as a reversible choice: set the env var and restore the route to bring it back.

### 5 · Across countries

- **Subtitle:** "The {n} measures ranked for {country}, in every country · {wave title} · correlation, −1 to 1". **Title:** "{measure}, across countries".
- **Columns:** pin the chosen country as the first column, with a highlighted header and an outlined column. The rest run A–Z.
- **Width on desktop:** the matrix may be wider than the text column. At ≥ 1200 px, center it at up to 1216 px with rotated country headers, so all 23 countries fit without scrolling. Narrower screens scroll with a sticky label column.
- **Legend:** replace the bold caption sentence with a swatch legend drawn from `DIVERGING_RAMP`: "−{extent} … +{extent}", then "rust: goes with lower {short} · teal: goes with higher {short}", then "— too few respondents". Put it outside the scroll box, in regular weight.
- **Dark theme:** widen the lightness spread of the `--div-*` ramp in `tokens.css` so adjacent steps are distinguishable. Check it on the heat table.

### 6 · Charts that don't widen on resize (`charts/usePlot.tsx`)

- Growing the viewport (768 → 1100 px) leaves the SVG at its old width. Shrinking works.
- Find why the rebuild at the new measured width doesn't stick, and fix it for every Plot chart.
- Add a test if jsdom allows; otherwise note the manual check in the PR.

### 7 · New view: Compare two

**API: `GET /v1/correlations/pair`**

- Params: `y`, `x`, `wave`, `filter=country_code:…`, `method`.
- Both must be ordered items (`ORDERED_SCALE_TYPES`) available at the wave. If they `shares_answers`, return 422 with a plain message.
- Returns:
  - the weighted correlation, its n, and the method (`weighted_correlation`);
  - one row per X group: X level or bin, weighted mean of Y with CI (`weighted_mean` with `by=[x-group]`, same design, weight and SE as `/v1/aggregate`), n, and weighted share of respondents.
- **X groups:** use the answer levels when X has ≤ 11. Otherwise use 10 equal-width bins between the weighted 1st and 99th percentiles, labelled by range.
- Groups below `correlates_min_n` are returned flagged, not dropped.
- Orient X the same way the ranked list signs the correlation (oriented label and level order), so a positive correlation always slopes up.
- Same cache headers as the other routes. Add OpenAPI docs and pytest.

**Web**

- **Controls in this view only:** "Compare with" (the same searchable picker as Measure) and a **Swap** button that exchanges Measure and Compare-with.
  - Default X: the top-ranked correlate of the current measure in the current country.
  - URL param: `x`.
- **Chart: a binned scatter.**
  - X axis: X's answers in order, labelled with short answer labels.
  - Y axis: Y's full scale (0–10 or 0–100% via `measureBounds`), not fitted.
  - One dot per X group at the mean of Y, with CI whiskers. Dot area is proportional to the share of respondents, with a small size key: "Larger dot = more people gave that answer".
  - A thin line joins the dots. Single hue (`--div-pos-mark`).
  - Flagged groups are drawn hollow and named in the footnote.
- **Title:** "{Y} by {X}". **Subtitle:** "{country} · {wave title} · average {Y} for each answer to {X} · correlation {±r} ({method label}), {n} people".
- **Tooltip:** "{share}% answered {level}", then "Average {Y short}: {mean} (95% CI {lo}–{hi})", then "{n} people".
- CSV/PNG and the data table as on the other charts.
- **Footnote:** each dot is an average of people's answers, not individual people. Associations aren't cause and effect. Link to "How these numbers are made".
- Never plot respondent-level points: they would publish microdata, and 38k answers on a 0–10 × 0–10 grid only overplot.

### 8 · New view: Compare several

**API: `GET /v1/correlations`**

- Params: `vars` (2–10 names, ordered items at the wave), `wave`, `filter=country_code:…`, `method`.
- Returns every pair i < j, computed in one pass per row with `weighted_correlations`: r, n, `below_min_n`, and `shares_answers` (no r for those).
- Same cache headers, OpenAPI and pytest as task 7.

**Web**

- **Picker:** "Questions in this table", a chip list with a remove × per chip, plus an "Add a question" search using the same matcher as the page search.
  - Minimum 2, maximum 10. At the limit, the add control says "Up to 10 questions".
  - Default: the current measure plus its top 5 correlates in the current country (after task 4), so the view is never empty.
  - URL param: `vars`.
- **Table:** reuse `HeatTable`.
  - Lower triangle only. Rows labelled "1 · {name}" … Columns headed by the numbers 1…n, with full names in the tooltip and the accessible name.
  - Diagonal and upper triangle blank.
  - Tint with `divergingTint` and the same legend as task 5.
  - Pairs that share answers show a muted "·", with a legend entry "· built from the same answers".
  - Cells below min n show a muted "—".
- **Clicking a cell** opens **Compare two** with that pair (row = Y, column = X). Add the hint "Select a cell to see the two questions together."
- **Title:** "Correlations among {n} questions". **Subtitle:** "{country} · {wave title} · correlation, −1 to 1".
- CSV/PNG and the data table.

### 9 · Small fixes

- On a first visit, confirm that clicking the search box right after load keeps focus. Fix it only if you can reproduce the problem.

## Verification

- **Per task:** run only the affected tests.
  - Python: `uv run pytest services/api stats -q -k <area>`.
  - Web: `pnpm -C apps/web vitest run <files>`.
- **Playwright:** rewrite journey 10 (currently "switch to adjusted, open the model card").
  - Pick an outcome and read the ranked list.
  - Select a row: Compare two opens with that pair.
  - Swap.
  - Open Compare several: the default 6 questions show. Add one, remove one.
  - Select a cell: it returns to Compare two.
  - Open Across countries: the chosen country is the first column.
  - Add API route fixtures for the two new endpoints.
- **End, once:** `make lint typecheck`, the full pytest and vitest suites, and the Playwright journeys.
- Then take Playwright screenshots of each of the four views at 1470, 768 and 390 px, in light and dark themes. Don't commit them. Look at them and confirm:
  - there is no clipped label or colliding tick;
  - all 23 countries are visible at 1470 px;
  - there is no horizontal page overflow.
- Push and open the PR.
