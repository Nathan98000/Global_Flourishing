# Correlates — redesign review (after PR `claude/correlates`)

**Date:** 2026-09-26 · **Build:** local dev, branch `claude/correlates`, real static tier + local API

**Owner decisions going in:**
- ADR-0018 is accepted, **except** that no tooltip anywhere shows n.
- The page's purpose is **comparing measures against each other**, not measuring things against the SFI.
- The owner is unhappy with the Compare two chart and with the Compare several controls.

## What I saw

### The page is still built around one "Measure"

- The top of the page is a single-question picker: Topic, Measure and "Or search", plus Subtopic for Religion. Every view hangs off it, and it defaults to the Secure Flourishing Index.
- The first things a visitor reads are "What goes with Secure Flourishing Index" and "Goes with higher Secure Flourishing Index".
- Compare two adds a second, full picker under the view switcher: "Compare with: topic", "Compare with", "Or search to compare" and Swap. With Religion selected, that's **seven** picker controls before the chart, and the chart starts below the fold at 1470 × 662.
- Nothing near the pickers says which question goes on which axis.
- Compare several keeps the top Measure picker too, so its role there is unclear: does changing it change the table? The page now has **two** search boxes, "Or search" and "Add a question".

### Compare two: the chart

- The dot sizes dominate. The huge dot at "8" pulls the eye only because many people answered 8, while the thin groups are tiny hollow dots with whiskers. It mixes three encodings (size, hollow vs filled, whiskers) around one thin line.
- **The x axis has no title**, so you have to read the chart title to know what 0–10 means.
- For a categorical y, the chart plots an **average of answer codes**. Religious service attendance by age shows "3.5" and "4.0" on a reversed axis labelled "↑ More than once a week". An average of 1–5 frequency codes means nothing to a reader.
- The subtitle runs to two lines and pushes Download CSV · PNG below it.
- The tooltip carries n ("673 people"), which the owner has now ruled out.

### Compare several: the controls and table

- The chips ("1 · Secure Flourishing Index ×") wrap two per row on the left. "Add a question" floats far right, visually unrelated to them.
- The only way to add a question is typing, so you have to already know the wording. There's no browsing by topic and no way to reorder.
- Numbered columns force a lookup: "what was 4?"
- The lower triangle leaves an **empty first row and an empty last column**.
- The color scale runs from −max to +max of whatever you picked (±0.76 here), so the same shade means different things in different tables.
- The legend wraps to two lines.

### Across the page

- The Wave hint ("Midyear isn't available…") widens the Wave column and shoves Country and Method to the middle of the row, leaving a large gap.
- "In United States" as a view name describes a place, not a task.

---

## Recommended redesign

### 1 · Organize by task, not by one measure

Three views, each with its **own** question pickers. Wave, Country and Method stay shared.

