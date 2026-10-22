# Design review, round 3 — check the fixes, then the gaps: keyboard, screen reader, other browsers, slow and broken states

The third critical review of the running Flourish Atlas. It keeps the lay-visitor lens and the rules of the first two rounds:

- `docs/prompts/design-review-2026-10-21.md` is the round-1 prompt;
- `docs/reviews/design-2026-10-21.md` holds findings F1–F22;
- `docs/reviews/design-2026-10-22.md` holds findings G1–G18.

The fixes from those rounds are in PR #68 (G1–G17) and PR #69 (G18's keyboard reading of chart rows, ADR-0032).

This round does three things:

1. **Checks the fixes.** Is each of G1–G18 fixed as its status row says? And what about the first round's leftovers: F11 (jargon, partly fixed), F21 (the loading placeholder, never re-checked) and G6's phone half (Segments with two splits runs about 22 screens)?
2. **Reports what is new or still wrong** as findings H1, H2, … with the same severities as before.
3. **Goes deep where the first two rounds did not.** Both rounds listed these as "not tested":
   - a keyboard and screen-reader visitor;
   - phones on Safari, and Firefox;
   - slow connections and the loading states;
   - broken or empty states;
   - the deployed site.

   Add a consistency audit after three rounds of piecemeal fixes.

This session **reviews and proposes; it changes no app code** and commits nothing. It ends with a report, and with a draft prompt for the fixes, which isn't to be run until the owner has decided.

## How to work

- Read `CLAUDE.md` once. Then read only:
  - `docs/PROPOSAL.md` §4.1 (the audiences) and §4.4 (design principles);
  - `docs/adr/ADR-0012-visual-identity.md`;
  - `apps/web/src/styles/tokens.css`;
  - the round-2 review;
  - the titles in `docs/adr/README.md`, so you know which choices were the owner's (ADR-0029–0032 are the newest).
- Look before you judge. Every finding cites:
  - a page and its URL (the URL is the state, so it can be reproduced);
  - a viewport width;
  - a browser, when it isn't Chromium;
  - a screenshot file.
- Measure, don't eyeball. Take positions, sizes, font sizes and colours from the DOM (`getBoundingClientRect`, `getComputedStyle`).
- Be specific and critical. Prefer ten findings that matter to forty that don't. Say what works, too.
- Label each finding **usability** (a visitor is slowed, confused or misled), **accessibility** (a visitor using a keyboard, a screen reader, zoom or a colour-vision deficiency is blocked or slowed) or **taste** (it would look better).
- Write for the owner, in plain language. Where you must use a design or accessibility term, say what it means in a few words.
- Don't stop to ask the owner anything. Collect the decisions only they can make under **Questions for the owner** in the report.

## Get the app running on real data

