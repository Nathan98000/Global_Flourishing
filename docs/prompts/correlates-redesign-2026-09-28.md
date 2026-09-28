# Correlates redesign — 28 September

Reorganizes the Correlates page by task. The source is `docs/reviews/correlates-redesign-2026-09-26.md`, including its "Owner decisions (28 Sep)" section, plus the owner's wireframe. This builds on the unmerged `claude/correlates` work (ADR-0018). The page's purpose is **comparing measures against each other**; it is not centred on the SFI.

## Owner decisions (override earlier docs)

1. **Views:** **Compare two** (default) · **Compare several** · **Find related**. Across countries becomes a toggle inside Find related.
2. **Defaults:**
   - Compare two: A = *Life evaluation today* (`WB_TODAY`), B = *Feelings about household income* (`INCOME_FEELINGS`).
   - Find related: A.
   - Compare several: A, B and A's top four related questions (after the ADR-0018 dedupe).
3. **No cause-and-effect reminder anywhere on the page.** Remove it from the lede, every footnote and `NOT_CAUSES`.
4. **No n in any tooltip.** This reverts ADR-0018 §6's exception; ADR-0016 holds everywhere. n stays in the data tables and CSVs.
5. **No hidden small groups.** Every estimate is shown; unreliable ones get an asterisk (task 4). This applies to every chart and table on the page.
6. **No "Start from" presets** in Compare several.
7. **Standing rules:** no generated takeaways; one chart on screen at a time.
8. **Earlier housekeeping, approved:**
   - add `.Rhistory` and `.claude/` to `.gitignore`;
   - in `.github/workflows/deploy.yml`, `deploy-web` gets `needs: deploy-api`;
   - leave `docs/reviews/us-states-2026-09-25.md` untracked (it belongs to a later PR).

## How to work

- Read `CLAUDE.md` once. Don't re-read files after editing them. Refactor only what these tasks need.
- Stay on `claude/correlates` and add commits there; the open PR grows to cover this. One conventional commit per task. Include this prompt and the redesign review in the first commit.
- Write **ADR-0019** ("Correlates organized by task"), superseding the parts of ADR-0018 it changes: views, the Compare two chart, tooltips, flags.
- Update the PR description. Don't merge, tag or deploy.
- End with one line per task.

## Tasks

### 1 · Views, URL and copy

- **View switcher** (segmented `RadioRow`, directly under the lede): **Compare two** · **Compare several** · **Find related**.
  - `view = pair | matrix | related`, default `pair`, omitted from the URL.
  - Old links still work: `ranked` → `related`; `countries` → `related` + `scope=all`.
- **Each view owns its question pickers.** Remove the page-level Topic/Subtopic/Measure/"Or search" block.
- **URL params:**
  - Compare two: `a`, `b`. On old `view=pair` links, map `x` → `a` and `outcome` → `b`.
  - Find related: `outcome` (unchanged).
  - Compare several: `vars` (unchanged).
  - Add the new params to `search.test.ts`.
- **State carries across views:**
  - Find related's question seeds `a`.
  - Selecting a Find related row opens Compare two with `a` = the question and `b` = the row.
  - Selecting a Compare several cell opens Compare two with `a` = the column and `b` = the row.
- **Lede:** "See how answers to different questions go together."
- **A one-line purpose under the switcher for each view:**
  - Compare two: "Pick two questions to see how people's answers to one line up with their answers to the other."
  - Compare several: "Pick up to 10 questions to see how strongly each pair goes together."
  - Find related: "Pick one question to find the other questions whose answers rise or fall most closely with it, strongest first. Select any row to see the two side by side."

### 2 · One question picker (`components/controls/QuestionPicker.tsx`)

This replaces the plain dropdowns. The owner wants people to reach any question easily.

- **Closed:** a button showing the question's short label and a chevron, with an accessible name that includes its role ("First question: Life evaluation today").
- **Open:** a panel (desktop popover, ~660 px wide; a full-screen sheet under 600 px) with:
  - **Search** at the top, focused on open. It matches wording and label with the page's existing matcher (`QuestionSearch`), shows results grouped by topic, and highlights the match.
  - **Recently used:** up to 5 questions, kept in `sessionStorage` (wrapped in try/catch).
  - **Browse:** topics on the left with their counts at this wave (`topics.ts`, subtopics nested); questions on the right, each with its short label and a second line of wording truncated to one line.
  - **Unavailable questions stay visible but disabled, with the reason:** "Not asked in 2023", "Answers have no order", "Built from the same answers as {other}".
- **Keyboard:** arrows move, Enter picks, Esc closes, Tab reaches search, topics and list. Use `role="listbox"`/`option` semantics.
- **Single-select** (Compare two ×2, Find related): picking closes the panel.
- **Multi-select** (Compare several): checkboxes; questions already in the table show as checked and disabled with "In the table". The footer reads "{k} selected · room for {m} more" with **Cancel** and **Add {k} to the table**.
- Build it for Correlates only; Atlas and US States adopt it later.
- vitest: search and grouping, topic browse, keyboard path, disabled reasons, the multi-select limit.

### 3 · Shared control row

- One row: **Wave** · **Country** · **Correlation type**, each with its label above, like Wave and Country today.
- **Correlation type** is a segmented control, **Straight-line** · **By rank**, with a small "What's the difference?" info button that opens a popover: "Straight-line (Pearson): how closely two answers follow a straight line. By rank (Spearman): how consistently one rises with the other." This replaces the "Method: …" disclosure.
- The disabled-wave reason sits **under the whole row**, not inside the Wave column.
- Countries run A–Z.

### 4 · Unreliable estimates get an asterisk, never a blank

