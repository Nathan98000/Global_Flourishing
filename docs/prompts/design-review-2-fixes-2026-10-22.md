# Design review, round 2 — fixes

This prompt implements every finding (G1–G18) of the second design review:
`docs/reviews/design-2026-10-22.md`. It carries the owner's decisions of
22 October 2026, listed below. Where the review's draft prompt says
otherwise, this prompt wins.

Most tasks change only the app. Tasks 1 and 3 change what the server
serves, and the static tier is rebuilt once, after task 1.

## The owner's decisions (22 Oct 2026)

1. **Thin estimates are marked at 30 people.**
   - Serving policy: `threshold = 0` (every cell is still shown, ADR-0011) and `flag_below = 30`.
   - A flagged estimate is drawn hollow, with an asterisk after its value. Its card adds "Few people — treat with care". The chart's key gains "* fewer than 30 people".
2. **No interval of zero width.**
   - When an estimate's standard error is 0 (one person, or everyone in the cell gave the same answer), the server serves no interval.
   - The card says "No 95% CI — one person" or "No 95% CI — everyone gave the same answer".
   - Intervals that run past a scale's ends are a separate statistics question. They are left as they are and noted in the ADR.
3. **For a share, the 30-person rule counts the group's answerers.**
   - A share is flagged when fewer than 30 people in its group answered the question (the share's denominator), not when fewer than 30 gave that answer.
   - The engine decides this. No new field is served, and the card's "N people in the sample gave this answer" is unchanged.
4. **Segments orders countries by each country's own estimate.**
   - Each country's estimate is the Atlas's, for the same question, year and statistic.
   - "Biggest gap first" stays. It is the highest group minus the lowest, over groups that are **not** flagged.
5. **Gender's "Prefer not to answer" stays a group** (the catalog records it as a real answer). With decisions 1 and 4 it no longer moves the order or the gap.
6. **What Matters is shaded in equal-count steps.**
   - Each of the seven shades holds about a seventh of the grid's cells, on one scale for the whole grid.
   - The key shows each step's range. This revises ADR-0030's equal-step window.
7. **Correlates: captions only.**
   - The direction captions name both questions: "← higher answers to {b} go with lower answers to {a}" and "higher answers to {b} go with higher answers to {a} →".
   - No catalog display name changes.

## How to work

- **Where:** branch `claude/design-review-2-fixes` from `main`, in the main checkout (the real data lives only there).
- **Commits:** one conventional commit per task. The first includes this prompt and the review.
- **The PR:** open it at the end with one line per task. Don't merge, tag or deploy.
- **Dev loop:** run it on real data.
  - Copy the data: `rsync -a --delete --exclude .DS_Store data/static/ apps/web/public/data/`, then `make api` and `make web`.
  - Rsync again after `make test` or `make web-fixtures`.
  - Leave :4173 alone.
  - Stop your `make api` before the Playwright journeys.
- **Rules** (project rules and owner decisions; break none without an ADR):
  - **The URL is the state:** no parameter is renamed, and every old link opens a view.
  - **The front end owns no labels and computes no statistics.** Task 3 moves one computation off the client. The gap stays a client difference of two served estimates, as it is today.
  - **Every number keeps its hover card** (`charts/theme.ts tipText`): the mark; the statistic by name; `95% CI: [X, Y]` (or the reason there is none, task 2); the n in words (ADR-0022, ADR-0024).
  - **Owner decisions that stay:** no data tables, no line under a chart, one light theme, no world map, the Codebook through Methods, every US state on its own, no A–Z ordering of a chart, every cell shown (ADR-0011).
  - **Accessibility:** a keyboard and screen-reader name for every control, 44 px targets under 40rem, visible focus, and any new colour pair in `tokens.test.ts`.
  - **Budget:** the first load stays ≤ 250 kB gzipped (214.6 now). Report before and after in the PR.
  - **Offline:** the Atlas, Segments and What Matters keep working with :8080 unreachable.
  - **The generated client:** after an API schema change, regenerate `apps/web/openapi.json` and the client.

## Tasks

### 1 · Server: thin estimates flagged, zero-width intervals not served (G2)

- **`flourish_stats`:**
  - A serving policy `SERVING_POLICY = SuppressionPolicy(threshold=0, flag_below=30)`.
  - A proportion's `flagged` counts its group's valid answers (the denominator), not the count at the level. Its `n` keeps today's meaning.
  - An estimate whose SE is 0 gets `ci_lo = ci_hi = se = null`.
- **API:** `FA_SUPPRESSION_FLAG_BELOW` defaults to 30.
- **Pipeline:** the static exporter uses the serving policy, so `meta.suppression` reads `{threshold: 0, flag_below: 30}`.
- **Other places:** the CSV header line and Methods' "Small groups" section say so.
- **ADR-0031:** "Display fixes from the 22 October review". It records decisions 1–4 and 6, revises ADR-0011's serving line and ADR-0030's shading, and notes intervals past a scale's end as an open statistics question.
- **Rebuild:** rerun the static export (`uv run flourish-pipeline run --from aggregate`), then rsync the tier. The release reruns the Data build before the next tag.
- **Tests:** stats (the denominator rule, the SE-0 rule, the policy), API (`meta.suppression`, a flagged row, a null interval), and `test_static_contract.py`.

### 2 · Web: thin estimates drawn as thin (G2)

- **Flagged marks:** dots and bars are drawn hollow (an ink outline on the paper), and the value column shows "7.12*".
- **The card:** it adds "Few people — treat with care".
- **The key:** it adds "* fewer than 30 people" whenever the chart holds a flagged row. The 30 comes from `meta.suppression.flag_below`.
- **No interval:** a row with no interval draws no whisker, and its card reads "No 95% CI — one person" (n = 1) or "No 95% CI — everyone gave the same answer".
- **Where:** Atlas, Change, US States (chart and map: a flagged state gets a hatch or outline), Segments, What Matters.
- **Tests:** `tipLines.test.ts`, `charts.test.tsx`.

### 3 · Segments: countries in their own order (G1)

- **Highest / Lowest first:** panels follow each country's own estimate, read from the Atlas's by-country response for the same question, year and statistic (static tier first, API fallback).
- **Biggest gap first:** highest minus lowest group within a country, over groups that aren't flagged. A country with fewer than two unflagged groups goes last.
- The CSV uses the same order.
- **Tests:** `charts.test.tsx` (a one-person group no longer moves a country) and the Segments view test.

### 4 · The chart header: title full width, toolbar on one row (G4)

- **`ChartFigure`:**
  - the title and subtitle span the header;
  - the toolbar sits on one row under them, with controls on the left and "How to read this chart · Download ▾" on the right;
  - the key moves to the column-header row (or, where there is none, the line before the chart).
- **US States:** the adjustment checkbox and its reason sit under the toolbar row.
- **At 768:** "What's the difference?" stays on one line beside its ⓘ.
- **Tests:** `charts.test.tsx` (the order of the header's parts).

### 5 · The phone's header, and the question button (G3, G12, G13, G14)

- **Under 40rem:**
  - the summary line stays, and the subtitle keeps only the units;
  - "How to read this chart" and Download move into the Options sheet;
  - one rule between the summary line and the chart, not two;
  - the Midyear note reads "Midyear: not asked".
- **Correlates' phone:** its note takes its own height, and its summary line names only what Options holds.
- **The question button:**
  - the name wraps and never truncates;
  - the button's second line (the wording) goes wherever the chart's wording line is on the same screen.
- **The Midyear note** aligns under the Year group at every width.
- **Target:** the Atlas's first mark ≤ 600 px at 390 × 844, measured in a journey.
- **Tests:** a new journey for that target; journeys 11 and 12.

### 6 · Find a state shows the state (G5)

- Choosing a state scrolls its row (or the map) to the middle of the screen: smooth, unless reduced motion is on.
- The pinned card stays inside the chart's box.
- The default option reads "Choose a state".
- **Tests:** `states.test.tsx`; journey 9 at 390 (the card fits).

### 7 · Segments' second split (G6)

- One fitted window shared by every facet, with tick labels thinned so they never touch.
- Levels with no estimate in any shown country are hidden.
- Under 40rem the second split's facets stack in one column per country, with the row labels once.
- **Tests:** `charts.test.tsx`. Record in the PR the page height with two splits at 390, before and after.

### 8 · The Codebook for a lay reader (G7)

- **Entry:**
  - the question;
  - its answers in words (a scale's two ends; a category list);
  - the years it was asked;
  - how many people answered.
  - Then a "For the technically minded" fold with the code table and the per-country counts, countries A–Z.
- **List:** sorted by name; "Wave" → "Year".
- Words come from the served catalog.
- **Tests:** the codebook view tests.

### 9 · Downloads that stand alone (G8)

- **CSV:**
  - the API export adds a `country` name column (and the other breakdowns' labels) after the codes;
  - the client-built CSV does the same;
  - rows follow the chart's order.
- **PNG:** under the title, the subtitle and the key line; the title in Source Serif 4.
- **Tests:** the export tests, API CSV tests, journey 4.

### 10 · Correlates' captions name both questions (G9)

- **Compare two and Find related:**
  - "← higher answers to {b} go with lower answers to {a}";
  - "higher answers to {b} go with higher answers to {a} →".
- **Find related:** the captions also sit above the list.
- **Tests:** `correlates.test.tsx`.

### 11 · What Matters in equal-count steps (G15)

- **Shading:** the grid's seven shades are cut at the cells' 1/7 … 6/7 quantiles. The key shows each step's range.
- **Text:** tint inks stay AA.
- **Tests:** `whatMatters.test.tsx`, `tokens.test.ts`.

### 12 · Smaller fixes (G10, G11, G16, G17, G18)

- **Atlas Distribution:**
  - panels in value order;
  - "Showing the four countries with the highest mean — choose others with Countries" (or "lowest", by the order);
  - the y-axis reads "Share of people (%)".
- **Offline US States:** no toolbar without a chart.
- **Share charts:** the axis on top.
- **Colour:** `accent-color: var(--accent)`; the picker's clear button in the app's colours.
- **What Matters' Within a country:** the value-label row ("Mean"), not a button.
- **The picker:**
  - a topic with no question in this year is greyed out, with "Only in the Midyear survey";
  - search matches word stems.
- **Change:** windows under 1.5 wide get ticks every 0.1 or 0.2.
- **US States' reason:** "Not available for 2023 — adjusted state figures start in 2024."
- **The keyboard:** a dot plot's or bar chart's marks can be reached by keyboard (one stop, arrow keys between rows), and the card shows on focus.
- **Tests:** per item, in the files they touch.

### 13 · Docs

- **`docs/METHODS.md`:**
  - "Small groups": the 30-person mark and the share rule;
  - "How to read the charts": the hollow dot and the asterisk;
  - the missing interval.
- **ADR index:** ADR-0031 in `docs/adr/README.md`; the status columns of ADR-0011 and ADR-0030.
- **The review:** tick the findings fixed.

## Verification

- **Per task:** the affected vitest and pytest files.
- **At the end:**
  - `make lint typecheck`;
  - the full vitest and pytest suites, then rsync the real tier again;
  - the Playwright journeys once, with :8080 free;
  - Lighthouse;
  - the budget.
- **Screenshots** (not committed), at 320, 390, 768, 1280 and 1680 of every page, plus:
  - Segments by gender (the order);
  - Segments, gender then age;
  - US States with Ohio found, at 390;
  - Correlates' longest title at 768;
  - the Atlas's TEACHINGS_10 (thin countries);
  - the CSV and PNG opened.