| View | You pick | You see |
|---|---|---|
| **Compare two** (default) | Question A, Question B | How answers to B are spread for each answer to A, plus their correlation |
| **Compare several** | 2–10 questions | A correlation table among them |
| **Find related** | One question | Its strongest correlates, **In {country}** or **In every country** (today's "Across countries", now a toggle inside this view) |

- The global Topic/Subtopic/Measure/"Or search" block goes away.
- Carry state between views, so switching never starts from scratch:
  - A is Find related's question;
  - Compare several's set starts from A and B;
  - selecting a cell or a ranked row opens Compare two.
- **Lede:** "See how answers to different questions go together, in one country. Things that go together aren't necessarily cause and effect."

### 2 · One question picker instead of three or four controls

- A single combobox. Click it and it lists the topics; open a topic to see its questions (subtopics nested). Type and it filters across all questions by wording and label.
- Each option shows the short label, with the full wording as a secondary line.
- Questions not asked in the chosen wave are shown disabled, with the reason.
- This replaces Topic + Subtopic + Measure + "Or search", four controls, and the same component serves every view.
- Build it for Correlates now; Atlas and US States can adopt it later.

### 3 · Compare two: a sentence picker and a heat grid

**Picker row:** "How do answers to **[Life evaluation today ▾]** relate to **[Feelings about household income ▾]** ⇄"

**Chart: a column-percent heat grid,** in the same visual language as the site's tables.
- Columns are A's answers (left to right, low to high). Rows are B's answers, with "more" at the top in the item's own order and labelled with answer text ("Never" … "More than once a week"), never codes.
- Each cell's shade is the **share of people in that column who gave that row's answer**. Each column adds to 100%, so the trend reads as a diagonal band even where few people answered.
- A thin **bar strip under the x axis** shows how many people gave each of A's answers. This replaces the dot sizes.
- A **correlation strip** in the header: a small −1 to 1 track with a dot, and the number ("+0.76"). It uses the same encoding as the Find related list, and there's no strength word.
- Axis titles on both axes, in the questions' short labels.
- **Tooltip** (a plain sentence, no n): "Of people who answered 3 to Life evaluation today, 18% answered 5 to Feelings about household income."
- Grid shape:
  - use the answer levels when an item has ≤ 11;
  - otherwise use equal-width bins, as the PR already does for x;
  - a yes/no item is a two-row or two-column grid.
- **Suppress cells** below a small count, drawn empty with a legend entry. Cross-tab cells are smaller than the current groups.
- **API:** `/v1/correlations/pair` returns a weighted cross-tab (column shares, cell flags) in place of group means. Correlation and n stay in the response and the data table/CSV.
- **Optional, behind a toggle:** "In every country" swaps the grid for this pair's correlation in each of the 23 countries, as a dot strip on −1 to 1. Only one chart shows at a time.

### 4 · Compare several: one set-builder

- A single **"Questions (6 of 10)"** field: chips in one row that wrap, each with a drag handle and ×, then an **"Add questions"** button at the end of the chips.
- The button opens the same topic-browse/search picker in **multi-select** mode: tick several, then Done.
- **Starter sets** as one-click links above it: "Wellbeing", "Mental health", "Relationships", "Faith & practice", "Money & work". A preset only fills the set; it adds no commentary.
- **Table:**
  - Drop the empty first row and last column: rows are questions 2…n, columns are questions 1…n−1.
  - Label the columns with the short names, angled, not numbers.
  - Fix the color scale at **−1 to 1** for every table, the same principle as the fixed axis.
  - **Order:** "As added" or "Similar together" (cluster the rows so related questions sit side by side).
- **Legend:** one line of swatches, "−1 · 0 · +1", plus "— too few respondents" and "· same underlying answers".
- **Tooltip:** "+0.68 · Expecting good things with Secure Flourishing Index", with no n.

### 5 · Find related

- Rename "In United States" to **Find related**. Its own picker holds one question.
- The **default question** shouldn't be the SFI (owner's decision below): the last question used, else a neutral starting point.
- Add a toggle, **In {country} | In every country**. "In every country" is today's Across countries matrix, with the chosen country pinned first.
- Title: "What goes with {question}". The key and axis ends say "higher/lower {short label}", with no SFI wording unless the SFI is the question.

### 6 · Shared details

- Put Wave, Country and Method on one compact row. The disabled-wave reason goes **under the whole row**, not inside the Wave column.
- **Remove n from every tooltip** on the page: ranked rows, matrix cells, Compare two cells. It stays in the data tables and CSVs. This reverts ADR-0018 §6's exception, so ADR-0016 holds everywhere again.
- Keep Download CSV · PNG top-right even when the subtitle wraps (the shared `ChartFigure` rule).
- Build the correlation strip (a −1…1 track with a dot) once and use it in three places: the Find related rows, the Compare two header, and the Compare several legend.

## Owner decisions (28 Sep), after the wireframe

- **Wireframe choices adopted:** Compare two is the default view; the default pair is *Life evaluation today* × *Feelings about household income*; Compare two uses the heat grid; the Compare several table offers "Similar together"; the nav label stays "Correlates".
- **No cause-and-effect reminder** anywhere on the page.
- **Compare two:**
  - Questions are chosen through the browse-and-search picker, not a plain dropdown.
  - The correlation type gets a label above it, like Wave and Country.
  - **No small-group cutoff.** Every cell shows its value; unreliable ones are marked with an asterisk.
  - The bars get a clearer, still short, description.
- **Compare several:** no "Start from" presets.
- **Find related:** add a clear line explaining what the view is for.

Implementation prompt: `docs/prompts/correlates-redesign-2026-09-28.md`.

## Decisions for the owner

1. **Default view:** Compare two (recommended), Compare several, or Find related.
2. **Default question(s):** Compare two needs a starting pair, e.g. *Life evaluation today* × *Feelings about household income*. Compare several needs a starting set, e.g. one question from each of five topics.
3. **Compare two chart:** a column-percent heat grid (recommended), or bubbles sized by the share of all people (closer to a scatter plot, but sparse columns fade).
4. **Order "Similar together"** in Compare several: include it or not.
5. **Nav label:** keep "Correlates" or rename it (e.g. "Connections").
