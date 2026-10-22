# ADR-0023: One light theme — dark mode removed

**Status:** Accepted · **Date:** 2026-10-21 · **Phase:** 7

Supersedes ADR-0012's "both themes are selected steps" (its palette, type
and controls stand for the light theme) and the proposal's dark-mode
items (§5 UI, the Phase 4 brief, the dark-mode journey).

## Context

The owner asked on 21 October 2026 to remove the dark view mode
entirely. The app shipped two themes: the warm-paper light palette and a
dark palette of selected steps, chosen by the OS preference unless the
visitor stamped one with the header's toggle (persisted in
`localStorage`, re-applied before first paint by a script in
`index.html`). Every colour token was defined twice, and the contrast
tests ran on both.

## Decision

- **One theme.** `tokens.css` keeps only its `:root` palette; the
  `prefers-color-scheme: dark` block and the `data-theme` stamps are
  gone. `color-scheme: light` on `:root` (and a `color-scheme` meta in
  `index.html`) keeps native controls and scrollbars light whatever the
  OS prefers.
- **No switch.** The header's `ThemeToggle`, `src/theme.ts` and the
  pre-paint script are deleted; nothing reads or writes the old
  `flourish-theme` key (a value left in a visitor's storage is inert).
- **Tests follow.** The token contrast tests run on the light palette
  alone, with one test that no dark scheme or theme stamp comes back;
  Playwright journey 5 now checks that an OS preferring dark still gets
  the light page and no switch.

Charts, diagrams and the PNG export are unchanged: they read tokens, and
there is now one value per token.

## Alternatives considered

- **Keep dark mode but follow the OS only (no toggle)** — the owner
  asked for it removed entirely.
- **Keep the dark tokens unused, for later** — dead tokens drift without
  their tests; restoring them is a revert of this change.

## Consequences

Easier: one palette to maintain and contrast-test; a new token is
defined once. Harder: visitors who prefer dark get the light page.
Revisit if readers ask for a dark mode; ADR-0012's dark steps are in git
history.
