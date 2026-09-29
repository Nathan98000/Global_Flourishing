# Correlates polish — 29 September

Ten owner requests for the live Correlates page (v0.9.0, ADR-0019). Two are real features: an **All countries** option and a way to reach the **midyear** questions. The rest fix labels, copy and fonts.

## Owner decisions (override earlier docs)

1. **All countries** pools everyone, each country weighted by its **adult population**. This is the planned population-rescaled option (PROPOSAL §3.3; the `pooled_population_weights` stub). Source: UN World Population Prospects 2024, ages 18+, 1 July 2023. The default stays the United States.
2. **Midyear:**
   - The Midyear chip is never greyed out, and the wave follows the question.
   - A midyear question can be paired with any other question, using the same people's answers from **2023 or 2024**. The reader picks which (task 7).
3. **The only note under each Correlates chart**, after the Data table: "Weighted so each country's sample stands for its adult population."
   - This covers all five Correlates figures. Other pages keep their footnotes.
4. **Tooltips** lose "Few people gave these answers, so this estimate is less reliable."
   - The value keeps its asterisk.
   - Still no n in any tooltip (ADR-0016).
5. **The asterisk's key reads "\* small sample size"** everywhere on the page. Thresholds are unchanged.
6. **Standing rules:**
   - no generated takeaways;
   - one chart on screen at a time;
   - no cause-and-effect reminder;
   - no small-group cutoffs;
   - no adjusted model on the page;
   - the QuestionPicker stays on Correlates only.

## How to work

- Read `CLAUDE.md` once. Don't re-read files after editing them. Refactor only what these tasks need.
- Branch `claude/correlates-polish` from `main`. One conventional commit per task; the first commit includes this prompt.
- Write **ADR-0020** ("Correlates: all countries and midyear pairs"). It supersedes ADR-0019 on the flag copy, the tooltips and the footnote, and it answers ADR-0015's "revisit the ranking floor if the sweep runs on pooled countries".
- Update `docs/METHODS.md` with:
  - population pooling: the source, the year, and China and India's combined share of the weight (about 60%);
  - midyear pairs.
- Open a PR. Don't merge, tag or deploy. End with one line per task.

## Tasks

### 1 · Compare two grid labels (`charts/CrossTab.tsx`)

- **Bug:** the bars' caption ("Share of respondents who gave each answer to …") runs into the bars when the row-label gutter is narrow.
  - Reproduce it at `/correlates?a=INCOME_FEELINGS` (the rows are 0–10).
  - The rows' title overflows the same way ("Life evaluation today · 0 = Worst possible, 10 = Best possible").
- **Cause:** `wrapLabel` puts every leftover word on its last line. Capping lines in a narrow gutter therefore produces one long last line.
- **Fix:**
  - At every width, put the caption on its own line(s) above the bars, and the rows' title on its own line(s) above the grid. Both span the chart from its left edge, as the phone layout already does.
  - The gutter then holds only row labels. Nothing is truncated.
- **The x-axis title** under the grid is bold: weight 600, `INK`, 12.5 px, matching the rows' title.
- **Test:** use a narrow gutter (binary or 0–10 rows) with the catalog's longest short names. Every text line fits its box, and the caption never overlaps a bar or its label.

### 2 · The question sentences (Compare two, Find related)

Today "How do answers to [A ▾] relate to [B ▾]?" and "What goes with [X ▾]?" have three problems:
- a 21 px serif sits beside 15 px bold sans in boxes;
- the "?" floats;
- the chevron is tiny.

Changes:
- Set each sentence in **one typeface**: the page sans at `--text-deck`, regular weight, `--ink`.
- **Picker triggers:**
  - inherit the sentence's font family and size, at weight 600, with the current light border;
  - sit on the text baseline (drop the `vertical-align` nudge);
  - have a chevron of about 0.7 em, vertically centred.
- The "?" follows the last trigger with no space.
- **Swap** moves out of the sentence: a small secondary button at the end of the line, centred on the triggers.
- **Phone:** the sentence wraps between words, a trigger may take the full width, and wrapped lines never touch.

### 3 · Tooltips, the asterisk's key and the notes

- **Tooltips:**
  - Remove `FEW_PEOPLE` from every tooltip: `pairCellTip`, `pairBarTip`, `rankedTip`, and the matrix cells in Compare several and Find related.
  - Delete the constant.
- **Asterisk wording:**
  - `FEW_PEOPLE_KEY` → `* small sample size`.
  - `FEW_PEOPLE_HIDDEN` → `, small sample size`.
  - Also replace Compare several's own `flagKey` literal and the hidden text in `CorrelationStrip`.
  - Compare two's aria-label ends "… N cells are starred: small sample size."
- **Notes:**
  - Give `ChartFigure` a `note` prop that replaces the whole provenance line: the interval clause, "n in the data table", the view's `footnote` and the Methods link.
  - All five Correlates figures pass exactly "Weighted so each country's sample stands for its adult population."
  - Remove Compare two's column explanation and Find related's overlap note from the page. Delete `overlapNote` if nothing else uses it.

### 4 · "What's the difference?" (correlation type)

