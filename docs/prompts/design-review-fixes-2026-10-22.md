# Design review fixes — controls, clarity, and the US and What Matters charts

This prompt implements the recommendations of the design review of 21 October 2026, with the owner's two changes (below). Read these first:

- the review, `docs/reviews/design-2026-10-21.md` (findings F1–F22);
- its mockups, `docs/reviews/design-2026-10-21-controls.html`.

Part 1 reorganises the controls at the top of every chart page: option B, "a question bar on top, a toolbar on the chart". Part 2 fixes the review's other findings.

No statistic is computed differently, except one server-side labelling change (task 16). No URL parameter is renamed.

**The owner's two changes to the review.** Where the review or its mockups say otherwise, this prompt wins.

1. **The statistics keep their names.** "Mean" stays "Mean", "Median" stays "Median", "Distribution" stays "Distribution", and the interval stays "95% CI". The review's "Average", "Middle value", "All answers" and "the likely range" are not used anywhere. Where the app already says "Average" for a mean (chart subtitles), it now says "Mean", so the subtitle and the hover card use the same word (task 1).
2. **No alphabetical sorting anywhere.** Every chart is ordered by value. There is no A–Z option, and no name column to click. A second click on the value label still reverses the order. This applies to:
   - the Atlas, Change, US States and Segments;
   - What Matters' matrix and its other questions.

## How to work

- **Where:** work in the main checkout. The real data, `data/raw` and `data/static` live only there.
  - If PR #65 (`claude/charts-only-methods`) has merged, branch `claude/design-review-fixes` from `main`.
  - If it hasn't, branch from `claude/charts-only-methods` and open the PR against it (a stacked PR).
  - Never switch another session's branch.
- **Commits:** one conventional commit per task (`feat(web): …`, `fix(api): …`, `docs(adr): …`). The first commit includes this prompt.
- **The PR:** open it at the end, with one line per task. Don't merge, tag or deploy.
- **Dev loop:** run it on real data.
  - Copy the data: `rsync -a --delete --exclude .DS_Store data/static/ apps/web/public/data/`, then `make api` (:8080) and `make web` (:5173).
  - `make test` and `make web-fixtures` overwrite `apps/web/public/data` with synthetic data. Run the rsync again before looking at anything by eye.
  - Leave port 4173 alone; another project uses it.
  - Stop your `make api` before the Playwright journeys (journey 4 needs :8080 free).
- **Rules** (project rules and owner decisions; break none without saying so in an ADR):
  - **The URL is the state.** Every parameter keeps its name, and every old link opens a working view. The full list: `outcome`, `topic`, `wave`, `stat`, `sort`, `dir`, `countries`, `level`, `by`, `view`, `country`, `scope`, `method`, `other`, `a`, `b`, `vars`, `order`, `qsort`, `qdir`, `adj`, `item`, `from`, `to`, `via`.
    - Three defaults change, each recorded in an ADR: US States' `view` (task 12), Correlates' `country` (task 5) and What Matters' `sort` (task 2).
    - The A–Z values (`sort=name`, `qsort=name`) become legacy aliases (task 2).
  - **The front end owns no labels and computes no statistics.** Question names, answers, and country and state names come from the server. Control words (legends, option names, hints, decks) are the app's and may change.
  - **Every number keeps its hover card** (`charts/theme.ts tipText`), in this format:
    - what the mark is;
    - the statistic by name (Mean, Median, Share);
    - `95% CI: [X, Y]`;
    - the n in words.

    The card's format doesn't change (ADR-0022, ADR-0024).
  - **Owner decisions that stay:**
    - no data tables (ADR-0022) and no line under a chart (ADR-0024);
    - one light theme (ADR-0023) and no world map (ADR-0016);
    - the Codebook reached through Methods (ADR-0021);
    - every US state on its own (ADR-0028);
    - an estimate few people are behind is shown with an asterisk, never withheld (ADR-0019);
    - chart colours are `var(--token)` strings only (ADR-0010).
  - **Accessibility:**
    - every control reachable by keyboard and named for a screen reader;
    - 44 px targets under 40rem;
    - focus visible;
    - any new colour pair added to `src/__tests__/tokens.test.ts`.
  - **Budget:** the first load stays ≤ 250 kB gzipped (now 205.9). Run `pnpm -C apps/web build && pnpm -C apps/web budget` before task 4 and after the last task, and put both numbers in the PR. No new runtime dependency.
  - **Offline:** the Atlas, Segments and What Matters keep working with :8080 unreachable (journey 6).
  - **The generated client:** after any API schema change, run `uv run python -m flourish_api.openapi > apps/web/openapi.json && pnpm -C apps/web gen:api` and commit both files.

