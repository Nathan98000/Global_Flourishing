# Correlates — UX & data-viz review

**Date:** 2026-09-25 · **Build:** live site (`flourish-atlas.pages.dev`, `main`), cross-checked on local dev
**Method:** used the page as a first-time visitor in Chrome:
- tried every control, with SFI, Importance: money and Japan;
- hovered dots and cells;
- tested widths 1470, 1100, 768, 600 and 390 px, and resized between them;
- checked light and dark themes and the console.

Code was read only to confirm causes.

> **Heads-up:** during this review, the `claude/what-matters` branch was editing `HeatTable` and `CorrelatesView.tsx`. The matrix findings below come from the live build. On the in-progress branch, the new "15 more →" button moved the Correlates matrix only ~30 px per click, and scripted scrolling was reset. Check this in that PR before merging.

## Verdict

| Criterion | Score | One line |
|---|---|---|
| Visually coherent and appealing | 3.5 / 5 | Calm and consistent with the site. The heavy control block and a bold 2-line legend sentence crowd it. |
| Easy to navigate | 3 / 5 | Seven controls before any chart. At 1470 × 718, the first chart row sits at the fold. |
| Intuitive for a first-time user | 2.5 / 5 | Disabled options give no reason. The matrix rows depend on the chosen country, but the page never says so. |
| Understandable without technical knowledge | 2 / 5 | "Pearson / Spearman", "Adjusted difference", "per 1 SD", "point estimate" and "travels with" all need a statistician. |
| Communicates the data | 2.5 / 5 | The axis rescales per measure, so weak and strong look alike. A third of the top 20 repeats one construct. The chosen country sits off-screen in the matrix. |
| Free of obvious bugs | 3 / 5 | Countries out of order, clipped labels, a chart that doesn't widen on resize, and a phone chart with colliding ticks. |
| Data site, not corporate dashboard | 4 / 5 | Yes: honest caveats, a methods link, model card, CSV/PNG. |

**Owner decisions (25 Sep):**
- Remove the adjusted model ("accounting for age, gender…") from the page.
- Add two new views: compare two questions, and build your own correlation table.
- Everything else in this review is approved, as drawn in the wireframe.

Implementation prompt: `docs/prompts/correlates-2026-09-25.md`.

**Do these five first:**
1. Fix the axis at −1 to 1 for correlations.
2. Sort countries A–Z, and pin the chosen country first in the matrix.
3. Stop composites and their own items from filling the top 20.
4. Put the two charts behind a view switcher (your What Matters rule), which also gets a chart above the fold.
5. Move Model and Correlation into a plain-language "Method" disclosure.

---

## High

### H1 · The axis rescales per measure, so weak looks strong — Design
- **Seen:** for SFI the axis runs −1.0 to 1.0. For Importance: money it runs −0.1 to 0.3, so a +0.27 dot lands at the far right, exactly where SFI's +0.76 sits. For Japan it runs −0.75 to 1.00. Switching measure or country changes what "far right" means.
- **Cause:** `RankedBar` uses `fittedScale`, which is only clamped to ±1.
- **Fix:** for correlations, always use −1 to 1 with ticks at −1, −0.5, 0, 0.5, 1. For the adjusted model, use a fixed symmetric window per outcome scale, or at least a symmetric one around 0.
- Label the axis ends in plain words: "← goes with lower SFI" and "goes with higher SFI →". That's an axis label, not a takeaway.

### H2 · A composite and its own items fill the ranking — Design
- **Seen:** the SFI top 20 for the United States includes:
  - PHQ-2 depression score, plus its two items (Feeling down or depressed; Little interest or pleasure) and PHQ-2 screen positive;
  - GAD-2 anxiety score, plus its two items (Feeling nervous or anxious; Unable to stop worrying).
- That's 7 of 20 slots for two constructs, pushing out everything else.
- **Fix:** rank a composite or its items, not both. The simplest option: exclude a composite's items when the composite is ranked, and exclude the screen-positive flag when its score is ranked. Say so in the footnote ("PHQ-2 items are represented by the PHQ-2 score").

### H3 · Countries are out of order — Bug
The Country dropdown and the matrix columns run Argentina … United States, then Sweden, Hong Kong, China. Both map over `served.countries` in code order (`CorrelatesView.tsx` ~line 296 and ~line 468). Other pages sort A–Z. Sort both by name.

### H4 · The chosen country is lost in the matrix, and the rows depend on it silently — Design
- The matrix rows are *the chosen country's* top 20. Change the country to Japan and the rows change. The subtitle says only "The same measures in every country".
- The chosen country's column is 20th of 23 and off-screen at every width. It isn't highlighted.
- **Fix:**
  - Pin the chosen country as the first column after the labels, with a highlighted header.
  - Subtitle: "The 20 measures ranked for United States, in every country".

### H5 · Two chart types on one page — Design (your What Matters rule)
The page stacks a dot chart and a heat matrix. Apply the What Matters pattern:
- a view switcher: **In {country}** (default) · **Across countries**;
- only the chosen chart renders;
- the URL carries `view`.

This also shortens the page, so the first chart moves up toward the fold.

## Medium

