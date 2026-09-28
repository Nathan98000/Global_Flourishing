# ADR-0019: Correlates organized by task — three views with their own pickers, a heat grid for two questions, asterisks for thin estimates, no n in any tooltip

**Status:** Accepted · **Date:** 2026-09-28 · **Phase:** 7

Supersedes, in ADR-0018: §1 (the four views), §4's chart and response
(Compare two), §5's display of the table (Compare several), and §6's
tooltips-with-n and muted dashes. The rest of ADR-0018 stands: the
adjusted models off, the overlap dedupe, the fixed −1 to 1 axis, rows
and cells as real buttons, countries A–Z, the Mental health move.

Related: ADR-0010 (rendering stack, fitted windows), ADR-0011 (every cell
shown), ADR-0015 (signs follow the label; the ranking floor), ADR-0016
(interval-only tooltips), `docs/reviews/correlates-redesign-2026-09-26.md`
(with its owner decisions of 28 September),
`docs/prompts/correlates-redesign-2026-09-28.md`.

## Context

The owner reviewed the Correlates page again on 26 September, after
ADR-0018. The page was still built around one "Measure" (the Secure
Flourishing Index by default): every view hung off a page-level
Topic/Subtopic/Measure/search picker, Compare two added a second one
(seven picker controls before the chart with a religion item), and
Compare several kept the first, so its role there was unclear. Compare
two's binned scatter mixed three encodings (dot size, hollow dots,
whiskers) and, for an ordered item on y, plotted an average of answer
codes that means nothing to a reader. Compare several numbered its
columns, left an empty first row and last column, and fitted its colour
scale to whatever was picked. The owner decided the page is for
comparing measures against each other, not for measuring things against
the SFI, adopted the wireframe's layout, and ruled on the review's open
questions (below).

## Decision

1. **Three views, by task.** A segmented switcher directly under the
   lede — "See how answers to different questions go together." — picks
   **Compare two** (the default) · **Compare several** · **Find
   related** (`view = pair | matrix | related`, the default omitted); one
   line under it says what the view is for. Only the view on screen
   mounts and fetches. Across countries is no longer a view: it is Find
   related's **In every country** (`scope = all`). There is no
   cause-and-effect reminder anywhere on the page (the Methods page keeps
   the explanation).
2. **Each view owns its question pickers,** set in a sentence: "How do
   answers to **[A ▾]** relate to **[B ▾]**?" with ⇄ Swap; "What goes
   with **[question ▾]**?"; and Compare several's set builder. The
   page-level picker is gone. URL: Compare two `a` (the columns) and `b`
   (the rows), default *Life evaluation today* × *Feelings about
   household income* (`WB_TODAY`, `INCOME_FEELINGS`; `b` falls back to
   `WB_TODAY` when `a` is the default `b`); Find related `outcome`,
   default Compare two's A; Compare several `vars`, default A, B and A's
   top four correlates after the dedupe. Compare two's `a` and Find
   related's `outcome` are one question under two names: the switcher and
   the parser fold the other view's name into the one on screen, so each
   view's question seeds the next. Old links land: `view=ranked` → Find
   related, `view=countries` → Find related + `scope=all`, an old
   `view=pair` link's `x` → `a` and `outcome` → `b`; `topic` is ignored.
   A Find related row opens Compare two with a = the question, b = the
   row; a Compare several cell with a = the column, b = the row.
3. **One question picker** (`components/controls/QuestionPicker.tsx`),
   built for Correlates only. Closed, a button with the question's short
   label, its role in its accessible name ("First question: Life
   evaluation today"). Open, a panel — a ~660px popover, a full-screen
   sheet under 600px — with search (the page search's matcher over name,
   label and wording; results grouped by topic, the match marked), up to
   five recently used questions (sessionStorage, guarded), and browse
   (topics with their counts at the wave, the open topic's subtopics
   nested; questions as a short label over one line of wording).
   Unavailable questions stay visible, disabled, with the reason: "Not
   asked in 2023", "Answers have no order", "Built from the same answers
   as {other}" (and "Already the first/second question" for the other
   one itself). Listbox semantics with `aria-activedescendant`; arrows
   move, Enter picks, Escape closes, Tab walks search → recent → topics →
   list. Single-select closes on a pick; multi-select ticks within the
   table's room ("{k} selected · room for {m} more", Cancel, "Add {k} to
   the table"). The "built from the same answers" reason comes from the
   derived scores' components in their catalog details (already in the
   static tier), intersected on the client; the API's 422 stays the
   judge, and Compare two asks for no pair until those details settle.
4. **One shared control row:** Wave · Country · Correlation type, each
   under its label. Correlation type is a segmented Straight-line · By
   rank with a "What's the difference?" note (Pearson: how closely two
   answers follow a straight line; Spearman: how consistently one rises
   with the other), replacing the Method disclosure. Why a wave is
   unavailable — for a question, a pair or a table — runs under the whole
   row.
