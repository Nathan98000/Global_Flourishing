# Change page — 25 September

The owner's page-by-page review: the Change page (`apps/web/src/views/ChangeView.tsx`).

## How to work

- Read `CLAUDE.md` once. Touch only the files named below and the tests and copy they break.
- Don't re-read files after editing them. No refactors beyond task 4.
- Branch `claude/change-page` from `main`. If the `claude/country-filter` PR is still open, branch from `claude/country-filter` instead and say so in the PR.
- One conventional commit per task. Include this prompt file in the first one.
- Open one PR. Don't merge, tag or deploy.
- End with one line per task.

## Tasks

### 1 · Remove the "Comparing …" sentence

- Delete "Comparing 2023 → 2024. The midyear survey asked different questions, so change is measured 2023 → 2024." (`ChangeView.tsx` ~line 361).
- With a single supported pair, no pair control renders at all.
- Keep the multi-pair code path. The segmented control still appears if the data ever supports more than one pair.

### 2 · Lede states the years; no "margin of error"

Replace both deck variants (~lines 321–324).

**Long:**
> How the same people's answers changed from 2023 to 2024, country by country, among those who answered both years.

**Short:**
> How the same people's answers changed from 2023 to 2024.

Build the years from the supported pair (`pairTitle` / `WAVE_TITLES`), not literals. If the only pair ever changes, the lede follows.

### 3 · Remove the country hint

- Delete "Pick up to four countries with the Countries control to see how individual answers moved." (~line 310) and its wrapper/styles, if nothing else uses them.
- The Countries control stays.

### 4 · Picking a topic resets the measure and its settings — every view

**Bug.** The views' `handlePick` has a topic-only branch, `setSearch({ topic })`. It changes the topic but keeps the old `outcome` and its settings, such as the answer `level`. For example, after "Urban or rural", choosing "Politics & government" still shows Urban or rural's answers.

The same branch exists in `AtlasView.tsx:112`, `BreakdownsView.tsx:146` and `ChangeView.tsx:179`. Grep `setSearch({ topic })` for the others.

**Fix, in one place.**
- In `components/controls/OutcomePicker.tsx`, a topic change selects that topic's first listed measure and calls `onSelect({ outcome })`.
  - "First listed" respects the picker's current list: the page's own filter (e.g. Change's two-wave measures) and the subtopic default.
- Every view then goes through its existing new-measure branch. That branch already resets the measure-specific settings: answer level, invalid-param notice, and the comparison pair where unsupported.
- Delete the now-unused topic-only branches.
- Page-level choices stay as they are: countries, sort and order.

**Test:** a vitest on `OutcomePicker`. Changing the topic emits the first measure of the new topic, respecting a filtered list and a subtopic.

## Verification

- **Per task:** run only the affected tests, e.g. `pnpm -C apps/web vitest run <files>`.
- Update any test or Playwright journey that asserts the removed sentences; journey 7 covers Change.
- **End, once:** `make lint typecheck`, `pnpm -C apps/web vitest run`, and the Playwright journeys. Then push.
