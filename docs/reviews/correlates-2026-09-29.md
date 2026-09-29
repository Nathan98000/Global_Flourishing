# Correlates — UX & data-viz review (polish branch)

**Date:** 2026-09-29 · **Build:** `claude/correlates-polish` (0ae25b7) on local dev with the real data (not yet released)
**Method:** used the page as a first-time visitor in Chrome:
- all three views; the question picker (browse, search, keyboard);
- every wave, including Midyear with 2023 and with 2024 answers;
- one country, All countries, and Country by country;
- both correlation types; hovered cells, bars and dots; opened the data tables and the info box;
- widths 1470, 768 and 390 px; light and dark themes; the console.

Code and data were read only to confirm causes.

## Verdict

| Criterion | Score | One line |
|---|---|---|
| Visually coherent and appealing | 4 / 5 | Calm, editorial and consistent. Midyear stacks two rows of year buttons and two notes, Swap can strand on its own line, and Compare several's table has a large empty corner. |
| Easy to navigate | 3.5 / 5 | Three clear views and a very good picker. The "where" toggle sits in a different place in each view, and Midyear adds a second set of year buttons. |
| Intuitive for a first-time user | 3 / 5 | The question sentence is instantly clear. But nothing on screen now says a grid column adds to 100%, and "+0.54" has no anchor. |
| Understandable without technical knowledge | 3 / 5 | Much better copy. Still: "95% CI [43.8%, 86.4%]", "Weighted estimates (w_l1m2)", "Question ↓ · with →" and a raw "[EXAMPLE]". |
| Communicates the data | 3 / 5 | The All countries number can contradict almost every country. The grid's colours stop at 60%. Pooled lists mix in questions asked in only a few countries. |
| Free of obvious bugs | 3.5 / 5 | No console errors, no page overflow at 390 or 768. But: a codebook placeholder on screen, zero shown as negative, an orphaned Swap, and a data table that doesn't hold every number it claims. |
| Data site, not corporate dashboard | 4.5 / 5 | Yes: dot plots and heat tables, fixed scales, sources, CSV/PNG and data tables. No KPI cards. |

**Do these first:**
1. Decide how All countries should behave (H1). It is the one finding that can mislead.
2. Remove "[EXAMPLE]" from the social-media question (H2). It's a one-line fix.
3. Let the grid's colours reach 100% (H3).
4. Label the correlation above the country-by-country chart, and mark the All countries value on it (H4).
5. Put the grid's reading cue into its labels (M1).

---

## High

### H1 · "All countries" can contradict almost every country — Data (owner decision)
- **Seen:**
  - *Religious service attendance × Life evaluation today, 2023.* The correlation is positive in 20 of 23 countries (+0.02 to +0.36; United States +0.22), 0.00 in two, and −0.01 in Tanzania. All countries: **0.00**.
  - *Daily social media time × Feelings about household income, Midyear with 2024.* Negative in 13 of 23 countries (United States −0.13, China −0.10). All countries: **+0.08**.
- **Cause:** a pooled correlation mixes two things:
  - the relationship *inside* countries;
  - differences *between* countries (for example, countries where more people attend services also report lower life evaluation).
  Population weighting then gives India and China about 60% of the pool.
- **Why it matters:** readers take "All countries" to mean "the overall relationship". Here they would conclude that attendance has nothing to do with life evaluation, when it's positive almost everywhere. Nothing on the page shows or explains the gap.
- **Options** (numbers computed from the release, 29 Sep):

  | Pair | Countries positive | Everyone pooled (now) | a. Pooled inside countries | **d. Countries averaged, by population** | c. Median country |
  |---|---|---|---|---|---|
  | Religious service attendance × Life evaluation today (2023) | 20 of 23 | 0.00 | +0.06 | **+0.09** | +0.10 |
  | Daily social media time × Feelings about household income (Midyear, 2024) | 10 of 23 | +0.08 | +0.01 | **−0.01** | −0.01 |
  | Life evaluation today × Feelings about household income (2023) | 23 of 23 | +0.29 | +0.26 | **+0.30** | +0.29 |

  - **a. Pool inside countries:** compare people only with others in their own country, then combine by population.
  - **b. Keep the pooled number, but show the gap:** draw All countries as a labelled line on the country-by-country chart (see H4).
  - **c. Typical country:** the median of the country correlations.
  - **d. Countries averaged, by population (recommended, refined after running the numbers):** each country's own correlation, averaged with adult-population weights.
    - It keeps the owner's population weighting.
    - It always lands among the dots on the country-by-country chart.
    - It needs no "adjusted" language.
    - The Compare two grid can be averaged the same way: each column's shares averaged over the countries, by population. So the grid and the number agree.
    - With attendance, the plain pooled grid is flat: mean life evaluation runs 6.2, 6.3, 6.1, 6.3, 6.1 from "Never" to "More than once a week". The averaged grid rises: 6.0, 6.2, 6.3, 6.5, 6.6. The cause is who is in each column: the "More than once a week" column is 75% India, Nigeria, Egypt, Indonesia and the Philippines, against 13% of "Never".
  - The bars above the grid stay the plain population-weighted shares.