## Part 1 — the controls (option B)

The grammar on every chart page:

1. **Top row: what, then when and where.** Question · Year · Countries.
2. **Chart header, right-hand side: how it's drawn.** The page's display controls, "How to read this chart", "Download ▾".
3. **The chart's value label sorts.**

The mockups show this in the B tab. Where the mockups show "Average", "Middle value", "All answers" or an A–Z sort, follow this prompt instead.

### 1 · Plain words for the controls (statistics keep their names)

- **Control words:**

  | Was | Becomes |
  |---|---|
  | Wave | Year |
  | Statistic | Show |
  | Answer level | Showing % who said |
  | Break down by | Split by |
  | Second breakdown | then by |
  | By gap | Biggest gap first |
  | Correlation type | Measured as (keep "What's the difference?") |
  | Adjusted state weights | Adjust for who answered in each state |

- **Option words that stay:** Mean, Median, Distribution, Share, Straight-line, By rank.
- **Subtitles:**
  - `WAVE_TITLES` drops "Wave 1/2": "2023", "2024", "Midyear survey, Nov 2023–Dec 2024".
  - `labels.ts` says "Mean score" where it says "Average score" today ("Median score" stays).
  - Change's subtitle says "Mean change" where it says "Average change". The card already says "Mean change".
- **Units and links:**
  - "pp" → "percentage points" wherever it is shown, not only in the card (`format.ts`).
  - "×" in titles → "by" ("Life satisfaction by gender and age").
  - "Answer codes & details →" → "The exact question and answers →".
  - US States' "n =" → "based on N people".
  - Compare two's "Share of respondents …" → "Share of people …".
- **Midyear:** where it appears as a choice, add a one-line hint: "a shorter survey between the two years".
- **Don't touch:** the hover card's words, and "95% CI" wherever it appears.
- **Tests:** update the views, components and e2e selectors that name the old words. Add a test that no rendered control, subtitle or card says "Average", "Middle value", "All answers" or "likely range".

### 2 · Ordered by value only — no A–Z

- **Remove the A–Z options and the name-order code paths:**
  - Atlas, Change, US States, What Matters' Other questions: the `sort` options and their Order buttons.
  - Segments' "A–Z".
  - What Matters' corner "Country" sort button (`HeatTable`'s `ROW_LABELS` sort).
  - `sortRows.ts`, `SmallMultiples.tsx` (`PanelSort`), `changeOrder.ts`, `whatMattersRows.ts`.
  - A tie in value may still fall back to name order; that's a tie-break, not a choice.
- **What remains:**
  - by value, highest first (default), and reversed (lowest first);
  - Segments keeps "Biggest gap first" (a value).
- **What Matters' matrix:** it opens sorted by its first column (the first importance item in the server's order), highest first. Absent `sort` means that column. An unknown code means that column too, no longer A–Z.
- **Old links (legacy aliases):**
  - `sort=name` (Atlas, Change, US States, Segments, What Matters) and `qsort=name` parse as the default value order, with **no** "invalid link" notice. A `dir` that came with `name` is dropped (it meant A→Z or Z→A).
  - Serialising never writes `name` again.
  - Add one `search.test.ts` case per page.
- **Not in scope** (no sort is offered, so the rule holds):
  - lists you pick from: country selects, the Countries popover, the question picker's topics;
  - the fixed layout of Correlates' Find related country-by-country table and Compare several's table. Leave them as they are.
- **ADR:** goes in ADR-0029 (task 7).
- **Tests:** `sortRows.test.ts`, `whatMatters.test.tsx` (matrix and other questions), `search.test.ts` (the What Matters defaults and the legacy aliases), `app.test.tsx`'s Segments link.

### 3 · Unavailable choices say why, in view, and offline says what still works