Replace `METHOD_DIFFERENCE` with four short paragraphs, the method names in bold:

1. Both numbers run from −1 to 1. Near 0, answers to the two questions don't go together. Toward +1, higher answers to one go with higher answers to the other; toward −1, higher goes with lower.
2. **Straight-line (Pearson)** treats answers as numbers and asks how closely people fall along a straight line. The size of each gap counts, so it suits 0–10 scales, but a few unusual answers can pull it.
3. **By rank (Spearman)** puts people in order on each question and asks how closely the two orders match. Only the order counts, not the size of the gaps, so it suits answers like "Never … Always", and unusual answers pull it less.
4. The two are usually close. A big difference means the pattern bends (steep at one end, flat at the other), or a few unusual answers are pulling Straight-line.

Widen the panel to fit: about 26 rem on a desktop, full width on a phone.

### 5 · The country-by-country axis and the toggle's name

- **Toggle labels:**
  - Rename the scope toggle's second option from "In every country" to **"Country by country"** in Compare two and Find related. The old name reads too close to the new "All countries".
  - The first option reads "In {country}", or "All countries" when that is chosen.
  - URLs are unchanged (`scope=all`).
- **Compare two's country-by-country chart:** the subtitle and export name use "Country by country".
- **"higher" and "lower", everywhere on the page:** set these words in italic, weight 600, `INK`; the rest of the text keeps its current style. This covers:
  - Compare two's country-by-country axis ends ("← higher A goes with lower B" / "higher A goes with higher B →");
  - Find related's axis ends ("← goes with a lower X" / "goes with a higher X →") and the key above its list ("Goes with a higher X" / "Goes with a lower X");
  - the country-by-country matrix legend ("rust: goes with a lower X · teal: goes with a higher X").
- **How to build it:**
  - In SVG, use styled `tspan`s in `RankedBar`'s `axisEndMarks`, so the PNG export carries the styling. Keep the wrapping.
  - In HTML, use `<em>` with one shared style.

### 6 · All countries

**Stats** (`stats/src/flourish_stats/weights.py`):
- **Implement `pooled_population_weights`:**
  - On the wave's eligible frame, multiply each row's weight by its country's adult population ÷ the sum of that country's weights in the frame, so each country's weights sum to its adult population.
  - Rescale before dropping rows with missing answers. A country that didn't ask a question drops out of that estimate.
- **Tests:**
  - each country's weights total its population;
  - a one-country frame gives the same correlation as before (to 1e-12);
  - a small fixture matches a hand-computed weighted correlation.

**Population table:**
- **The file:** add `stats/src/flourish_stats/data/adult_population.csv` with columns `iso3, adult_population, year, source`, one row per GFS country.
  - Hong Kong is `HKG`. The UN's "China" excludes Hong Kong.
- **The numbers:**
  - Build them from the UN WPP 2024 single-age population file (1 July), using a small script under `scripts/` that rebuilds the CSV.
  - **Never type the numbers from memory.** If the download fails, stop and tell the owner.
- **Sanity test:** China plus India is 55–62% of the total.
- **No data rebuild:** the API reads the CSV. `data_version` is unchanged, and the ETag already keys on the commit.

**API:**
- **Endpoints:**
  - `/v1/correlates`, `/v1/correlations/pair` and `/v1/correlations` accept `pooled=population` in place of a country filter.
  - Without it, the one-country rule and its 422 stand.
  - `by=country_code` is unchanged.
- **Response:**
  - It states that it is pooled, which countries contributed, and the population source.
  - Each estimate carries how many countries it covers.
- Keep `min_n`, the flags and the dedupe as they are. Record the ranking-floor decision in ADR-0020.
- **Speed:**
  - Today an uncached India sweep takes about 2 s on Cloud Run; a pooled sweep covers about 208k people. Measure it.
  - If an uncached pooled Find related or Compare several request takes over 3 s, precompute the pooled correlations, either at API start (in the background) or at data build. It's your call; record it in the ADR.
  - Precomputed values must equal the on-demand estimator's to 1e-12.
  - Cold start may grow by a few seconds at most.

**Web:**
- **Country select:** "All countries" first, then the 23 countries A–Z. The URL is `country=all`, parsed in `state/search.ts`.
- **Each view works with it:**
  - Compare two: the pooled grid and correlation.
  - Compare several: the pooled table.
  - Find related: the pooled ranked list.
  - Country by country: nothing is pinned or highlighted.
- **Subtitle:**
  - Normally: "All countries, combined by adult population · Wave 1, 2023".
  - When an estimate covers fewer countries: "21 of 23 countries (not China or Egypt), combined by adult population · …". Name the missing countries when there are three or fewer; otherwise give the count only.
- **Coverage:**
  - In Compare several and Find related, a cell or row that covers fewer countries than the full set adds "Asked in 21 of 23 countries." to its tooltip.
  - Data tables and CSVs gain a Countries column for pooled estimates.

### 7 · Midyear: reachable, and paired with 2023 or 2024

**Background:**
- The midyear survey's 15 questions (`family == "midyear"`) were asked only then, and today they can't be reached at all.
- Every other servable question was asked in 2023, and most in 2024 too.
- Midyear answers can be paired with the same people's answers from either wave:

