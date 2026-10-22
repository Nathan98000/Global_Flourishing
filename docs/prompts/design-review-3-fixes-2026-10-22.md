# Design review, round 3 — fixes

This prompt implements the third design review, `docs/reviews/design-3-2026-10-22.md` (findings H1–H18; mockups in `docs/reviews/design-3-2026-10-22-mockups.html`), with the owner's decisions of 22 October 2026 listed below. Where the review's draft prompt says otherwise, this prompt wins.

Most tasks change only the app. Task 1 changes what the API serves, and task 2 changes what the static tier serves (rebuild it once, after task 2).

## The owner's decisions (22 Oct 2026)

1. **Keyboard reading (H2).**
   - Change and every Segments panel get ADR-0032's rows in this round.
   - The What Matters grids and Compare two's grid wait for a later round. Until then, their spoken summaries say the CSV holds every number with its 95% CI and n. So do the Distribution's and the map's.
2. **Row names carry the value (H3).** A ranked row is named "Indonesia, 8.10" (", few people" when flagged), and its card stays its description on focus. This revises ADR-0032.
3. **The outage notice (H6).**
   - Nothing is inserted above the page.
   - The nav marks the pages that need the live data service.
   - Each page and control keeps its own message, as the Atlas's Median already does.
   - The health check is retried once before the service counts as offline.
4. **Correlates on a phone (H8).** Under 40rem, Year and Where move into the Options sheet, and the summary line names them. This revises ADR-0029's question bar for this one page on phones.
5. **The question travels (H10).** The nav carries `outcome`, and `wave` where the target takes one, to the Atlas, Change, US States and Segments, when the target can show that question. Correlates and What Matters keep plain links.
6. **Segments (H11).**
   - A level takes a row only in the panels where it has an estimate.
   - Under 40rem with two splits, one country is shown at a time, stepped from the summary line.
7. **The API (H7).** Responses are compressed with gzip, and `/v1/change` returns transitions only when asked.
8. **Wording.**
   - The four screener descriptions are rewritten in plain words.
   - The "SFI:" names and the names written in the negative ("Not feeling lonely") stay as they are.
9. **Firefox** is not tested this round.
10. **Release order.** #68 and #69 ship first: merged, Data build, tagged, deployed. The owner does that. This prompt starts from `main` afterwards.

## How to work

- **Where:**
  - start only once #68 and #69 are on `main`; if they aren't, stop and tell the owner (decision 10);
  - branch `claude/design-review-3-fixes` from `main`, in the main checkout (the real data lives only there).
- **Commits:** one conventional commit per task. The first includes this prompt, the review and its mockups.
- **The PR:** open it at the end with one line per task. Don't merge, tag or deploy.
- **Dev loop:** on real data.
  - Copy the data: `rsync -a --delete --exclude .DS_Store data/static/ apps/web/public/data/`, then `make api` and `make web`.
  - Rsync again after `make test` or `make web-fixtures`.
  - Leave :4173 alone.
  - Stop your `make api` before the Playwright journeys.
- **Rules** (project rules and owner decisions; break none without an ADR):
  - **The URL is the state:** no parameter is renamed, and every old link opens a view. Task 12 changes the nav's link targets, not any parameter.
  - **The front end owns no labels and computes no statistics.** Picking the highest and lowest of served values, and ordering the server's list, are allowed, as today.
  - **Every number keeps its card** (`charts/theme.ts tipText`): the mark; the statistic by name; `95% CI: [X, Y]` (or why there is none); the n in words.
  - **Owner decisions that stay:** no data tables, no line under a chart, one light theme, no world map, the Codebook through Methods, every US state on its own, the thin flag at 30, every chart ordered by value.
  - **Accessibility:**
    - a keyboard and screen-reader name for every control;
    - 44 px targets under 40rem;
    - visible focus;
    - any new colour pair in `tokens.test.ts`;
    - Lighthouse accessibility stays at 1.00.
  - **Budget:** the first load stays ≤ 250 kB gzipped (218.3 now). Report before and after in the PR.
  - **Offline:** the Atlas, Segments and What Matters keep working with :8080 unreachable.
  - **The generated client:** after an API schema change, regenerate `apps/web/openapi.json` and the client.

## Tasks

### 1 · API: gzip, and a leaner Change (H7, decision 7)

- **Compression:**
  - Starlette's `GZipMiddleware`, for responses of 1 kB or more.
  - The ETag stays the uncompressed body's, sent weak (`W/"…"`) with `Vary: Accept-Encoding`, so a 304 still answers a gzipped client.
  - Check where it sits among `ops.py`'s middlewares (log → rate limit → cache/ETag).