- **Disabled options:**
  - Every disabled option gets a visible reason line through `RadioRow`'s `note` (or `noteId`): "Midyear — not asked in the midyear survey". Its input points to the note with `aria-describedby`.
  - Draw disabled options with a dashed outline, not just paler text. Add the token pair to `tokens.test.ts` if it's new.
  - This applies to the Atlas, Change, Segments and US States.
- **Offline (:8080 unreachable):**
  - **Median:** disabled, with "needs the live data service".
  - **A `stat=median` link:** shows "The live data service is offline, so medians can't be shown right now — showing the mean." It must not show the invalid-link notice.
  - **The banner:** "Some views need the live data service, which is offline. The Atlas, Segments and What Matters still work." Each name is a link. The country filter works offline, so stop saying "filters are unavailable".
  - **US States and Correlates' offline line:** names the same three pages, with links.
- **The invalid-link notice, in every case:** "This link asked for something we can't show; showing the default instead." It keeps its Dismiss link.
- **Tests:** the note and `aria-describedby` on four pages; journey 6 (offline Atlas) gains the median link and the banner's links.

### 4 · One question picker

- **The change:** `QuestionPicker` (single-select) replaces `OutcomePicker` on the Atlas, Change, US States, Segments and What Matters' Other questions.
- **Closed:** one button showing the question's short name in bold, a line of its wording, and "Change ▾". Its accessible name is "Question: {name}".
- **Open:** the Correlates panel:
  - search over name, label and wording;
  - recently used questions;
  - topics on the left, with their subtopics;
  - each page's own servable list, with unavailable questions left in view with the reason in words.
  - It is a full-screen sheet under 600 px, as now.
- **URL behaviour:**
  - Picking writes `outcome` (and clears `level`) exactly as the old picker did.
  - `topic` in the URL opens the panel's browse column on that topic.
  - Delete `OutcomePicker` once nothing uses it.
- **Topic names:** one name for the midyear topic in both places (`topics.ts`: "What matters to people").
- **ADR:** goes in ADR-0029. This revises the two-step picker ("owner decision 1" in `OutcomePicker.tsx`) and ADR-0016's subtopic step. Both survive as the panel's browse column.
- **Budget:** the picker moves into the first-load chunk. Record the gzipped difference (estimated at about 5 kB).
- **Tests:** move `picker.test.tsx`'s cases to `questionPicker.test.tsx`, per page. Journey 1 changes question and year through the picker, shares the URL and reloads.

### 5 · The question bar: same order on every page; Correlates' "Where"

- **The top row, left to right:**
  - **Atlas and US States:** Question · Year · Countries (US States has no Countries).
  - **Change:** Question · Countries (its years are fixed).
  - **Segments:** Question · "Split by [ ] then [ ]" · Year · Countries.
  - **What Matters:** its three views stay tabs. Within a country: Country · Split by. Other questions: Question.
- **Correlates:**
  - Its sentence stays as its question bar; then Year · **Where**.
  - Where is one select: "All countries, averaged" · "Each country side by side" · then each country A–Z (a list to pick from, not a sort). It writes the existing `country` and `scope` parameters exactly as today's Country select plus the "In United States | Country by country" toggle do.
  - The toggle goes.
  - With no `country` in the URL, Correlates opens on **All countries**, like every other page. This reverses ADR-0019's "the default stays the United States"; record it in ADR-0029. Links that name a country are unaffected.
