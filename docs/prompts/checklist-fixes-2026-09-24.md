# Checklist fixes — 24 September (follow-up to PR #47)

The pre-merge checklist of PR #47 (`claude/ux-qa-fixes`) found the problems below. Fix them **on the same branch** and push; PR #47 picks the commits up.

## How to work (token budget matters)

- Read `CLAUDE.md` once. Don't read `PROPOSAL.md`, the ADRs, or the earlier prompts except where a task names one.
- Locate code with `grep` for the quoted strings and paths below. Read only the relevant ranges. Don't re-read a file after editing it.
- Change only what each task needs. No refactors, no extras.
- **Leave alone:**
  - The dev servers already running on `:5173` and `:8080`. The API reloads itself.
  - Any `.git/claude-*` files.
- **Do not** merge, tag, deploy, or run `make data`. None of these fixes touches the pipeline. A waiting script merges and deploys after the checklist is re-run.
- Make one conventional commit per task group, include this prompt file in the first one, and push to `origin claude/ux-qa-fixes`.
- End with one line per task: what changed. Nothing else.

## 1 · Browser cache serves old API responses across releases — High

**Problem.** `services/api/src/flourish_api/ops.py` sends `Cache-Control: public, max-age=86400, stale-while-revalidate=604800`. The request URLs don't carry `data_version`, so after a deploy a browser reuses day-old responses without asking the server.

We saw this happen: `/change?outcome=CLOSE_TO` rendered "0 countries shown" from an old-shaped cached response, even though the API serves the new shape. The ETag already changes with `data_version`, but it only helps if the browser revalidates.

**Fix:**
- `ops.py`: set `CACHE_CONTROL = "public, no-cache"`, so every reuse is revalidated with `If-None-Match`, which is a cheap 304 when nothing changed. Update the API test that pins the header.
- `apps/web/src/api/http.ts` `fetchApiJson`: use `fetch(url, { cache: 'no-cache' })`. This makes browsers that still hold entries stored under the old header revalidate too. Update the file's header comment.
- Leave `fetchStaticJson` unchanged. The static tier is served with revalidation.
- Add a vitest that asserts `fetchApiJson` passes `cache: 'no-cache'`.
- `docs/adr/ADR-0008-one-envelope-two-tiers.md`: add a short "Revised (24 Sept)" note to point 3 explaining why a fixed max-age served stale envelope shapes across releases, and what replaces it.

## 2 · What Matters matrix: values unreadable — High

**Problem.** The cells use near-black text `rgb(27,26,23)` on the dark end of the sequential tint (`rgb(30,74,72)`), about 1.9:1 contrast. Most cells sit at that end, because importance ratings are 8–9.5.

**Fix:** in the shared tinted-matrix component (`charts/TransitionTable.tsx` and its CSS module), pick the cell text colour per tint step so every step meets at least 4.5:1: light ink on dark steps, dark ink on light steps.
- Take both colours and the step → ink mapping from `tokens.css`, for both themes.
- Extend `src/__tests__/tokens.test.ts` to pin text-on-tint contrast for every sequential **and** diverging step.
- In `views/WhatMattersView.tsx` (~line 526), the matrix caption repeats the figure subtitle. Keep only "Deeper tint, higher importance (2.76–9.65)".

## 3 · Facet labels collide with axis ticks — Medium

**Problem.** In `charts/SmallMultiples.tsx` (Breakdowns with a second breakdown) and `charts/CompareDomains.tsx` (Compare, "Split each country by"), the top `fx` labels sit on the same line as the top x-axis tick labels. They render as "Indo8esia" and "Primary5or less". Compare's per-row domain header is also clipped by the next column ("SFI: happiness & life satisfa…").

**Fix:**
- Put the `fx` labels on their own line above the tick labels: add top margin and offset the `fx` axis, or drop the top x-axis and keep each panel's bottom axis strip.
- Let the Compare domain header span the full row width, or wrap it; it must not be cut off.
- Add a vitest that renders both charts in jsdom and asserts each `fx` label's `y` is at least one line above the highest tick label's `y`.

## 4 · Change: say whether a rise is better for categorical items — Medium

**Problem.** The owner set directions for `CLOSE_TO`, `ACHIEVING`, `BEAUTY` (Yes is better) and `HEALTH_PROB` (No is better). But `views/ChangeView.tsx` (~lines 218–241) only adds "a rise is better/worse" for numeric items.

**Fix:** for binary and ordinal items, add it when the selected answer level is an endpoint of a directional item:
- the level is the better end if (`direction === 'lower_better'` and level = `min`) or (`higher_better` and level = `max`);
- the opposite endpoint gives "a rise is worse";
- middle levels and `direction: none` get no note.

Levels are raw codes, since shares are never aligned. Resulting subtitle: `Change in share answering "Yes", percentage points · a rise is better · 2023 → 2024`. Add vitest cases for `CLOSE_TO` Yes (better), `CLOSE_TO` No (worse), `HEALTH_PROB` Yes (worse), and a middle ordinal level (no note).

## 5 · Small fixes — Low, all required

- **Distribution bin labels crowd** at 1280 px with 3 facets ("8–99–10", `charts/Histogram.tsx`). Label every other bin when a facet is narrow, or label bin edges. No tick labels may touch.
- **US States header** still shows a weight code ("n = 32,096 · w_state_c2"). Drop the code, as in the tooltips; grep `US overall (state weights)`.
- **Compare default level.** For an added categorical measure, Compare defaults to the last level ("No"), while Atlas uses the first (`AtlasView.tsx:65`, `levels[0]`). Use the same default as Atlas, from one shared helper.

## Verification

- **Per task:** run only the affected tests, e.g. `pnpm -C apps/web vitest run <files>`, `uv run pytest services/api/tests/<file> -q`.
- **End, once:** `make lint typecheck`, `pnpm -C apps/web vitest run`, `uv run pytest services/api -q`, `pnpm -C apps/web budget`, and the Playwright journeys.
- **Push, then confirm CI is green on PR #47:** `gh pr checks 47 --watch`.