### M1 · Jargon everywhere — Design
- Controls: "Model: Correlation | Adjusted difference", "Correlation: Pearson | Spearman".
- Adjusted subtitle: "points per 1 SD of each measure, holding age band, gender, education (three levels), employment status and marital status fixed".
- Tooltip: "point estimate — no interval is computed for this statistic".
- Lede: "What travels with a measure".
- **Fix:**
  - One "Method" disclosure (closed by default) holding both method controls, with plain labels: "Simple" / "Accounting for age, gender, education, work and marital status", and "Straight-line (Pearson)" / "By rank (Spearman)".
  - Tooltip: value, measure, n.
  - Lede: "Pick a question to see which other answers tend to go with it, in one country. Things that go together aren't necessarily cause and effect."

### M2 · Disabled options give no reason — Design
- For SFI, **Midyear** is greyed out. For a midyear item, **2023** and **2024** are greyed. In Adjusted mode, **Pearson / Spearman** are greyed.
- There is no `title` and no hint text anywhere.
- **Fix:** add a one-line hint under the control, e.g. "Midyear: this question wasn't asked in the midyear survey" or "Adjusted results use Pearson only". Or hide the method row when it doesn't apply.

### M3 · Long labels are clipped — Bug
"Importance: religious or spiritual life" renders as "mportance: religious or spiritual life". The label gutter is fixed at 230 px (`labelWidth`). Fit the gutter to the longest label up to a cap, then wrap to two lines. Put the full name in the tooltip.

### M4 · Phone: the dot chart collapses and the picker is hidden — Design
- **Seen at 390 px:** labels take 200 px and values 60 px, leaving ~110 px of plot. The ticks collide ("−1.0−0.5 0.0 0.5 1.0"), and every dot sits in a thin strip.
- On phones, the **search box and Topic** move inside "More options — model, correlation, topic". The label doesn't mention search, so reaching the other 143 measures is hidden.
- **Fix:**
  - On narrow screens, put each label on its own line above its dot row, so the plot gets the full width. Use three ticks (−1, 0, 1).
  - Keep the search box visible, and relabel the disclosure "Method".

### M5 · The dot chart doesn't widen when the window grows — Bug (likely site-wide)
- Resizing 768 → 1100 px left the SVG at 707 px in an 896 px column. Shrinking re-fits; growing doesn't, until a reload.
- `usePlot` observes the host, and the host grows. The rebuild at the new width isn't sticking.
- Affects tablet rotation and window resizing. Check the other Plot charts too.

### M6 · The matrix legend is a bold sentence under the fade — Design
- The legend is a bold, two-line sentence: "Secure Flourishing Index — rust: a negative association, teal: positive; the deeper the tint, the stronger it is (the deepest tint is 0.85 either way)".
- It sits inside the scroll box, so the right-edge fade covers "tint" and "the". In dark mode, "deeper" is backwards: stronger is lighter.
- **Fix:** a diverging swatch legend in the What Matters style, "−0.85 … 0 … +0.85", with rust and teal ends, in regular weight, outside the scroll box.

### M7 · Dark-mode matrix steps are hard to tell apart — Design
In dark mode, the teal steps between +0.35 and +0.70 are all near-black green, and the rust steps are muddy brown. Increase the lightness spread of the dark diverging ramp (`--div-*` in `tokens.css`) so adjacent steps differ visibly.

### M8 · Mixed signs zig-zag down the chart — Design
- Sorted by strength regardless of sign, the list alternates teal and rust dots from one side of the axis to the other. That's hard to scan, and the colors aren't explained until the matrix legend further down.
- **Option A:** keep the strength order and add a two-swatch key above the chart ("teal = goes with higher, rust = goes with lower").
- **Option B:** split the chart into two blocks, "Goes with higher SFI" and "Goes with lower SFI". Same chart, two sections, no takeaway text.

## Low

- **L1** The "Flourishing index & its domains" topic holds GAD-2 and PHQ-2 scores. It's really "derived scores". This is the shared picker's taxonomy (Atlas too); rename the topic or move GAD/PHQ to Mental health.
- **L2** A "—" matrix cell (China × Sense of belonging) is explained only by hidden text. Add "— too few respondents" to the legend.
- **L3** In Adjusted mode, Download CSV · PNG drops below the long subtitle while every other chart keeps it top-right. Shorten the subtitle (M1) and it returns.
- **L4** The adjusted chart's 95% CI whiskers are shorter than the dots are wide, so they read as dot outlines. That's fine, but "Lines are 95% confidence intervals" then describes something you can't see. Say "intervals are narrower than the dots".
- **L5** On first load, the first click in the search box can lose focus while the route finishes mounting. Seen once locally; not reproduced on the live site.

## What works

- The "associations, not causes" caveat appears in the lede and in both footnotes. There's a methods link and a model card.
- Search matches question wording. Picking a result updates Topic, and a midyear-only measure switches Wave to Midyear automatically.
- All state is in the URL. There are CSV/PNG downloads, a data table per chart, and no console errors.
- Sensible default: SFI, United States, 2023.
- Rust vs teal for sign is a good, colorblind-safe pairing, and values carry explicit +/− signs.

## Things you may not notice because you know the site

1. "Far right" means a different number for every measure and country.
2. The matrix rows are the chosen country's top 20, and that country's column is off-screen.
3. PHQ-2 and GAD-2 appear three to four times each in the top 20.
4. Sweden, Hong Kong and China sit at the bottom of the country list.
5. On a phone, search is hidden behind "More options — model, correlation, topic".
6. Greyed-out Midyear and Pearson/Spearman never say why.
