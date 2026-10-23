# ADR-0033: Fixes from the third design review

**Status:** Accepted · **Date:** 2026-10-22 · **Phase:** 7

Records the owner's decisions of 22 October 2026 on the third design
review (`docs/reviews/design-3-2026-10-22.md`, findings H1–H18), carried
out by `docs/prompts/design-review-3-fixes-2026-10-22.md`. Revises
ADR-0027 (transitions served only on request), ADR-0029 (Correlates'
question bar on a phone) and ADR-0032 (row names carry their values;
rows on Change and Segments). ADR-0022's no-table rule, ADR-0024's no
line under a chart and every other owner decision stand.

Related: ADR-0008 (request-keyed ETags), ADR-0009 (the static-first fetch
layer), ADR-0011 and ADR-0031 (thin estimates shown, flagged at 30),
ADR-0013 (the API-only views and their warm-up).

## Context

The review walked the app by keyboard and through the accessibility
tree, in Chromium and WebKit, on a slow phone and with the live service
blocked. Round 2's fixes mostly held. What it found:

- a screen reader was told "No estimates to show" on every Distribution
  (H1), heard nothing when the year, statistic or order changed, and
  heard country names without their values (H3);
- six charts kept their 95% CI and n from a keyboard (H2);
- on a phone, Find a state did nothing with reduced motion (H4), about
  ten kinds of control were under 44 px and Safari drew every select at
  21 px (H5), and Correlates' answer sat below the first screen (H8);
- with the live service down, a band shoved the page down (layout shift
  0.26–0.63) and repeated the pages' own messages (H6);
- on a slow phone the page was blank for 2.8 s, three preloads were
  thrown away and the API sent up to 594 kB of uncompressed JSON per
  Change view (H7);
- the search buried the obvious answer (H9), every page forgot the
  question (H10), and Segments with two splits ran 22 phone screens with
  empty rows (H11).

## Decision

The owner's decisions 1–7, and how they were built:

1. **Keyboard reading (H2).** Change and every Segments panel get
   ADR-0032's rows now (`charts/readableRows.ts`, shared with the ranked
   charts): one tab stop, ↑ ↓ Home End, the card on focus; on Segments
   each country is a list, Page Down and Page Up go to the same group of
   the next and previous country. The What Matters grids and Compare
   two's grid wait; meanwhile their spoken summaries — and the
   Distributions' and the map's — end "Every number, with its 95% CI and
   n, is in the CSV (Download)." in the chart node's label, never a line
   under the chart. Segments and the grids give their extremes in words;
   a Distribution names its countries in order with their served means.
2. **Row names carry the value (H3).** A readable row is named "Indonesia,
   8.10" (", few people" when flagged, ", no estimate" when there is
   none); its card stays its description on focus. The "Updated:" status
   reads the chart's title and subtitle, then a count in words
   ("23 countries", "2 countries, 3 groups", "20 questions").
3. **The outage notice (H6).** Nothing is inserted above the page while
   the static tier answers. The nav's links to the pages that need the
   live service (Change, Correlates, US States) carry a compact
   "offline" (or "no data") mark under their name, out of the flow so
   the row never moves, with the reason in full in the link's name. Each
   page keeps its own message; the Atlas holds Median's line from the
   first failed check. `useHealth` retries once, about 3 s later, before
   the service counts as offline; the app's global `retry: false` stays.
   The "no data at all" and live-only messages stay as bands.
4. **Correlates on a phone (H8).** Under 40rem Year and Where join the
   correlation type in the Options sheet and the summary line names all
   three ("2023 · all countries, averaged · straight-line"); the help
   line goes, Swap is a 44 px icon at the sentence's end, and the title
   takes the deck's size. The strip's number lands at 571 px at
   390 × 844 (933 before). From 40rem up nothing changes.
5. **The question travels (H10).** The nav's links to the Atlas, Change,
   US States and Segments carry `outcome`, and `wave` where the page takes
   one, when that page can show it: Change a question asked in two years,
   US States one the United States answered (read from its by-country
   file where already loaded, never fetched for the nav), a year only
   when the question was asked then. Correlates, What Matters and Methods
   keep plain links. No parameter is renamed; every old link opens a
   view.
6. **Segments (H11).** A group takes a row only where it has an estimate:
   each country is its own plot (each wrapped row of a second split's
   facets too), stacked in one SVG so the PNG keeps them all. Under 40rem
   with two splits, one country at a time, stepped from the summary line
   ("‹ Brazil · 3 of 23 ›"); the URL's `countries` keeps the selection
   and the stepper adds no parameter. The page with two splits at 390 is
   1,468 px tall (18,763 before). One country: "Order countries" goes.
7. **The API (H7).** Responses of 1 kB or more are gzipped (Starlette's
   `GZipMiddleware`, outside the cache, so the LRU keeps plain bodies);
   the ETag still names the request — the uncompressed body — and is now
   weak (`W/"…"`), compared weakly, with `Vary: Accept-Encoding`, so a
   gzipped client's 304 still matches. `/v1/change` sends the transition
   matrix only with `include=transitions`; the client is regenerated.

And, in the same round: the screener lines in plain words (decision 8,
a Data build before the next tag); `crossorigin` on the data preloads;
a boot shell in `index.html` and a page-shaped placeholder; a
metric-matched Georgia fallback for Source Serif 4; Find a state's
scroll after the sheet closes; 44 px phone targets and the app's own
select chevron; the search ranked by the name (whole word, then word
start, then shorter) with stems both ways; plain-words errors with Try
again; pop-ups that close when focus leaves them; no PNG for a chart
drawn in HTML; and the structure and consistency fixes of H16–H18.

## Alternatives considered

- **A roving grid for the What Matters and Compare two grids now** —
  decision 1 put it in a later round; the CSV sentence covers it.
- **The outage notice as a footer band, or the top band with its height
  reserved** — a band still repeats each page's own message; the nav
  marks say it once, where a visitor chooses a page.
- **Inline "Change · offline" marks** — they wrapped the phone's nav onto
  a second row (layout shift 0.32 at 390); under the name they take no
  room.
- **Year and Where kept in view on a phone, only the help line dropped**
  — that gained about 150 px, not enough to put the answer on the first
  screen.
- **The nav fetching a question's by-country file to know whether US
  States can show it** — an extra request on Change for a link; a plain
  link when it isn't known is safe.
- **Drawing the HTML grids into the PNG** — the CSV has the same numbers;
  the menu says so instead.
- **One plot for every Segments panel** — Plot's facets share one y
  domain, so a level missing in one country still took a row there.

## Consequences

Easier: every number on Change and Segments is a key press away; a
listener hears what changed and each row's value; the live service
going down moves nothing on the page; a phone visitor reaches Correlates'
answer, every control and Segments' panels without scrolling 22 screens;
a slow phone paints the page's shape at once, downloads each data file
once and gets Change views gzipped (a categorical Change view without
transitions instead of 594 kB uncompressed).

Harder: `ChartFigure` must pass `interactive` around Change and Segments
too; Segments' panels no longer line up across countries (a group sits
where that country has one); an API client that wants the transition
matrix must ask for it; the nav reads the location's search and the
query cache.

Revisit when the What Matters and Compare two grids get a roving grid
(decision 1's later round), or if screen-reader testing shows the row
names too long to hear in browse mode.