| Paired with | People | Weight | Time between answers |
|---|---|---|---|
| 2023 | 131,487 midyear respondents (`has_midyear`) | `w_l1m` (spec `y1_my`) | usually 8–12 months |
| 2024 | 116,038 who also did Wave 2 (`has_midyear` and `retained_y2`) | `w_l1m2` (spec `y1_my_y2`) | the same interview for two in three; about 6 months for the rest |

- Both weights calibrate to the Wave 1 population.
- **Don't use `my_y2`.** Its type-1 restriction exists because same-day answers aren't *change*; for a correlation, same-day answers are fine.
- For the 2024 pairing, answers come from the same interview for every respondent in China, Hong Kong, Israel, Japan, Sweden and the United States: there, the midyear items were asked in the Wave 2 interview.

**API**, at `wave=MY` with `other_wave=Y1|Y2` (default `Y1`):
- **Answers:**
  - A midyear question reads its MY answers.
  - Any other question reads the same respondent's `other_wave` answers.
  - The frame and the weight follow the table above.
- **Compare two and Compare several** need at least one midyear question. Otherwise return a 422 that says to use that wave directly.
- **Unasked questions:** a non-midyear question that wasn't asked at `other_wave` gets a 422.
- **Find related:**
  - For a midyear question, rank every midyear question and every question asked at `other_wave`.
  - For any other question, rank only the midyear questions.
- **The response** says which wave each question's answers came from.
- Pooling (task 6) works here too.
- **Tests:**
  - at `other_wave=Y2` the frame is exactly the 116,038 `w_l1m2` respondents;
  - at `Y1` it is the 131,487 `w_l1m` respondents;
  - every new 422 fires.

**Web:**
- **Wave row:**
  - Midyear is never disabled.
  - A chip is disabled only when a non-midyear question in view wasn't asked in that wave.
- **"Other questions' answers from: 2023 · 2024":**
  - A small segmented control directly under the Wave chips. It shows only at Midyear when a non-midyear question is in view, which is always the case in Find related.
  - URL `other=Y1|Y2`. The default is `Y1`, omitted from the URL.
  - Entering Midyear keeps the wave you were on: from 2024 it sets `Y2`; from 2023 (or from a link) it sets `Y1`.
  - 2024 is disabled when a question in view wasn't asked in 2024, and the row note says why.
- **The wave follows the question:**
  - Picking a midyear question at 2023 or 2024 switches to Midyear, with that wave as the other answers' wave.
  - At Midyear, when no midyear question is left in view, the wave becomes the other answers' wave.
  - At Midyear with 2024, picking a question asked only in 2023 switches the other answers to 2023.
  - Choosing 2023 or 2024 while midyear questions are in view replaces them with the defaults.
- **Choosing Midyear with no midyear question in view:**
  - Compare two: A becomes *Daily social media time* (`TIME_MEDIA`). B stays if it was asked in the other answers' wave, else it becomes `WB_TODAY`.
  - Find related: the question becomes `TIME_MEDIA`.
  - Compare several: `TIME_MEDIA` is added first, and the last question drops if there were already 10.
- **Swap notice:** one line under the row, in a polite live region, announces any automatic change of question or of the other answers' wave. For example: "Daily social media time was asked only in the midyear survey, so Life evaluation today took its place."
- **The row note at Midyear** depends on the other answers' wave:
  - 2023: "The other questions use the same people's 2023 answers, usually given 8–12 months earlier."
  - 2024: "The other questions use the same people's 2024 answers: from the same interview for two in three people, about six months later for the rest."
- **Picker:**
  - Midyear questions stay in their topic, tagged "Midyear", and are selectable at every wave.
  - At Midyear, the other questions are tagged "2023 answers" or "2024 answers".
  - A trigger holding one of them shows a small "2023" or "2024" tag.
- **Labels at Midyear:**
  - Subtitle: "{Country} · Midyear survey, with 2024 answers from the same people" (or 2023).
  - Axis titles and table headers of the other questions add "(2023)" or "(2024)".
  - Compare several shows cells between two non-midyear questions, computed on the same people.

## Verification

- **Per task:** run only the affected pytest and vitest files.
- **API tests:** pooled requests, and midyear pairs with each of `Y1` and `Y2`, including every new 422.
- **Playwright:** extend journey 10 to cover:
  - All countries in each view;
  - Midyear, reached both from the chip and from the picker, and paired with 2023 and with 2024;
  - the swap line;
  - the Country by country toggle.
- **End, once:** `make lint typecheck`, the full pytest and vitest suites, and the Playwright journeys.
- **Screenshots:** at 1470, 768 and 390 px, light and dark. Don't commit them. Cover:
  - Compare two at `?a=INCOME_FEELINGS`;
  - both sentences;
  - the info box;
  - the country-by-country axis;
  - All countries in each view;
  - a Midyear pair with each of 2023 and 2024.
- **Confirm:**
  - no overlapping or clipped text;
  - no horizontal page scroll at 390 px.
- **In the PR:** report pooled request timings, cold and warm.
- Then push.