- **`/v1/change`:**
  - Transition rows are served only with `include=transitions`.
  - The default response carries `change`, `change_share` and `change_distribution` rows.
  - Confirm with a grep that no web code reads `transition` rows (`transitionRows`), then regenerate the client.
- **Tests:**
  - `Content-Encoding: gzip` when asked, none when not;
  - a 304 with a gzipped client;
  - the default change payload has no transition rows, and `include=transitions` brings them back;
  - `test_static_contract.py` unchanged.

### 2 · The screener descriptions in plain words (decision 8)

- **Where:** the picker's line under each screener is the `description` of its entry in `DERIVED_OUTCOMES` (`stats/src/flourish_stats/outcomes.py`). It is formatted with the components' display names, like the SFI domains' ("Mean of “{}” and “{}”, 0–10.").
- **Rewrite the four, using the components' names.** Suggested wording (the owner may adjust it in review):
  - `phq2_score`: "Answers to “{}” and “{}”, scored 0–3 each and added up: 0–6. Higher means more symptoms."
  - `phq2_positive`: "Screens positive when the answers to “{}” and “{}” add up to 3 or more out of 6. The chart shows the share who do."
  - `gad2_score` and `gad2_positive`: the same, for their two questions.
- **Keep:** `scoring` (the Codebook's technical fold) stays as it is.
- **Rebuild:** `uv run flourish-pipeline run --from aggregate` (about 85 s), restore the tracked `data/manifest.json` with `git checkout`, then rsync.
- **Release:** the next tag needs a Data build.
- **Tests:** stats (`derived_description` for the four, no "served", "rescored" or "items"); the static contract test.

### 3 · Spoken summaries (H1; decision 1)

- **Distribution:** a real summary from served numbers: the four countries in their order, with each one's served mean or median. It never says "No estimates to show" while rows are drawn. Today's cause is `AtlasView.tsx`, which passes `stat === 'distribution' ? [] : displayRows`.
- **Segments and both What Matters grids:** the extremes, in words (the highest and lowest cell, with its group or item).
- **The charts with no keyboard reading after this round** (the What Matters grids, Compare two's grid, Distribution and the map): the summary ends "Every number, with its 95% CI and n, is in the CSV (Download)." This lives in the chart node's label, not on a line under the chart (ADR-0024).
- **Tests:** `charts.test.tsx` (a summary per chart kind; Distribution never empty), `whatMatters.test.tsx`.

### 4 · What changed, said aloud; values in row names (H3; decision 2)

- **The "Updated:" status line:**
  - It reads the subtitle's words plus a count of "countries", "states" or "groups". Example: "Updated: Secure Flourishing Index — mean score, 0–10 · 2024 · all countries · lowest first. 23 countries."
  - It changes on year, statistic, order, answer level and country choice.
  - "1 country", never "1 rows".
- **Row names:**
  - A ranked chart's row (RankedBar's row layer) is named "Indonesia, 8.10", or "Indonesia, 7.40, few people" when flagged.
  - The value is the one the chart prints, from the served row.
  - The card stays the row's description on focus.
- **Tests:**
  - `charts.test.tsx`;
  - a status test per page in its view test;
  - journey 14 compares the card with the row's name, so take the name up to its first comma.

### 5 · Keyboard rows for Change and Segments (H2; decision 1)

- **Change:** `ChangeDots` gets RankedBar's row layer (`withReadableRows`): one tab stop, ↑ ↓ Home End, the card on focus, and Escape closes it.
- **Segments:** each panel's levels are rows, with one tab stop for the whole chart. ↑ ↓ move within a panel, PageDown and PageUp go to the next and previous panel, and Home and End go to the panel's ends. The card names the country and the group.
- **Both:**
  - `ChartFigure interactive`, so the chart node is a labelled group;
  - row names carry their values (task 4);
  - the pointer keeps Plot's own tip.
- **Not this round:** the What Matters grids and Compare two's grid (decision 1).
- **Tests:** `charts.test.tsx`; journey 14 extended to Change and to Segments by gender.

### 6 · Find a state on a phone; no stray card (H4)

- **Focus:** `OptionsSheet`'s `close()` returns focus with `focus({ preventScroll: true })`.
- **The scroll:** Find a state's scroll runs after the sheet has closed, at once with reduced motion and smoothly without it.
- **The stray card:** after a find, Plot's pointer tip stays closed until the pointer actually moves, so a resting pointer opens no second card.
- **Tests:** `states.test.tsx`; journey 9 at 390 with `reducedMotion: 'reduce'` (Ohio's row within the screen after Done).

### 7 · Touch targets and Safari's selects (H5)

- **Under 40rem, 44 px tall:**
  - every `select`;
  - Correlates' question buttons;
  - Add questions;
  - the fold summaries ("Why two US figures?", "For the technically minded", "On this page");
  - Compare several's rows.
- **What Matters' sort buttons:** they fill their header cell.
- **The Codebook list:** each row's name is its link, and "Chart it →" goes, or gets 44 px.
- **Every `select`, at every width:** `appearance: none` with the app's own chevron, so WebKit draws it at the app's height.
- **Desktop:** the Countries list's checkboxes and the column sort button reach at least 24 px (axe `target-size`).
- **Tests:** a journey measuring every control under 40rem at ≥ 44 px (add a WebKit project for this one journey); `tokens.test.ts` if a new pair appears.

### 8 · The outage notice (H6; decision 3)

- **The band goes:**
  - When the static tier answers but the live service is offline or has no data, no band is rendered above `main`.
  - The "no data at all" and "live-only deployment" messages stay as they are.
- **The nav marks:**
  - The links to pages that need the live service (Change, Correlates, US States) carry a compact "offline" mark, with the full reason in the accessible name ("Change — needs the live data service, offline right now").
  - The nav keeps one row where its items fit (journey 11).
- **The pages:** each keeps its own message (`OfflineLine`, the Atlas's Median reason, Segments' two-split line).
- **The health check:** `useHealth` retries once after about 3 s before the service counts as offline. The global `retry: false` stays.
- **Tests:**
  - journey 6: with the API blocked, no element above `main`, the Atlas's layout shift under 0.1, and the marks present;
  - `app.test.tsx`;
  - a retry test.

### 9 · Slow phones, the web side (H7)

- **The preloads:** `crossorigin` on the three data preloads in `index.html`, so Chrome uses them (today it warns "credentials mode does not match" and downloads each file twice).
- **The shell:** `index.html` paints the wordmark and the nav before the script runs (static markup the app replaces).
- **The placeholder:** the route placeholder is shaped like the page: a question bar, then a block where the chart will be (F21).
- **The serif:** a metric-matched fallback for Source Serif 4 (`size-adjust` / `ascent-override` on a local Georgia `@font-face`), so the swap no longer reflows Methods' lead (layout shift 0.107 today, even on a fast connection).
- **Tests:**
  - the budget (report it);
  - Lighthouse on the Atlas: the CI gate, plus mobile by hand (target ≥ 0.9; record the number in the PR);
  - Methods' layout shift under 0.1 at 390 in a journey or by hand.

### 10 · Correlates on a phone (H8; decision 4)

- **Under 40rem:**
  - no help sentence (the question sentence says it);
  - Swap is a 44 px icon button at the sentence's end;
  - Year and Where move into the Options sheet, and the summary line reads "2023 · all countries, averaged · straight-line";
  - the chart title is at the deck's size (19 px).
- **From 40rem up:** nothing changes.
- **Mockup:** panel A.
- **Tests:** a journey holding the strip's number at ≤ 600 px at 390 × 844 (933 today); journey 10's phone line.

### 11 · Search ranking (H9)

- **Order:**
  - a match in the name comes before one in the wording or description;
  - within names, a whole word comes before the start of a word, then shorter names first.
- **Stems both ways:** depressed/depression, lonely/loneliness, satisfied/satisfaction.
- **Ownership:** this orders the server's list; it adds no label.
- **Tests:** `search.test.ts`:
  - "satisfied" → Life satisfaction first;
  - "happiness" → Happiness first;
  - "meaning" → SFI: meaning & purpose in the top two;
  - "depression" finds Feeling down or depressed;
  - "loneliness" finds Not feeling lonely.

### 12 · The question travels (H10; decision 5)

- **The links:** the nav's links to the Atlas, Change, US States and Segments carry the current `outcome`, and `wave` where the target takes one.
- **When the target can't show it:** if the question isn't servable there (Change needs two years; US States needs a US measure), or the year isn't available, the link carries only what the target can show.
- **Plain links:** Correlates, What Matters and Methods.
- **Tests:** `app.test.tsx`; journey 1 extended (from the Atlas with Happiness for 2024, Change opens on Happiness).

### 13 · Segments (H11; decision 6)

- **Rows:** a level takes a row only in the panels where it has an estimate, so panels differ in height.
- **On a phone:**
  - Under 40rem with two splits, one country at a time: "‹ Brazil · 3 of 23 ›" in the summary line, in the chosen order.
  - The URL's `countries` keeps the selection; the stepper doesn't add a parameter unless the owner asks.
  - Mockup panel C.
- **One country:** "Order countries" is hidden.
- **Tests:** `charts.test.tsx`; record in the PR the page height with two splits at 390 (18,763 px today).

### 14 · Pop-ups, PNG, errors, collisions (H12–H15)

- **The pop-ups:** Countries, "What's the difference?" and Download ▾ close when focus leaves them and on Escape from anywhere while open. Escape returns focus to the button.
- **PNG on HTML charts:**
  - A chart with no SVG (the What Matters grids, Compare several) offers no PNG.
  - Its menu holds the CSV and a note: "This chart can't be saved as a picture — the CSV has the same numbers."
  - No message blames "this browser".
- **Errors and edge states, in plain words:**
  - **A year the question wasn't asked:** open the nearest year it was asked, with the existing "This link asked for something we can't show" notice.
  - **5xx:** "Something went wrong on our side." and a Try again button.
  - **An unknown codebook name:** "There's no question called NOPE in this release", with a link to the Codebook.
  - **No answers in the chosen countries:** "Indonesia has no answers to this question" in place of the chart.
- **Collisions on a phone:**
  - When the key and the value label don't fit side by side, the key takes its own line above the column labels. Decide by measuring, not by page (mockup panel D).
  - Distribution's axis title clears the panel names.
  - Change's left margin fits the longest country name.
- **Tests:** per item, in the files they touch; journey 12 at 320 with Change's key.

### 15 · Structure and consistency (H16, H17, H18)

- **Structure:**
  - the chart title is an `h3`; the Codebook's title an `h2`;
  - the column labels' wrapper is presentational (no one-row table), its button named "Sort: Mean, highest first";
  - the question button is named "Question: Secure Flourishing Index — change";
  - the ⓘ glyph is `aria-hidden`;
  - the Codebook's links are named by their question;
  - Methods' "below" and "above" links are named by their sections;
  - What Matters' "Within a country" chart node is a group when it holds the "more" button, and its scroll box can be reached by keyboard;
  - the What Matters grid is named by its title.
- **Consistency:**
  - the question bar's name at 19 px (it is 17 today);
  - a 12 px minimum in HTML (the What Matters key's steps are 11);
  - the asterisk: "* fewer than 30 people" on the estimate charts, "* few people (Correlates' own rule)" on Correlates;
  - the map's key shows the dashed outline of a thin state;
  - one subtitle order: statistic and scale · year · place · order;
  - a true minus in `formatCI`;
  - "the Chart" → "the chart" in the map's key.
- **Find related:**
  - one tab stop;
  - ↑ ↓ between rows (ADR-0032's pattern);
  - Enter opens the pair.
- **Smaller:**
  - What Matters' first-row card flips above the row when there's no room below;
  - Compare several's focus ring gets a paper-coloured inner ring;
  - `/health` is fetched once per page load;
  - the picker's `<p>` nesting warning is fixed;
  - the picker's "Search 154 questions" and the Codebook's "161 questions" are explained or made to agree.
- **Tests:** `codebook.test.tsx`, `charts.test.tsx`, `correlates.test.tsx`, `tokens.test.ts` (any new pair). Lighthouse stays at 1.00.

### 16 · Docs

- **ADR-0033**, "Fixes from the third design review". It records:
  - decisions 1–7;
  - the outage notice;
  - the nav carrying the question;
  - Segments' rows and its phone stepper;
  - the API's compression and `include=transitions`.
- **Revised ADRs:**
  - ADR-0032: row names carry values; rows on Change and Segments;
  - ADR-0029: Correlates' phone layout;
  - ADR-0027: transitions served only on request.
- **ADR index:** ADR-0033, and the status columns of ADR-0027, ADR-0029 and ADR-0032.
- **`docs/METHODS.md`:**
  - the keyboard sentence names the charts that really read by keyboard: the Atlas, US States, What Matters' Other questions, Change, Segments and Correlates' country-by-country chart. Compare several's cells are buttons; for the rest, the CSV;
  - the lead mentions the hollow mark and the asterisk;
  - "wave" becomes "year" in the sidebar.
- **The review:** tick the findings fixed, in a status table at its top.

## Verification

- **Per task:** the affected vitest and pytest files.
- **At the end:**
  - `make lint typecheck`;
  - the full vitest and pytest suites, then rsync the real tier again;
  - the Playwright journeys once, with :8080 free;
  - Lighthouse (the desktop gate; mobile on the Atlas by hand);
  - the budget.
- **Browsers:** Chromium and WebKit. Firefox isn't required this round (decision 9).
- **Screenshots** (not committed), at 320, 390, 768, 1280 and 1680 of every page, plus:
  - the Distribution's accessibility snapshot;
  - Find a state at 390 with reduced motion;
  - every select at 390 in WebKit;
  - Correlates at 390;
  - Segments with two splits at 390;
  - the Atlas with the API blocked (no band; layout shift);
  - a Slow-4G film of the Atlas on a production build;
  - the four screener lines in the picker.
