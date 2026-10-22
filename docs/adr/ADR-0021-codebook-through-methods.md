# ADR-0021: The Codebook reached through Methods; a Methods page written for reading, with diagrams

**Status:** Accepted · **Date:** 2026-10-21 · **Phase:** 7

Changes the Phase 5/6 nav order (the Codebook leaves it). Related:
ADR-0010 (charts in `var(--token)` colours — the diagrams follow it),
ADR-0022 (the hover cards the Methods page explains).

## Context

The owner asked on 21 October 2026 to take the Codebook out of the nav
bar and link to it from Methods, and to make Methods — a long wall of
text — friendlier, with images, bullets and other formatting as needed.

Methods rendered `docs/METHODS.md` as it stands: some 500 lines of
paragraphs, the developer's detail (environment variables, module
names) mixed into the reader's, two sections saying the same thing about
change over time.

## Decision

1. **The Codebook leaves the nav** (seven items; on a phone four inline
   and three under "More"). Methods leads with "The questions … Browse
   the Codebook →", and the nav marks Methods current on every codebook
   page (`nav.ts` `covers`). The routes and every other Codebook link
   (the wording panel's) are unchanged.
2. **`docs/METHODS.md` is rewritten for reading** and keeps every fact:
   each section leads with its short version in bullets; a first section,
   "How to read the charts", explains the dot, the line, the hover card,
   the CSV and the asterisk; the two change sections are merged; the
   fine print is folded under "For the technically minded"
   (`<details>`, which GitHub renders too).
3. **Six diagrams** — how to read a chart, what weighting does, which
   weight goes with which rounds, clustered sampling, the All countries
   average, the same people over time — are React SVG components
   (`views/methods/`) drawn where the document says
   `<!-- figure: name -->` (invisible on GitHub). They use `var(--token)`
   colours like the charts. The weights diagram is drawn from the served
   `meta.weight_table` (its global rules), so no weight rule is restated
   in the client; the others draw examples labelled Country A–F, never a
   real country's numbers. A mark must sit between blocks, never inside
   a list or a fold, because the page is cut there; `views.test.tsx`
   holds that.
4. **A contents list** of the document's sections sits in a sticky
   column beside the prose on a wide screen, under the Codebook link,
   and folds above the prose on a phone.

## Alternatives considered

- **Diagrams as image files in `docs/`** — an `<img>` cannot read the
  page's tokens, so they would need hex colours, against ADR-0010.
- **Links to `/codebook` inside METHODS.md** — they would 404 on
  GitHub, where the file is also read; the link lives in the page.
- **The Codebook as a section of Methods** — it is a searchable view
  with its own routes and URL state; a link keeps both whole.

## Consequences

Easier: a Methods page that can be skimmed by its bullets and diagrams,
with the Codebook one click from where its questions are explained.
Harder: a new diagram needs a name in `views/methods/document.ts` and a
component, and its mark must stay between blocks. The nav no longer
shows the Codebook to a first-time visitor; revisit if readers report
not finding it.
