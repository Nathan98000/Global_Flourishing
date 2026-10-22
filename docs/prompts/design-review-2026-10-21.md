# Design review — plain-language, good-looking, easier controls

A critical review of the running Flourish Atlas, judged from the point of
view of a **lay visitor**: someone curious about wellbeing around the
world, with no statistics training. Three questions drive it:

1. **Can a lay visitor understand it?** What each page is for, what to
   do first, what the chart says, and how sure the numbers are.
2. **Is it pleasing to look at?** Typography, spacing, colour, rhythm,
   consistency from page to page.
3. **Can the controls at the top of each page be reorganised into
   something friendlier?** This is the owner's main interest; give it
   the most depth.

This session **reviews and proposes; it changes no app code.** It ends
with a report, mockups of the proposed controls, and (only as a draft) a
prompt to implement whatever the owner accepts. It supersedes
`docs/prompts/design-review.md`, which predates most of the current app.

## How to work

- Read `CLAUDE.md` once. Then read only: `docs/PROPOSAL.md` §4.1 (the
  audiences) and §4.4 (design principles), `docs/adr/ADR-0012-visual-identity.md`,
  `apps/web/src/styles/tokens.css` (the design system), and the titles in
  `docs/adr/README.md` (so you know which choices were the owner's).
- Look before you judge. Every finding cites a page, a URL (the URL is the
  page's state, so it is reproducible), a viewport width, and a screenshot.
- Be specific and be critical. "Spacing could be tighter" is not a
  finding; "the Countries box on the Atlas sits alone on a third row, 24 px
  below a row that has room for it" is. Prefer ten findings that matter to
  forty that don't. Say what works, too, so it isn't lost in a redesign.
- Separate **usability** (a visitor is slowed, confused or misled) from
  **taste** (it would look better). Label each.
- Write the report for the owner, in plain language. Where you must use a
  design term, say what it means in a few words.

## Get the app running on real data

From the repo root, in the main checkout (the real data is git-ignored and
lives only there):

```sh
rsync -a --delete --exclude .DS_Store data/static/ apps/web/public/data/
make api   # :8080 — US States and Correlates need it
make web   # :5173
```

- Check you are on real data: the Atlas lists **23 countries**, Indonesia
  first for the Secure Flourishing Index in 2023.
- `make web-fixtures` overwrites `apps/web/public/data` with two-country
  synthetic data. If anything runs it, run the `rsync` again.
- Port 4173 may be held by another of the owner's projects. Leave it be.

Use the browser pane: `get_page_text`/`read_page` for words and structure,
screenshots for anything visual, `resize_window` for viewports. Review at
**390 px** (phone), **768 px** (tablet), **1280 px** and **1680 px**
(desktop). Reset the viewport when done.

## 1 · Five tasks a lay visitor might bring

Do each as a first-time visitor would, starting from the home page
(`/`), first at 1280 px and again at 390 px. For each, record the steps
taken, every place you hesitated or guessed, every word a lay reader
would not know, and whether you ended up with the right answer.

1. "Which country is the most satisfied with life?"
2. "Did people in Japan feel better in 2024 than in 2023?"
3. "Do people who attend religious services more often say their lives
   are more meaningful?"
4. "What matters most to people in Brazil?"
5. "How does my state (Ohio) compare with the rest of the US?"

Then answer, for each page: in five seconds, can a lay visitor say what
the page shows and what to do first?

## 2 · The controls at the top of each page

The core of the review. As observed on 21 Oct 2026 at 1280 px (verify;
the app may have moved on):

| Page | Controls above the chart |
|---|---|
| Atlas `/` | Topic (select) · Measure (select) · Or search (text) / Wave (2023 · Midyear · 2024) · Statistic (Mean · Distribution · Median, or Share · Distribution) · Sort (By value · A–Z) · Order (High to low · Low to high) / Countries (popover, "All 23") · Answer level when the question has answers |
| Change `/change` | Topic · Measure · Or search · Sort (By change · A–Z) / Order · Countries · Answer level |
| What Matters `/what-matters` | View (By country · Within a country · Other questions), then per view: Country · Split by; or Question · Answer level · Sort · Order. The matrix sorts by clicking its column labels |
| Correlates `/correlates` | Tabs (Compare two · Compare several · Find related) · a sentence picker "How do answers to [X] relate to [Y]?" · Swap / Wave · Country · Correlation type (Straight-line · By rank) · "What's the difference?" / In United States · Country by country |
| US States `/states` | Topic · Measure · Or search / Wave · Statistic · View (Map · Chart) · Sort · Order (chart only) · Answer level / Adjusted state weights (checkbox, with a reason when unavailable) |
| Segments `/segments` | Topic · Measure · Or search / Wave · Break down by · Second breakdown / Sort countries (By value · A–Z · By gap) · Order · Countries |

On a phone most of these fold behind "More options — chart, sort,
countries".

Evaluate them, then propose. Questions to answer, among others:

- **Choosing what to look at.** Topic, Measure and "Or search" are three
  ways to pick one thing. Would one searchable picker, a browsable list,
  or Correlates' sentence ("How do answers to … relate to …?") serve a
  lay visitor better? Could every page lead with a sentence like that?
- **Grouping and order.** Is there a consistent grammar across pages —
  *what* (the question), *when and where* (year, countries), *how it's
  shown* (statistic, sort, view)? Do the same controls sit in the same
  place and order on every page? Which controls deserve the top, and
  which belong next to the chart or folded away?
- **Sorting.** Sort and Order are two controls for one idea. What Matters
  already sorts by clicking a column label (a second click reverses it).
  Should every chart sort the same way?
- **Words.** "Wave", "Statistic", "Median", "Distribution", "Answer
  level", "Correlation type: Straight-line / By rank", "Break down by",
  "Second breakdown", "Adjusted state weights", "By gap". Propose a plain
  replacement for each (e.g. Wave → Year), and say which need a one-line
  hint instead of a new word.
- **Unavailable choices.** A greyed "Midyear" or a disabled checkbox: is
  the reason discoverable without hovering?
- **State at a glance.** After several changes, can a visitor see what
  the chart now shows without re-reading every control? Consider a
  one-line summary ("Life satisfaction · 2023 · all 23 countries ·
  highest first") or making the chart title carry it.
- **Phone.** Is folding the right pattern? What does a visitor see before
  scrolling, and how many taps does each task take?
- **Weight on the page.** Do the controls compete with the chart for
  attention? How much of the first screen do they take at 1280 and 390?

Then propose **two or three distinct reorganisations** — not tweaks of one
idea. For each: a short description; a mockup of the Atlas, Correlates
and Segments headers at 1280 px and the Atlas at 390 px; how it applies to
the other pages; what it fixes; what it costs (lost flexibility, extra
clicks, build effort: small / medium / large). Recommend one and say why.

Mockups: one self-contained HTML file, `docs/reviews/design-2026-10-21-controls.html`,
using the app's own tokens (copy the values from `tokens.css`), its
fonts (Source Serif 4 for headings, the system sans for UI), and
illustrative labels only — no numbers from the data, and no external
scripts. Clickable is welcome; it only needs to show layout and flow.

## 3 · Clarity of the rest of the page

Through a lay reader's eyes, page by page:

- The opening line under the nav ("the deck"): does it say what the page
  is for, in everyday words, and is it consistent in voice across pages?
- Chart titles and subtitles: is it clear what one dot, bar, cell or
  state stands for, and which way is better? (The subtitle may say
  "Average score" where the hover card says "Mean" — is that a problem?)
- How sure the numbers are: the whiskers, the asterisks for small
  samples, the hover card ("95% CI: [X, Y]", "Based on N people"). Would
  a lay reader understand them, or know where to find out? Is the Methods
  page reachable from where the question arises?
- Words that need a plain alternative or a definition, collected into one
  glossary table: the word, where it appears, a suggested replacement.

## 4 · Aesthetics

- **Typography:** the scale in use, heading versus body contrast, line
  length in the deck and Methods, label sizes on charts, numbers in
  tabular figures.
- **Spacing and alignment:** the rhythm between control rows, the chart
  and the caption; edges that almost line up; rows that wrap unevenly at
  1280 versus 1680.
- **Colour:** whether the warm paper, ink and teal identity (ADR-0012) is
  used consistently; whether the accent does too much or too little; the
  shading in the What Matters matrix and the US map.
- **Consistency:** the same thing drawn the same way on every page
  (segmented buttons, selects, popovers, links, the "Download CSV · PNG"
  line).
- **Polish:** the loading placeholders, empty states, the offline notice,
  the footer.

For each, say what it looks like now, what it should look like, and why a
visitor would feel the difference.

## Rules the proposals must respect

Flag any proposal that breaks one of these as **reverses an owner
decision** or **breaks a project rule**, with the reason it is worth it.

- The URL is the state. Labels can change freely; the URL parameters
  (`outcome`, `wave`, `stat`, `sort`, `dir`, `countries`, `view`, …) and
  old links must keep working.
- The front end owns no labels and computes no statistics: question
  names, answer words, country and state names come from the server.
  Control labels ("Wave", "Sort") are the app's own and may change.
- Every number keeps its 95% CI and its sample size, in the hover card.
- Owner decisions not to undo without saying so: no data tables (ADR-0022),
  no line under a chart (ADR-0024), one light theme (ADR-0023), no world
  map (ADR-0016), the Codebook reached through Methods (ADR-0021), every
  US state on its own (ADR-0028).
- Accessibility: every control reachable and named for a keyboard and a
  screen reader; touch targets at least 44 px on a phone; colour pairs
  contrast-tested (`src/__tests__/tokens.test.ts`).
- The first page load stays under 250 kB gzipped (now about 206 kB); no
  new library without saying what it costs.
- The Atlas, Segments and What Matters must keep working with the live
  data service offline.

## Deliverables

1. `docs/reviews/design-2026-10-21.md`, in this order:
   - **Summary** — at most ten bullets, plain language, most important
     first.
   - **The five tasks** — a short table: task, steps, where it went
     wrong, outcome.
   - **Controls** — the evaluation, the two or three options with their
     trade-offs, the recommendation, and links to the mockups.
   - **Findings** — one entry each: severity (*Blocker*: misleads or
     unusable at some width; *Major*: a lay visitor is slowed or confused;
     *Minor*: a careful eye notices), usability or taste, page and URL,
     viewport, screenshot file, what is wrong, why it matters to a lay
     reader, the proposed change, effort.
   - **Glossary** — jargon and plain replacements.
   - **Keep** — what works and should survive any redesign.
2. `docs/reviews/design-2026-10-21-controls.html` — the mockups.
3. Screenshots saved outside git (the session scratchpad); the report
   names each file it cites.
4. At the end of the report, a **draft** implementation prompt for the
   recommended controls option, in the style of the other files in
   `docs/prompts/` (tasks, constraints, tests to update, one commit per
   task, a PR at the end, no merge or deploy). It is not to be run until
   the owner has chosen.

Commit nothing; the owner reads the report first. Finish with a
three-line note: where the report is, the recommended controls option in
one sentence, and the single most important other finding.