5. **An estimate few people are behind gets an asterisk, never a
   blank.** A Compare two cell is flagged when fewer than
   `FA_PAIR_CELL_FLAG_BELOW` (30) people gave that pair of answers or its
   column holds fewer than `FA_PAIR_COLUMN_FLAG_BELOW` (100); a column
   when it does; a correlation (a matrix cell, a Find related row, the
   strip) below the ranking floor (`FA_CORRELATES_MIN_N`). Flagged values
   show with "*" and a subtle dashed inner outline; the legend reads "*
   few people behind this estimate — less reliable"; the tooltip adds
   "Few people gave these answers, so this estimate is less reliable.";
   screen readers hear "few people behind this estimate". Every "—" for a
   below-floor cell is gone. Which questions Find related ranks at all is
   unchanged (ADR-0015's floor).
6. **No n in any tooltip.** ADR-0018 §6's exception is reverted: ADR-0016
   holds on this page too. Tooltips give the value and, where there is
   one, its interval ("95% CI [47.0%, 51.5%]"); the n stays in the data
   tables and CSVs.
7. **Compare two is a column-percent heat grid.**
   `GET /v1/correlations/pair` now returns a weighted cross-tab: `columns`
   (x's answers — or ten equal-width bins for a scale longer than eleven,
   as before — least to most of what x names, each with its weighted
   share of the people who answered both, CI, n and `flagged`), `rows`
   (y's, levelled the same way, bins on either axis), `cells` (column by
   column, the weighted share of the column who gave the row's answer,
   n and `flagged`; each column adds to 1), `shares` (the same cells as
   estimate rows, `by = [x, y]` — the /v1/aggregate proportion estimator
   grouped by x, same design and weight — for the data table and CSV),
   the correlation, `min_n` and both thresholds; the `shares_answers`
   422 stays. The page draws one Observable Plot SVG (so the PNG carries
   it): A's answers across, B's down with the most at the top; each cell
   its share of the column ("57%", "<1%"), tinted on `SEQUENTIAL_RAMP` in
   fixed bins 0/5/10/20/30/45/60%+ (the same shade is the same share in
   every pair; legend "Share of each column"), in the step's own ink.
   Bars above, aligned to the columns, show the share of respondents who
   gave each of A's answers, captioned in the row labels' column. Axis
   titles are the short names, with a numbered scale's ends in words
   ("Life evaluation today · 0 = Worst possible, 10 = Best possible").
   Under 520px each row's label sits over its row so the grid takes the
   full width. Tooltip: "Of people who answered {a} to {A}, {pct}
   answered {b} to {B}." with the interval. A header row holds a
   correlation strip (a 220px −1…1 track, ticks at −1/0/+1, a dot, the
   signed value) and the scope toggle; **In every country** swaps the
   grid for this pair's correlation per country on a fixed −1…1 axis,
   strongest first, the chosen country picked out (from `/v1/correlates`
   with `against = [b]`, `by = country_code`). The binned scatter goes.
8. **Compare several** has a set builder — "Questions in the table · {n}
   of 10", chips with a drag handle and ×, reordered by drag or Alt+arrow
   (a status line says where one went), and a trailing "+ Add questions"
   chip for the multi-select picker; two at least, ten at most; no
   presets. The table is the lower triangle without its empty first row
   or last column (rows 2…n, columns 1…n−1), by short name with the
   column headers angled at −38°, no numbers anywhere, tinted on a fixed
   −1…1. **Order:** As added · Similar together (`order=similar`): the
   API returns `similar_order` from `/v1/correlations` — average-linkage
   clustering on 1 − |r| (a pair built from the same answers at 0, one
   with no estimate at 1), ties toward the order asked — and the page
   only reorders. Legend on one line; tooltip "{±r} · {row} with
   {column}".
9. **Find related**: "What goes with [question ▾]?", In {country} · In
   every country (today's matrix, the chosen country pinned and
   outlined, all 23 at ≥ 1200px), the ranked list on the fixed axis with
   "a higher/lower {short}" in its key and axis ends, rows that open
   Compare two with a hover and focus background, and a footnote holding
   only the dedupe sentence.

## Alternatives considered

- **Keep the binned scatter.** An average of ordinal codes on y means
  nothing to a reader, and its three encodings competed; a column-percent
  grid reads every pair of item types the same way.
- **Bubbles sized by the share of all people** (the review's second
  option). Closer to a scatter plot, but sparse columns fade to nothing —
  exactly the answers a reader needs to see the shape of.
- **Withhold small cells** (the review's first proposal). The owner
  ruled against hiding anything: every estimate is shown, and the thin
  ones say so.
- **"Start from" presets** in Compare several. Declined by the owner:
  they add an editorial voice the page otherwise avoids.
- **Cluster on the client.** The front end computes no statistics; the
  server owns the order and the page only applies it.
- **Serve each variable's components in `/v1/variables`** for the
  picker's check. It would have needed a static re-bake; the details the
  tier already serves carry them.
- **Plot's band axes, or two plots composed**, for the grid. A single
  plot on linear scales keeps the bars and the columns on one x exactly
  and exports as one image.

## Consequences

- `/v1/correlations/pair` changed shape (the endpoint is new in this
  unreleased work, so no deployed page reads the old one); `/v1/correlations`
  gained `similar_order`; the OpenAPI schema and client are regenerated.
  The static tier is unchanged and needs no re-bake.
- Two settings join the API: `FA_PAIR_CELL_FLAG_BELOW` and
  `FA_PAIR_COLUMN_FLAG_BELOW`; `deploy.yml` sets neither (the defaults
  apply).
- The synthetic database gains the default pair (`WB_TODAY`,
  `INCOME_FEELINGS`) so tests and the journeys land where users do; the
  correlates golden is regenerated.
- Compare two fetches the derived scores' details (eleven small static
  files) to disable pairs built from the same answers.
- Responses are cached by (data version, query) — an ETag that ignores
  the build — so a browser can keep an older-shaped body across a deploy
  that changes a shape without a new data build; filed as a follow-up.
- `INCOME_FEELINGS`'s answers have no short labels, so its row labels
  wrap to two lines on a desktop; a `short_labels` override (a data
  rebuild) would tighten the grid.
- Revisit when the Atlas and US States adopt the picker, if the catalog
  gains variable-level short labels (the "{short}" helper reads one), and
  if the fixed share bins prove too coarse for items whose answers
  cluster in one or two columns.