- **Recommend d + b.** d needs per-country correlations for every pair, precomputed at image build like today's pooled file, from the same single pass over the data.

### H2 · A codebook placeholder reaches the page — Bug
- **Seen:** *Daily social media time* reads "…using social media platforms, such as [EXAMPLE]?". It appears under Find related's title, and anywhere else the full wording shows. It's the only catalog wording with a bracket; the survey named platforms country by country.
- **Fix:**
  - Add a catalog override: "…using social media platforms (the survey named popular ones in each country)?".
  - Add a catalog test that no displayed wording contains "[".

### H3 · The grid's colours stop at 60%, so large differences look the same — Design
- **Seen:** *Religious service attendance × Has someone to confide in.* "Yes" runs from 84% to 93% across the columns, but every cell is the same darkest shade. Only the small "No" row shows any change. The same happens for any yes/no question, or any answer most people give.
- **Cause:** the fixed bins are 0, 5, 10, 20, 30, 45 and 60%+.
- **Fix:** keep the scale fixed, but reach the top. Either:
  - add 75% and 90% steps; or
  - use a continuous 0–100% sequential scale.
  Update the legend either way.

### H4 · The number above the country-by-country chart has no label — Design
- **Seen:** in Country by country, "Correlation +0.08" sits above 23 dots, none of which is +0.08. It is the All countries value (or the chosen country's), but nothing says so. With All countries chosen, the chart doesn't mark that value at all.
- **Fix:**
  - Label the strip with its scope: "All countries: +0.08", "United States: +0.54".
  - With All countries chosen, draw a labelled vertical rule at the pooled value in the dot chart.

### H5 · Pooled lists mix in questions asked in only a few countries — Data
- **Seen:** Find related, All countries, *Religious service attendance*. "Jewish teachings important", "Shinto teachings important" and "Chinese folk teachings important" rank 6th to 10th, beside questions asked everywhere. Only the tooltip says "Asked in 12 of 23 countries."
- **Fix:** mark partial coverage on the row itself: a muted "12 of 23" after the label, in the list and in Compare several.
  - Leaving these questions out of pooled rankings would also work, but it sits close to your "no small-group cutoffs" rule. That's your call.

## Medium

### M1 · Nothing on screen says how to read the grid — Design (touches the 29 Sep notes decision)
- **Seen:** with the column explanation removed, the only cue is "Share of each column" in the key.
  - Much of the colour shows how common each answer is overall, not the relationship. For example, "Getting by" is 36–42% in every column, so its row is dark all the way across.
  - The relationship shows only as change *along* a row, and a newcomer isn't told to look there.
- **Fix, without adding a note:**
  - Put the cue into labels: the key becomes "% of each column (columns add to 100%)".
  - Optional (your call): add an "Everyone" column at the right, showing each answer's overall share, so every column can be compared against it. It's a reference column, not a second chart.

### M2 · Tooltips read like a codebook — Copy
- **Seen:** "Of people who answered 0 to Life evaluation today, 65%\* answered Finding it very difficult on present income to Feelings about household income. 95% CI [43.8%, 86.4%]"
- **Fix:**
  - Write it as "Life evaluation today = 0: 65% find it very difficult on present income", then "Likely range: 44%–86%".
  - Leave the asterisk in the cell, not inside the sentence.
  - Still no n.

### M3 · Midyear adds a second row of year buttons and two notes — Design
- **Seen:** at Midyear there are four rows before the chart:
  1. Wave (2023 · Midyear · 2024);
  2. "Other questions' answers from" (2023 · 2024);
  3. the standing note;
  4. a swap notice that repeats the note ("…so the page now shows Midyear, with the same people's 2023 answers to the other questions").
  Two look-alike year controls mean different things. At 1470 px the extra "2023" tag also pushes Swap onto its own line.
- **Fix:**
  - Put the choice inside the standing note: "The other question uses the same people's [2023 ▾] answers, usually given 8–12 months earlier."
  - Keep the swap notice to what changed ("Daily social media time is a midyear question, so the page switched to Midyear.").
  - Use the singular ("The other question's") in Compare two.

### M4 · The 2024 timing note is wrong for many countries — Accuracy
- **Seen:** the note always says "from the same interview for two in three people, about six months later for the rest", whatever the country. In fact:
  - in the United States, China, Hong Kong, Israel, Japan and Sweden, it's the same interview for everyone;
  - in Australia, Egypt, India, Indonesia, Kenya, the Philippines, Poland, South Africa, Tanzania and Türkiye, it's about six months later for everyone.
- **Fix:** word the note for the country on screen. Keep the "two in three" line for All countries and for the mixed countries.

### M5 · The "where" toggle sits in a different place in each view — Navigation
- **Seen:** Compare two puts "In {country} · Country by country" inside the figure, right of the correlation. Find related gives it its own row above the chart, outside the figure.
- **Fix:** put it in one place in both views. Directly under the shared control row is the most discoverable.

### M6 · The data table doesn't hold every number — Accessibility
- **Seen:** Compare two's screen-reader summary ends "The data table below carries every number." But the table holds only the 44 cells:
  - no bar shares;
  - no correlation;
  - no asterisk flags.
- **Also:**
  - its caption shows the internal weight code ("Weighted estimates (w_c1).", or "(w_l1m2)" at Midyear);
  - the column headings are "Estimate" and "Measure".
- **Fix:**
  - Add the column shares, the correlation and a "Small sample" column.
  - Caption: "Weighted to each country's adult population."
  - Rename the headings "Share of column" and "Question".

### M7 · Compare several's table: empty corner, tilted headings, pale colours — Design
- **Seen:**
  - a ~250 × 150 px empty shaded block above the row labels, with "Question ↓ · with →" at its foot;
  - column names at 45°;
  - +0.34 and +0.76 differ only from pale to mid teal on the −1 to 1 ramp.
  - At Midyear, 6 of 7 chips and labels carry "(2023)", and 15 of the 21 cells are pairs of 2023 questions.
- **Fix:**
  - Drop the shaded corner.
  - Use horizontal, wrapped column headings, or number the columns to match the rows.
  - Deepen the ramp's upper steps while keeping −1 to 1 fixed.
  - At Midyear, say "(2023 answers)" once in the subtitle instead of on every label.

### M8 · The two tables' colours mean different things — Consistency
- **Seen:** Find related's country-by-country table fits its colours to the data (−0.82 to +0.82), while Compare several's are fixed at −1 to 1. The same colour means different values on the two tables.
- **Fix:** fix both at −1 to 1, on one ramp.

### M9 · Phone: the chart starts on the second screen — Design
- **Seen at 390 px:**
  - The sentence, Swap, Wave, Country, Correlation type and the info link fill the first screen. The chart title starts around 850 px and the chart itself around 1,150 px (a 390 × 844 phone shows the first 844 px).
  - Each row label sits 2–3 px under the previous row's cells, so it reads as part of the row above.
  - "<1%\*" and "65%\*" crowd their cells.
- **Fix:**
  - On phones, collapse the three shared controls into one summary line ("2023 · United States · Straight-line — Change").
  - Give each row label more space above than below.
  - Drop the "%" in narrow cells; the key already says "%".

## Low

- **L1 · "0.00" is coloured as negative.** Kenya and South Africa (and the All countries strip) show rust dots at 0.00. Use neutral ink when a value rounds to 0.00.
- **L2 · Question names used as nouns.** "Goes with a higher Daily social media time", "higher Not feeling lonely". Use "higher answers to …" in keys and axis ends.
- **L3 · Swap can strand on its own line.** At 1470 px with a "2023" tag, Swap wraps alone under the sentence, slightly indented. Keep it on the same line as the last picker and the "?".
- **L4 · A topic name that doesn't fit.** The picker's "What matters to people" topic also holds social-media time, running out of food, diligence and the arts. Call it "Midyear survey".
- **L5 · A stray bold word in the info box.** "Straight-line" is bold in the box's last sentence. The method names are already bold in their own paragraphs, so this one needn't be.
- **L6 · Find related states direction twice.** The dot key above the list and the axis ends below it both say "goes with a higher/lower …". Optional: keep only the axis ends.

## What works

- **The question sentence and picker:** search, browse by topic, wording under each option and "Midyear" tags. The keyboard works end to end: Enter, type, arrow, Enter, and focus returns to the trigger.
- **The heat grid** with its bars above is honest and readable. Asterisks with dashed outlines show in both themes. The caption no longer collides with the bars at any width.
- **Country by country** uses a fixed −1 to 1 axis, and the emphasized "higher/lower" reads well.
- **Midyear is reachable:** picking a midyear question switches the wave, and 2023 and 2024 pairings both work.
- **Layout holds up:** no horizontal page scroll at 390 or 768. Compare several scrolls inside its own box, with "2 more →".
- **Speed:** pooled and midyear requests answered in about 0.1 s locally.
- **Your standing rules all hold:**
  - one chart on screen at a time;
  - no n in tooltips;
  - no takeaways;
  - no cause-and-effect reminder;
  - asterisks, not cutoffs.

## Things you may not notice because you know the site

- **"+0.54" means nothing to a newcomer.** The −1 to 1 scale is explained only inside "What's the difference?", which sounds like it compares methods.
  - A small "ⓘ" on "Correlation" could open that box's first paragraph.
  - Fixed words under the strip (weak · moderate · strong) would help more, but they sit close to your no-takeaways rule. That's your call.
- **"All countries" and "Country by country" differ only in their second word.** They're fine once learned. H4's labels help newcomers tell them apart.

## Decisions for you

1. **All countries (H1):** average the countries by population (d) with a reference line (b); or pool inside countries (a), the median country (c), or keep today's pooling with only the line.
2. **Grid reading (M1):** move the cue into the labels (no note), and optionally add an "Everyone" column.
3. **Partial coverage in pooled lists (H5):** mark the rows, or leave those questions out of pooled rankings.
4. **Correlation anchor:** an ⓘ link only, or fixed weak/moderate/strong words under the strip.
