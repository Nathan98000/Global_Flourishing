# ADR-0029: Controls — a question bar, a chart toolbar, one picker, ordered by value

**Status:** Accepted · **Date:** 2026-10-22 · **Phase:** 7

Revises ADR-0016's picker (decision 5's Subtopic step, and "owner
decision 1", the two-step Topic → Measure picker), the default country
the Correlates page kept (ADR-0019's page, ADR-0020 §2: "the default
stays the United States"), and ADR-0026 (sorting from labels, extended to
every chart; the corner's name sort removed). Implements option B of the
design review of 21 October 2026 (`docs/reviews/design-2026-10-21.md`,
F3–F7, F17, F20) with the owner's two changes
(`docs/prompts/design-review-fixes-2026-10-22.md`).

## Context

The review found the controls taking most of the first screen (6 of 23
Atlas rows at 1280 × 800), three ways to choose one question (Topic,
Measure, "Or search"), Sort and Order as two controls for one idea that
wrap apart, and no shared order: what is shown, when and where, and how
it is drawn were interleaved by flex-wrap. Correlates opened on the
United States while every other page opened on all countries, with two
place controls. The owner chose option B — a question bar on top, a
toolbar on the chart — and changed two things: the statistics keep their
names (Mean, Median, Distribution, "95% CI"), and nothing is sorted
alphabetically.

## Decision

1. **The question bar.** The top of every chart page holds what is shown,
   then when and where, in that order: Atlas — Question · Year ·
   Countries; US States — Question · Year; Change — Question · Countries
   (its years are fixed); Segments — Question · Split by · then by ·
   Year · Countries; What Matters — its three views stay tabs, Country ·
   Split by within a country, Question for its other questions;
   Correlates — its sentence, then Year · Where. The row aligns on its
   label lines; the line under Year runs under the whole bar.
2. **One question picker.** `QuestionPicker` (ADR-0019's) is the only way
   to choose a question: closed, a button with the short name in bold, a
   line of wording and "Change ▾", named "Question: {name}"; open, search,
   recently used, and topics with their subtopics nested — the old
   two-step picker and ADR-0016's Subtopic step survive as this browse
   column. Each page lists its own servable questions, unavailable ones
   in view with the reason. A `topic` in the URL opens the browse column
   on that topic; a pick writes `outcome` and clears `level` as before.
   `OutcomePicker` is gone. The midyear topic has one name, "What matters
   to people". The picker joins the first-load chunk: **206.1 → 210.4 kB**
   gzipped (budget 250).
3. **Countries is a button** ("All countries ▾", "3 countries ▾") whose
   panel starts with an "All countries" choice, then "Choose countries"
   with ticks.
4. **Correlates' Where.** One select — "All countries, averaged" · "Each
   country side by side" (Compare two, Find related) · each country A–Z —
   writes `country` and `scope` exactly as the Country select and the
   "In {country} | Country by country" toggle did; the toggle is gone.
   **With no `country` in the URL the page opens on All countries**, like
   every other page. Links that name a country are unaffected.
5. **The chart toolbar.** `ChartFigure`'s header puts the title and
   subtitle on the left and, on the right, the page's display controls
   (Show; Map/Chart and the adjustment switch with its reason; Measured
   as; Order countries; the answer — "Showing % who said"), "How to read
   this chart" (→ Methods' annotated diagram) and one "Download ▾" (CSV,
   PNG). A one-line key — "● mean ⟝⟞ 95% CI" — sits in the header. The
   subtitle carries the state in the controls' words: "Mean score, 0–10 ·
   2023 · all countries · highest first".
6. **Ordered by value; the value label sorts.** Every chart is ordered by
   value, highest first or reversed; a tie may fall back to name order (a
   tie-break, not a choice). There is no A–Z option anywhere. Dot plots
   and bar charts carry their statistic's word over the value column
   ("Mean", "Median", "Share", "Mean change", "Change in share"): a button
   with an arrow, inside a one-row column header (`aria-sort` belongs on
   a column header), that reverses the order and writes `dir` as the
   Order buttons did. The row names are a plain label. Segments, with no
   value column, keeps one "Order countries" select (Highest first ·
   Lowest first · Biggest gap first) writing `sort` and `dir`. What
   Matters' matrix keeps sorting from its column labels (ADR-0026) — not
   from the corner — and opens on its first column, highest first.
7. **URL.** Every parameter keeps its name. Legacy aliases: `sort=name`
   (Atlas, Change, US States, Segments, What Matters) and `qsort=name`
   read as the default value order with no notice, the `dir` that came
   with them dropped; serializing never writes `name`. `stat=median`
   reads as `quantile`. Changed defaults: What Matters' `sort` (absent =
   the first column, no longer A–Z; an unknown code means it too) and
   Correlates' `country` (absent = All countries, no longer the United
   States).

## Alternatives considered

- **A — the question as a sentence on every page** (the review's option
  A): every page needs its own grammar, long names wrap a sentence over
  several lines, and the settings that aren't nouns still need a home.
- **C — a settings panel beside the chart**: costs every chart about 290
  px at 1280, or leaves the 896 px reading column; reads as a dashboard.
- **Keep A–Z as a second sort** (the review's draft): the owner ruled it
  out — every chart answers "which is highest?".
- **`aria-sort` on the button itself**: not allowed by ARIA on a button
  (axe's aria-allowed-attr); a column header is its home.

## Consequences

Easier: one grammar on every page; one row of controls at 1280; the chart
on the first screen; the order changed where the eye already is. Harder:
a reader who never looks at the value label may not find the order — its
arrow and the subtitle's "highest first" say it. An old Correlates link
with no `country` now shows the average of every country, not the United
States. Revisit if the picker's weight on the first load matters more
than the pages it serves.