**The code.** Review the newest code and record its commit in the report:
- `main`, if PRs #68 and #69 have merged;
- otherwise the head of `claude/chart-keyboard-rows` (#69, which is stacked on #68).

**The data.** The real data is git-ignored and lives only in the main checkout, `/Users/nathann/Downloads/Projects/Global_Flourishing`.

- In the main checkout:

  ```sh
  rsync -a --delete --exclude .DS_Store data/static/ apps/web/public/data/
  ```

- In a worktree, copy from the main checkout instead:

  ```sh
  rsync -a --delete --exclude .DS_Store /Users/nathann/Downloads/Projects/Global_Flourishing/data/static/ apps/web/public/data/
  ```

**Checks before you start:**
- **It is real data:** the Atlas lists **23 countries**, with Indonesia first for the Secure Flourishing Index in 2023.
- **The tier carries ADR-0031's flags:** `grep -rho '"flagged":true' apps/web/public/data | head -1` prints a line. If it prints nothing, the tier predates the fixes:
  1. in the main checkout, run `uv run flourish-pipeline run --from aggregate` (about 85 s);
  2. restore the tracked `data/manifest.json` with `git checkout`;
  3. rsync again.
- **`make web-fixtures`** overwrites `apps/web/public/data` with two-country synthetic data. If anything runs it, rsync again.

**The servers:**
- **The owner's servers.** If `make api` (:8080) and `make web` (:5173) are already running from the main checkout *on the code under review*, use them. Never stop them. Check what holds a port with `lsof -nP -iTCP:<port> -sTCP:LISTEN`.
- **Your own servers.** Otherwise run your own pair on spare ports:
  - API:
    ```sh
    FA_DATA_PATH=/Users/nathann/Downloads/Projects/Global_Flourishing/data/flourish.duckdb FA_CORS_ORIGINS=http://localhost:5183 uv run uvicorn flourish_api.main:app --port 8098
    ```
  - Web:
    ```sh
    VITE_API_BASE_URL=http://localhost:8098 pnpm -C apps/web dev --port 5183 --strictPort
    ```
  - The API only allows the :5173 and :4173 origins unless told otherwise.
  - :4173 may be held by another of the owner's projects; leave it be.
  - Stop whatever you started when you finish.

**Screenshots and keyboard walks: headless Playwright, not the browser pane.**
- The browser pane is often hidden. While it is hidden, it defers smooth scrolling and resize observers, so its screenshots lag the page.
- Its synthetic Tab key doesn't move focus.
- So write throwaway scripts in the session scratchpad that `require` Playwright from `apps/web/node_modules` by absolute path, and save every screenshot there. Phones are 2× device scale.
- Round 2's `capture.mjs` pattern works: one script per sweep, a contact sheet per page.

**Widths.**
- **Desktop:** 1280 and 1680 px.
- **Tablet:** 768 px.
- **Phone:** 390 and 320 px.
- **Height:** 800 px for desktop and 844 px for phones, so "the first screen" means the same as last time.

## 1 · The fixes, checked

Make a table like round 2's: each of G1–G18, then F11, F21 and G6's phone half. For each, give its status now (**Fixed**, **Partly**, **Not fixed**, **Worse**, or **Regressed elsewhere**), the evidence (a screenshot or a measurement), and, if not fixed, the finding it becomes.

Re-measure round 2's table of **where the first data mark lands** on each page at 1280 and 390, so the three rounds can be compared.

Check these in particular:

- **G2, thin estimates:** hollow and starred on every chart that draws them (the Atlas, Segments, US States and the map, What Matters, Change), with "Few people — treat with care" in the card. No zero-width whiskers. "CI: none (…)" where none is served.
- **G5, Find a state:** at 1280 and 390, with and without reduced motion.
- **G18, the rows read by keyboard:** on the Atlas, US States, What Matters and Compare two country by country (ADR-0032). See §3.
- **The owner's open wording flags:** the SFI domain names still read "SFI: …", and the screener descriptions say "PHQ-2 items". Report what a lay reader sees; don't propose catalog renames unless they mislead.

## 2 · Eight tasks a visitor might bring

Do each as a first-time visitor would, starting from `/`: first at 1280 px, then at 390 px. The first five are round 1's, so the three rounds can be compared. For each task, record:
- the steps taken;
- every place you hesitated or guessed;
- every word a lay reader wouldn't know;
- whether you got the right answer, and how sure the page let you be.

1. "Which country is the most satisfied with life?"
2. "Did people in Japan feel better in 2024 than in 2023?"
3. "Do people who attend religious services more often say their lives are more meaningful?"
4. "What matters most to people in Brazil?"
5. "How does my state (Ohio) compare with the rest of the US?"
6. "What goes with feeling lonely, across all the countries?"
7. "In Brazil, are younger people happier than older people, and how sure can I be?"
8. **Keyboard only, no mouse:** "What is Ohio's figure for happiness in 2024, and its 95% CI?" Then: "Which country is lowest on it?"

Then answer, for each page: in five seconds, can a lay visitor say what the page shows and what to do first?

## 3 · Keyboard and screen reader (the main depth this round)

**Keyboard walk.** On every page, at 1280 and at 390, do a full walk with Playwright's real Tab, Shift+Tab, arrows, Enter, Space and Escape. For each page, record:

- **Order:** does the tab order follow the visual order (question bar, toolbar, the chart's column labels, the chart, the footer)? Is anything skipped, or reached twice?
- **Focus visibility:** is focus always visible and never hidden behind a sticky element? Measure the ring's contrast against what is behind it, including the selected-row band and the What Matters cells.
- **Overlays:** does each overlay open, work and close by keyboard, with focus going back to the control that opened it? The overlays are:
  - the question picker (desktop panel and phone sheet);
  - the Options sheet;
  - the Countries popover;
  - Download ▾;
  - Find a state;
  - "Why two US figures?";
  - "More" in the nav.
- **Traps:** are there any? Does Escape always do the expected thing?
- **The charts:**
  - Which charts can be read row by row (ADR-0032: one tab stop, ↑ ↓ Home End, the card on focus), and which cannot?
  - Charts that cannot (Change's dots, Segments' panels, Distribution, the map, Compare two's grid, and any matrix whose cells aren't buttons): is there another path to their numbers (the summary label, the CSV)? Does the page say so?
  - Rank which ones most need the keyboard rows next.
- **Find related's row buttons:** one tab stop per row. Count them; should the list use the one-stop pattern too?

**Screen reader**, read through the accessibility tree (`locator.ariaSnapshot()`, Playwright 1.63):

- **Landmarks and headings:** a single `main`? A sensible heading order on every page?
- **Names:** does every control have a name a listener would understand out of context?
- **Chart summaries** (a group's or an image's `aria-label`): does each say what the chart shows and its extremes, in words a listener can follow? Is any too long to hear?
- **The "Updated: …" status lines:** do they fire once per change, and say enough?
- **Browse mode (ADR-0032).** A screen reader's own arrow keys read a ranked chart's row *names* but not their cards; the card comes with focus. Say whether that leaves a listener short. If so, propose the smallest fix: the value in each row's name, or a sentence before the chart.
- **No real screen reader.** None is driven here. List what the owner should check by hand with VoiceOver (⌘F5), in five or six steps.

**Beyond the keyboard:**

- **Zoom and reflow:**
  - at 1280 px with 200% browser zoom (`deviceScaleFactor` won't do; use CSS zoom or a 640 px viewport, and say which), and at 320 px: does anything clip, overlap or scroll sideways (WCAG 1.4.10)?
  - with the WCAG 1.4.12 text-spacing overrides injected.
- **Colour vision:** use CDP's `Emulation.setEmulatedVisionDeficiency` (deuteranopia, protanopia, tritanopia, achromatopsia) on:
  - Correlates' rust/teal signs;
  - the What Matters matrix;
  - the map;
  - the hollow thin marks.

  Can every meaning still be told apart without colour?
- **Reduced motion:** with `prefers-reduced-motion: reduce`, does anything still animate?
- **Touch targets:** are they at least 44 px on the phone, for every control, the chart rows included?
- **Automated audit:** run axe or Lighthouse's accessibility category on **every** page and view, not just the Atlas and Codebook that CI gates. A throwaway `lhci collect` config listing the URLs with `onlyCategories: ['accessibility']` does it. Report every failing audit, its weight-0 ones included.

## 4 · Other browsers, slow and broken states

- **WebKit and Firefox.**
  - WebKit (Safari's engine) at 390 and 1280; Firefox at 1280. If they aren't installed, run `pnpm -C apps/web exec playwright install webkit firefox` and note the download in the report.
  - Pages: the Atlas, the picker, the Options sheet, Correlates, the US map, Segments, Methods.
  - Downloads: CSV and PNG, in WebKit too.
  - Report only the differences from Chromium.
- **Slow connection.**
  - Emulate "Slow 4G" with a 4× CPU slowdown (CDP `Network.emulateNetworkConditions` and `Emulation.setCPUThrottlingRate`) at 390.
  - Film each page's load: frames every 250 ms until the first chart. Do the placeholders hold the chart's place (F21)? How long until the first chart? Measure the layout shift. Is the map's lazy load acceptable?
  - Change's live endpoint takes seconds a measure on real data. What does a visitor see meanwhile?
- **Broken and empty states.**
  - With the live service blocked (`page.route` on the API origin, aborted):
    - Which pages still work, and is each message accurate?
    - Is the outage banner's layout shift acceptable?
  - With a 500 from one endpoint: a Correlates pair, a states call.
  - With a static file missing.
  - Empty and odd states:
    - the picker's "What matters to people" topic at 2023 (round 2 couldn't check this);
    - a question with no answers in the chosen country;
    - a year in which a question wasn't asked;
    - the longest answer labels;
    - a derived score's bins.
  - Old links:
    - `/compare`, `/breakdowns`;
    - old What Matters anchors;
    - a Methods link with a hash.
- **The deployed site.**
  - Its address is in `README.md`, and `git tag` gives the latest release. Never guess an address.
  - Load each page once and note anything that differs from local beyond the code it runs.
  - Run Lighthouse's mobile preset on the Atlas by hand, for comparison with ADR-0010's recorded numbers.

## 5 · Consistency after three rounds of fixes

Measure these across every page:

- **Type:** every computed `font-size`/`font-weight` pair in use, and which aren't on the scale in `tokens.css`.
- **Colour:** every colour in use that doesn't come from a token.
- **Spacing:** the vertical gaps between the question bar, the title, the toolbar, the column labels and the chart, page by page. Which pages differ, and by how much?
- **One component, one look:** the chart key, the column labels and sort button, the hover card, the thin mark and its asterisk, "—" for a missing value, the "How to read this chart · Download ▾" pair, unavailable choices, error and empty states. Note any page that draws one of them differently.
- **Words:**
  - are the decks under the nav in one voice?
  - do the subtitles follow one pattern ("Mean score, 0–10 · 2023 · all countries · highest first")?
  - is every card worded the same way for the same statistic?
- **Methods, read top to bottom by a lay reader:**
  - Can it be skimmed?
  - Is the new material on thin estimates, missing intervals and keyboard reading where a reader would look for it?
  - Does every link from a chart land on the right section?

## Rules the proposals must respect

Flag any proposal that breaks one of these as **reverses an owner decision** or **breaks a project rule**, and say why it's worth it.

- **URLs:** the URL is the state. Labels may change; the URL parameters and old links must keep working.
- **Labels and statistics:** the front end owns no labels and computes no statistics. Question names, answer words, country and state names, and the summaries' figures come from the server. The app's own control labels may change.
- **Every number keeps its 95% CI and its n,** in its card (ADR-0022, ADR-0024). A thin estimate is shown with an asterisk and a hollow mark, never withheld (ADR-0011, ADR-0031).
- **Owner decisions not to undo without saying so:**
  - no data tables (ADR-0022);
  - no line under a chart (ADR-0024);
  - one light theme (ADR-0023);
  - no world map (ADR-0016);
  - the Codebook reached through Methods (ADR-0021);
  - every US state on its own (ADR-0028);
  - the question bar, the chart toolbar, one picker, and every chart ordered by value and sorted from its value label (ADR-0029);
  - US States opening on the chart (ADR-0030);
  - the thin flag at 30 people (ADR-0031);
  - ranked charts as labelled groups with keyboard rows (ADR-0032).
- **Accessibility:**
  - every control reachable and named for a keyboard and a screen reader;
  - touch targets at least 44 px on a phone;
  - colour pairs contrast-tested in `src/__tests__/tokens.test.ts`;
  - Lighthouse accessibility at 1.00 today. Don't propose anything that lowers it.
- **Size:** the first page load stays under 250 kB gzipped (about 218 kB now). No new library without its cost.
- **Offline:** the Atlas, Segments and What Matters must keep working with the live data service offline.

## Deliverables

1. `docs/reviews/design-3-<YYYY-MM-DD>.md` (the date you run it), in this order:
   - **How it was reviewed:** the commit; real data and the flag check; which servers; the browsers and widths; where the screenshots and scripts are; what was *not* tested.
   - **Summary:** at most ten bullets, plain language, most important first, ending with "If you do three things: …".
   - **The fixes, checked:** the §1 table and the first-mark table.
   - **The eight tasks:** a table with task, steps, where it went wrong, outcome. Compare tasks 1–5 with rounds 1 and 2 in one line each.
   - **Keyboard and screen reader:** the per-page walk table (order, focus, overlays, charts), the browse-mode verdict, and the VoiceOver checklist for the owner.
   - **Findings H1…:** one entry each:
     - severity: *Blocker* (misleads, or unusable at some width or by some means), *Major* (a visitor is slowed or confused), or *Minor* (a careful eye notices);
     - usability, accessibility or taste;
     - page and URL;
     - viewport and browser;
     - screenshot file;
     - what is wrong;
     - why it matters to the visitor it affects;
     - the proposed change;
     - effort (small / medium / large).
   - **Questions for the owner:** each decision only they can make, with the options and a recommendation.
   - **Keep:** what works and should survive.
   - **Draft implementation prompt:** labelled not to be run until the owner decides, in the style of `docs/prompts/design-review-2-fixes-2026-10-22.md`:
     - tasks grouped by finding;
     - constraints and tests to update;
     - one commit per task;
     - `make lint typecheck`, vitest, the Playwright journeys (with :8080 free), and Lighthouse;
     - a PR at the end;
     - no merge or deploy.
2. **Mockups**, only if you propose a layout change: one self-contained HTML file, `docs/reviews/design-3-<YYYY-MM-DD>-mockups.html`.
   - Use the app's tokens (copy the values from `tokens.css`) and its fonts.
   - Use illustrative labels only: no numbers from the data, no external scripts.
3. **Screenshots, films and scripts** go in the session scratchpad, outside git. The report names each file it cites.

Commit nothing; the owner reads the report first. Finish with a three-line note: where the report is, the single most important finding, and how many of G1–G18 are fixed.
