# Correlates follow-ups — 30 September

This comes from the owner's browser check of `claude/correlates-polish` (6f5308d) on local dev. It has two owner decisions, one copy fix and one doc fix.

## How to work

- Stay on `claude/correlates-polish`. Add one conventional commit per task; the first includes this prompt.
- Don't merge, tag or deploy. Update the PR description, and end with one line per task.
- **Standing rules:**
  - no n in any tooltip;
  - no takeaways;
  - one chart at a time;
  - no notes under a chart beyond the weighting sentence;
  - no small-group cutoffs.
  The coverage rule in task 1 is the owner's, and applies only to All countries lists.

## Tasks

### 1 · All countries lists rank only questions asked in at least half the countries

- **Seen:** in Find related, All countries, *Life evaluation today*, two questions asked in only a few countries rank high:
  - "Chinese folk teachings important" (asked in 2 of 23) ranks 3rd;
  - "Sikh teachings important" (9 of 23) ranks 4th.
  Each average covers only the countries that asked the question.
- **Rule:**
  - In an All countries ranking, a question is ranked only when its pair's average covers at least half the release's countries, rounded up (12 of 23 today; derive it from the countries served, never hard-code 12).
  - Apply the rule in the API, before ranking and cutting, so the top list fills with qualifying questions.
  - Find related's country-by-country table follows the list.
  - It works the same way at every wave and midyear pairing, for both correlation types.
- **Scope:**
  - The rule doesn't touch Compare two or Compare several (the reader picks those questions), or any one-country view. Every question stays reachable there.
- **When the chosen question is itself asked in fewer than half the countries:**
  - Find related, All countries shows an empty state instead of a list: "*{Question}* was asked in 9 of 23 countries. All countries lists include only questions asked in at least half of them — choose a country to see what goes with it."
  - That's an empty state, not a note under a chart.
- **Docs:**
  - Record the rule in ADR-0020 (it answers the "revisit" line about one-country questions crowding the lists).
  - Add a sentence to `docs/METHODS.md`.
  - Nothing on the page explains it beyond the empty state.
- **Tests:**
  - API: a question covered by fewer than half the countries is left out of a pooled ranking and not out of a one-country one; the threshold follows the served country count; the empty case returns no rows with the coverage in meta.
  - Web: the empty state's wording.

### 2 · What Matters and the US States map go back to seven shades

The two added shades (`--seq-800`, `--seq-900`) made those pages much darker, and their darkest three shades hard to tell apart. Only Compare two's grid needs nine.

- **Split the ramps:**
  - `SEQUENTIAL_RAMP` returns to the seven tokens (`--seq-100` to `--seq-700`), unchanged.
  - A separate nine-token ramp — the seven plus `--seq-800` and `--seq-900` — serves only Compare two's grid, its key and `shareTint`. The first seven shades stay identical across pages.
- **`quantizeSequential`** (the US States map and the What Matters matrix) quantizes onto seven again, and their legends show seven steps. Revert those pages' tests to seven.
- **Tests:**
  - `tokens.test` keeps the nine-step checks for the grid ramp;
  - the map's and What Matters' scales have seven steps;
  - the grid still puts 84% and 93% in different shades.

### 3 · Grid tooltips when the answers are numbers

- **Seen:** Compare two, Religious service attendance × Life evaluation today, All countries. A cell's second line reads "20% — 10".
- **Fix:** when the row's answer is a bare number (0–10 scales, counts), the second line reads "20% answered 10 on Life evaluation today". Worded answers keep "65% — Finding it very difficult on present income".
- The first line ("Religious service attendance: More than once a week") and "Likely range" are unchanged, and there's still no n.
- **Test:** both forms.

### 4 · ADR-0020's rebuild line

- ADR-0020 still says "The static tier is unchanged; no data rebuild is needed". That's no longer true: the social-media wording override and `meta.midyear_timing` live in the catalog and the static tier.
- **Say instead:**
  - a full `make data` is needed, with the same `data_version`;
  - the release reruns GitHub's Data build workflow, which overwrites that build in the bucket, before deploying.

## Verification

- Run the affected pytest and vitest files per task. At the end, run `make lint typecheck`, the full suites and the Playwright journeys once, updating journey 10 for task 1's empty state.
- **Screenshots** at 1470 and 390 px, light and dark (don't commit them):
  - Find related, All countries, *Life evaluation today*: no question asked in fewer than 12 countries;
  - the empty state for *Sikh teachings important*;
  - the US States map and the What Matters matrix, with seven shades;
  - the Compare two grid, with nine.
- Then push.