- **Rule (API settings):** a cross-tab cell is flagged when fewer than `pair_cell_flag_below = 30` people gave that pair of answers, or its column has fewer than `pair_column_flag_below = 100`. A correlation (matrix cell, Find related row) is flagged below the existing `correlates_min_n`.
- **Display:** the value followed by "*", plus a subtle dashed inner outline on flagged cells.
- **Legend entry:** "* few people behind this estimate — less reliable".
- **Tooltip adds:** "Few people gave these answers, so this estimate is less reliable." It never shows n.
- **Replace every "—" for a below-floor cell** (Across countries, Compare several) with its value and an asterisk.
- Find related's ranking floor (which questions are ranked at all) is unchanged.

### 5 · Compare two

- **Picker sentence:** "How do answers to **[A ▾]** relate to **[B ▾]**?", then **⇄ Swap**. The pickers come from task 2.
- **Title:** "{A} and {B}". **Subtitle:** "{country} · {wave title}".
- **Header row:**
  - left: a **correlation strip**, labelled "Correlation", with a 220 px −1…1 track, ticks at −1/0/+1, a dot, and the signed value;
  - right: a scope toggle, **In {country}** · **In every country**.
- **Chart: a column-percent heat grid.** Render it with Observable Plot (cell + text marks) so the PNG export works.
  - Columns are A's answers, left to right in aligned order (ADR-0015). Rows are B's answers, with "more" at the top, labelled with short answer text. 0–10 items show numbers, with their anchors in the axis title.
  - Each cell shows the weighted **share of its column** ("57%"; "<1%" below 1).
  - Tint: `SEQUENTIAL_RAMP` in fixed bins 0/5/10/20/30/45/60+ %, with the legend "Share of each column".
  - Items with more than 11 values use equal-width bins on either axis, as the current pair endpoint does for x.
- **Bars above the grid,** aligned to the columns, showing the weighted share of respondents who gave each of A's answers, with a % label on each bar. The caption sits beside the bars, in the row-label column: **"Share of respondents who gave each answer to {A short}"**.
- **Axis titles:** x = "{A short} · {anchor text}"; y = "{B short}".
- **Tooltip:** "Of people who answered {a level} to {A short}, {pct}% answered {b level} to {B short}." Add the task-4 sentence when the cell is flagged.
- **Footnote:** "Each column is the people who gave that answer to {A short}; the shading shows how they answered {B short}, adding to 100% down the column." Then the "How these numbers are made" link.
- **In every country:** one dot per country for this pair's correlation on a fixed −1…1 axis, sorted by value, with the chosen country highlighted. Only this chart shows.
- **API: `/v1/correlations/pair`** returns a weighted cross-tab instead of group means:
  - per cell: column share, and `flagged`;
  - per column: share of respondents and `flagged`;
  - both axes' level labels and order, the correlation, and cell/column n (for the CSV and data table only).
  - Same weight and design as `/v1/aggregate`; the `shares_answers` 422 stays.
  - Add the per-country correlations for the scope toggle, via the existing `/v1/correlates` with `against=[b]` and `by=country_code` if that suffices.
  - Regenerate the goldens, OpenAPI and client. pytest: column shares sum to 100, flags at both thresholds, bins on both axes, aligned order.

### 6 · Compare several

- **Set builder:** "Questions in the table · {n} of 10". Chips wrap, each with a drag handle and a × (with keyboard reordering, e.g. Alt+↑/↓), and a trailing **+ Add questions** chip that opens the task-2 multi-select picker. Minimum 2, maximum 10. **No "Start from" presets.**
- **Table:**
  - Lower triangle with no empty first row or last column: rows are questions 2…n, columns 1…n−1.
  - Column headers are short names angled about −38°; no numbers anywhere.
  - Tint on a **fixed −1…1** scale, `DIVERGING_RAMP` via `divergingTint(v, 1)`.
- **Order:** **As added** · **Similar together**. The API computes the similar-together order (hierarchical clustering on 1 − |r|, average linkage, deterministic leaf order) and returns it as `similar_order` from `/v1/correlations`; the front end only reorders.
- **Legend, one line:** "−1 … +1" swatches · "* few people behind this estimate" · "· built from the same answers".
- **Tooltip:** "{±r} · {row} with {column}", plus the task-4 sentence when flagged.
- **Hint:** "Select a cell to see the two questions together."

### 7 · Find related

- **Picker sentence:** "What goes with **[question ▾]**?"
- **Toggle:** **In {country}** · **In every country**, as `scope = country | all`. "In every country" is today's Across countries matrix: the chosen country pinned and outlined, the rest A–Z, fitting all 23 at ≥ 1200 px, with its swatch legend.
- **Ranked list:**
  - fixed −1…1 axis;
  - the key and axis ends say "a higher/lower {short}";
  - rows are links or buttons that open Compare two;
  - a row hover/focus background.
- Footnote: the ADR-0018 dedupe sentence only.

## Verification

- **Per task:** run the affected pytest/vitest files only.
- **Playwright:** rewrite journey 10:
  - it lands on Compare two with the default pair;
  - open the picker: browse a topic, then search, then pick;
  - Swap;
  - In every country;
  - Compare several: add two with the multi-select picker, remove one, "Similar together", select a cell → Compare two;
  - Find related: select a row → Compare two;
  - old URLs (`view=ranked`, `view=countries`) land on the right view.
- **End, once:** `make lint typecheck`, the full pytest and vitest suites, and the Playwright journeys.
- **Screenshots:** take Playwright screenshots of each view (and the open picker) at 1470, 768 and 390 px, in light and dark themes. Don't commit them. Confirm:
  - no clipped labels;
  - the grid fits at 390 px without horizontal page scroll;
  - asterisks are visible in both themes.
- Then push.