- **Countries:** the control becomes a button that looks like one ("All countries ▾"). Its panel starts with an "All countries" choice, then "Choose countries" with ticks; "all" is never shown as nothing ticked.
- **Layout:** the row aligns on its label lines. A note under Year (task 3) hangs below without pushing the others down (Correlates' `.controlsTop` rule).
- **Tests:** a test per page that the controls render in this order; Correlates' Where writes the same URLs as the old pair of controls (journey 10).

### 6 · The chart header's toolbar and the summary in the subtitle

- **`ChartFigure` gets a `toolbar` slot on the header's right.** It replaces the "Download CSV · PNG" line. In order:
  1. the page's display controls;
  2. "How to read this chart" → `/methods#how-to-read-the-charts`;
  3. one "Download ▾" (CSV, PNG).

  It sits in the same place at every width, and on a phone it goes under the subtitle.
- **What moves into it:**
  - **Atlas and US States:** Show (Mean · Distribution · Median, or Share · Distribution).
  - **US States:** Map/Chart, and the state-adjustment switch with its reason in view.
  - **Correlates:** Measured as · What's the difference?
  - **Segments:** Order countries (task 7).
  - **Atlas (categorical), Change and What Matters' Other questions:** the answer ("Showing % who said").
- **A key in the header:** a one-line key in the header's second line on every dot or bar chart: "● mean  ⟝⟞ 95% CI" (or "median", or "share", per the chart). It is part of the header, not a line under the chart.
- **The subtitle carries the state, in the controls' words.** For example: "Mean score, 0–10 · 2023 · all countries · highest first". With countries chosen: "· 3 countries".
- **Tests:** export journey 4 through the new menu; the subtitle's text per page; the toolbar's tab order (after the top row, before the chart).

### 7 · Sort from the chart's value label

- **The label:** dot plots and bar charts carry the statistic's own word over their value column. That's the Atlas, Change, the US States chart and What Matters' Other questions; the word is "Mean", "Median", "Share", "Mean change" or "Change in share".
- **How it works:**
  - The label is a button with `aria-sort` and an arrow.
  - A click reverses the order (highest first ↔ lowest first) and writes `dir` exactly as the old Order buttons did.
  - The row names are a plain label, not a button (task 2).
  - The old Sort and Order controls go.
- **Segments:** has no value column, so its toolbar keeps one "Order countries" select: Highest first · Lowest first · Biggest gap first. It writes `sort` and `dir`.
- **What Matters' matrix:** its column labels keep sorting as now (ADR-0026), less the corner.
- **Hints:** the "Select a column's label …" line under the matrix, and the "Select a row …" line under Find related, move into their chart headers, beside the sort arrow or the list's title (ADR-0024).
- **ADR-0029, "Controls: a question bar, a chart toolbar, one picker, ordered by value"**, records tasks 2, 4, 5, 6 and 7:
  - the URL aliases;
  - the defaults changed;
  - which ADRs it revises: ADR-0016's picker step, ADR-0019's default country, ADR-0026 (extended to every chart, the corner removed).

  Update `docs/adr/README.md` and the status column of the ADRs it revises.
- **Tests:** per view, clicking the label flips the order and the URL matches what the old Order control wrote; keyboard (Enter and Space) works.

### 8 · The phone

- **Layout under 40rem:**
  - the Question button and Year (Where on Correlates);
  - then one summary line, e.g. "Mean · all countries · highest first", with an **Options** button;
  - Options opens a bottom sheet with Show, Countries and the page's toolbar controls.
- **Remove:**
  - the "More options" `<details>`;
  - Correlates' phone summary button. Its "Change" becomes the shared Options button, which no longer collides with the Change page.
- **The sheet:** a dialog. Focus moves in; Escape and "Done" close it; focus returns to Options.
- **The value label** stays tappable (44 px) for reversing the order.
- **Tests:**
  - journeys 11 and 12: no sideways scroll from 320 to 390 px in both font sizes, with the sheet open;
  - a new journey: on a phone, pick a question, reverse the order, open Options and choose Distribution, reload — the same view.

## Part 2 — the review's other findings

### 9 · The nav keeps every page at tablet width (F8)

- **The bug:** the nav folds into "More" below 50rem (`NAV_FOLD_VIEWPORT`), but by then the brand already sits above the links, which have room for all seven.
- **The fix:** fold only where the seven links wouldn't fit on their own row. Either measure, or fold at 40rem.
- **Tests:** journey 11 checks 768 px shows all seven and 390 px shows "More".

### 10 · The Atlas's Distribution is never a dead end (F9)

- **The bug:** choosing Distribution for a numeric question with no countries chosen gives an empty state.
- **The fix:**
  - Show the first four countries in the current value order (the server's estimates; no client statistics).
  - Add a hint in the chart header: "Showing the first four countries — choose others with Countries".
  - The rows above don't jump when the order control disappears.
- **Tests:** `views.test.tsx` and `estimates.test.ts`, with no countries in the URL.

### 11 · What Matters: one colour range, and "Within a country" opens on the ranking (F2, F16)

- **The matrix:**
  - It is shaded on **one** window fitted to all its cells (ADR-0010's rule), with one key that drops "each column shaded on its own range".
  - This reverses the per-column shading that came with the What Matters PR (#53, never in an ADR); record it in ADR-0030.
  - The matrix's columns fill the page column.
- **"Within a country":**
  - Choosing the tab writes `by=none` explicitly, so the first thing shown is the country's ranking.
  - A bare `?view=within` link keeps today's default (`age_band`).
  - The split option reads "Nothing — one ranked list".
- **Tests:**
  - `whatMatters.test.tsx`: one scale across columns; the tab's URL; the bare link's default.
  - Journey 8.
  - The tint inks stay AA (`tokens.test.ts`).

### 12 · US States: opens on the chart, one US figure, find a state (F1, F14)

- **The default view:**
  - With no `view` in the URL, the page opens on the **Chart** (dot plot with each state's 95% CI and the US reference line). `view=map` links keep the map.
  - This changes a URL default; record it in ADR-0030.
- **The map's legend row**, above the map, adds: "Smaller states rest on fewer people — the Chart shows each state's 95% CI". It is not a line under the chart.
- **Find a state:**
  - A select in the toolbar listing `meta.state_labels`.
  - Choosing a state highlights it, on the map with an ink outline and on the chart with its row in ink, and pins its hover card until cleared.
  - It is view state, not data: keep it out of the URL unless it fits cleanly as `state=OH`. If it does, add it to the parameter list and to `search.test.ts`.
- **One US figure:**
  - The figure on state weights stays: the reference line, labelled "United States overall", with its 95% CI and n.
  - The national-weight figure moves into a fold, "Why two US figures?", under the header, with its 95% CI and n intact.
- **Tests:**
  - `states.test.tsx`: the default view, the legacy `view=map`, Find a state, the fold.
  - Journey 9.

### 13 · Correlates: words on the strip, labels in view (F12)

- **The strip (Compare two):** add the direction captions Find related already uses, at its ends: "← goes with lower answers to {x}" and "goes with higher answers to {x} →". The scale stays fixed at −1 to +1 (ADR-0019), with no strength words.
- **The "Correlation" label:** add a hint, "how closely two answers rise and fall together, from −1 to +1".
- **The grid:** its answer labels repeat above the grid, as well as below, so they are on screen with the first rows.
- **Tests:** `correlates.test.tsx`.

### 14 · Segments: panels named top-left, facets that don't collide (F15)

- **Panel titles:** each panel's country name is its title, top-left, in ink, 13.5 px semibold. It is no longer a label at the right edge.
- **Second split:** facets get a gap wide enough that neighbouring "10" and "0" never touch, or one shared axis per row of facets.
- **Labels:** "then by" sits above its select, as every other label does (task 5).
- **Tests:** `charts.test.tsx` (facet title position, tick spacing at 1280 and 390); journey 12.

### 15 · Decks, spacing, loading, phone ticks (F18, F19, F21, F22)

- **Decks** — one pattern: what you can see, then what to do.

  | Page | Deck |
  |---|---|
  | Atlas | "How people in {N} countries rate their own lives, from the Global Flourishing Study (2023–2024). Choose a question to compare countries." The count comes from meta, as now. |
  | What Matters | "How important seven things are to people — from being a good person to money — in a shorter survey between the two years. Start with a country's own ranking, or compare countries." |
  | US States | "How each US state compares with the country as a whole. Smaller states rest on fewer people, so their intervals are wider." |
  | Segments | "One question, split into groups of people — by age, gender, income and more — country by country." |
  | Change, Correlates | Keep. |

  Phone decks are shortened in the same voice.
- **Spacing:** `--space-4` above the axis and `--space-5` above the chart title (today about 60 px and 55 px).
- **Loading:** `LoadingBlock` becomes a skeleton in the chart's shape, same height, with the existing progress line (ADR-0013): an axis line and eight ghost rows in `--grid`. Still not a spinner.
- **Phone ticks:** dot plots under 40rem use fewer ticks (every whole unit on a 0–10 scale), so labels like "9.5" and "10.0" never touch.
- **Hover cards:** sit to the right of the hovered mark when there's room, so they don't cover the rows above it.
- **Tests:** `loading.test.tsx`; tick-count tests in `charts.test.tsx`.

### 16 · Server: whole-number bands for 0–10 scores in Compare two (F12)

- **The bug:** `bin_groups` in `services/api/src/flourish_api/routes/correlations.py` cuts a derived 0–10 score into ten equal-width bins between its weighted 1st and 99th percentiles. That gives labels like "8.1–9.0", "7.1–8.1" and "below 1.4".
- **The fix:** for a derived score whose `scale_type` is `scale_0_10` (`flourish_stats.outcomes`), round the edges outward to whole numbers and use one-point-wide bins:
  - labels "9–10", "8–9", …;
  - an end bin that takes in a tail says "below 3" or "9 and above".
  - Items in whole numbers keep today's rule.
  - Cells resting on few people keep their asterisk (ADR-0019's thresholds, unchanged).
- **ADR-0030:** record it, revising ADR-0019's binning line.
- **Tests:** API, for a derived score: the labels, the count (≤ 10), and every column still adding to 1. Regenerate the client if the schema's docstrings change.

### 17 · Server: catalog words a lay reader can read (F11)

- **Derived-score descriptions** (`flourish_stats.outcomes`):
  - "Mean of the 12 SFI items (≥ 10 answered), 0–10." → "Mean of 12 questions, for people who answered at least 10; 0–10."
  - The domain scores' "Mean of {CODE} and {CODE}, 0–10." → "Mean of '{display name}' and '{display name}', 0–10."
  - Say "Mean" in both, not "Average" (owner change 1).
- **Display names with acronyms** (`pipeline/src/flourish_pipeline/overrides/variables.yaml` and the registry): keep the acronym, after plain words.
  - "TIPI: calm, emotionally stable" → "Personality (TIPI): calm, emotionally stable"
  - "PHQ-2 depression score" → "Depression screening score (PHQ-2)"
  - "GAD-2 anxiety score" → "Anxiety screening score (GAD-2)"
  - and the same for the screen-positive flags.
- **Rebuild:**
  - Run `make data`; it rebuilds the catalog and `data/static` with the same `data_version`. Then rsync the tier.
  - Note in the PR: the release must rerun GitHub's Data build workflow before deploying, as for ADR-0020.
  - Short labels and `topics.ts` stay as they are unless a name above changes a picker row.
- **Tests:** the pipeline's override tests; the stats registry test; `test_static_contract.py`.

### 18 · Methods and the docs

- **`docs/METHODS.md`:**
  - The first sentence of the lead in plain words: "Every number here is estimated from a survey, so each comes with a 95% CI — the band drawn through each dot — and the number of people behind it."
  - The technical sentence (survey-weighted, design-based) moves into the first "For the technically minded" fold.
  - "How to read the charts" mentions the value label that reverses the order, the header key, and the toolbar.
  - Use "95% CI" throughout; never "likely range".
- **ADR-0030, "Display fixes from the 21 October review"**, records:
  - What Matters' one range;
  - US States' chart default, Find a state and the fold;
  - the Compare two bands.

  Update `docs/adr/README.md`.
- **Footer:** add a "How to read the charts" link.

## Verification

- **Per task:** run the affected vitest and pytest files.
- **At the end:**
  - `make lint typecheck`;
  - the full pytest and vitest suites, then rsync the real tier again;
  - the Playwright journeys once, with :8080 free;
  - Lighthouse;
  - the budget (before and after numbers in the PR).
- **By eye, on real data** — screenshots at 390, 768, 1280 and 1680 (don't commit them):
  - the Atlas (Life satisfaction), with the picker open;
  - Change;
  - What Matters (matrix, and Brazil's ranking);
  - Correlates (Compare two, Religious service attendance × SFI: meaning & purpose, All countries);
  - US States (chart with Ohio found, and the map);
  - Segments (gender then age);
  - a phone with Options open;
  - the Atlas offline with a median link.
- **Check, on every page:**
  - "Mean", "Median", "Distribution" and "95% CI" appear where the statistic is named;
  - there is no A–Z choice anywhere;
  - every old link in `search.test.ts` still opens a view.
- Then push and open the PR, with one line per task and the two budget numbers.
