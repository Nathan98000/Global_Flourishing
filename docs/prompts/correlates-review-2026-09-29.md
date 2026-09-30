# Correlates review fixes — 29 September

These fixes come from `docs/reviews/correlates-2026-09-29.md` (a browser review of `claude/correlates-polish`) and the owner's decisions below. Everything in the review is approved as written, except where a decision below changes it.

## Owner decisions (override earlier docs, including ADR-0020)

1. **All countries = the plain average of the country correlations.**
   - Every country counts the same: no population weights and no pooling of people.
   - This replaces ADR-0020's population pooling.
2. **Leave out countries that weren't asked a question.** They drop out of every average, and out of the dot chart's rows. The question itself stays in lists and tables.
3. **"columns add to 100%"** appears in the grid's key.
4. **No link or words explaining what a correlation is** next to the number. No ⓘ, no "weak / moderate / strong".
5. **Standing rules:**
   - no generated takeaways;
   - one chart on screen at a time;
   - no n in any tooltip;
   - no cause-and-effect reminder;
   - asterisks, never small-group cutoffs;
   - no adjusted model;
   - the QuestionPicker stays on Correlates only;
   - the only note under a chart is "Weighted so each country's sample stands for its adult population."

## How to work

- Read `CLAUDE.md` once. Don't re-read files after editing them. Refactor only what these tasks need.
- **Stay on `claude/correlates-polish`** and add commits; the open PR grows to cover this. One conventional commit per task. The first commit adds this prompt and the review.
- **ADR-0020 hasn't shipped, so revise it in place** for decision 1 and the precompute change. Update `docs/METHODS.md` to match.
- Update the PR description. Don't merge, tag or deploy. End with one line per task.

## Tasks

### 1 · All countries as the average of the countries

**The number:**
- For each pair: the plain mean of the country correlations, over the countries that asked both questions.
- Average the unrounded estimates. Don't use a Fisher z transform: the number must equal what a reader gets by averaging the dots.
- It works the same way for By rank, and at Midyear with each pairing.
- **Asterisk:** the average wears one only when every country in it does.
- **Find related's ranking floor** applies to the total complete cases across the countries in the average.

**The Compare two grid:**
- **Each cell** is the plain mean, over countries, of that country's share, i.e. the share of the column's people who gave the row's answer.
- **Leaving countries out:** a country drops out of a column's average when nobody there gave that column's answer. Every column still adds to 100%.
- **The bars** above the grid are the plain mean of the countries' shares.
- **Likely ranges:** the countries are independent samples, so SE = √(Σ SEc²) ÷ K for K countries.
- **Flags:** use the existing thresholds on the countries' summed n.

**Remove population pooling completely.** Nothing on the site uses it any more. Remove it in one `refactor:` commit:
- **The data and its script:** `stats/src/flourish_stats/data/adult_population.csv`, `scripts/adult_population.py`, and their entries in `.gitignore`, `.pre-commit-config.yaml` and `stats/pyproject.toml`.
- **Stats:** `pooled_population_weights` and `adult_population_table`, with their exports and tests. Don't restore the old stub.
- **API:**
  - `population_path` (config);
  - the population loading in `data.py`;
  - the population-weighted frames in `frames.py`;
  - `population_source` and `pooled=population`, replaced by `pooled=average`. The response says the countries were averaged and lists them; rows keep `n_countries`.
- **Tests and fixtures:** the synthetic countries' populations (`synthetic_db.py`, `scripts/web_fixtures.py`) and the "combined by adult population" strings in tests and journeys.
- **Docs:**
  - the population lines in `CLAUDE.md`;
  - `docs/METHODS.md`;
  - ADR-0020, revised in place;
  - a one-line note in PROPOSAL §3.3 that ADR-0020 replaced the population-rescaled option.
- **Keep** the proportion estimator's one-level-at-a-time change in `_core.py`. It's a memory fix that helps every page.
- **Check:** `git grep -i -E "adult_pop|population_source|pooled_population|pooled=population"` returns nothing outside the ADR's history note.
- **The local build file:** replace `data/pooled_correlations.parquet` with the new per-country file (below), under a new name so a stale file can't be read.

**Precompute:**
- Replace the pooled Parquet with per-country correlations for every pair the views can ask for. That means each wave and each midyear pairing, both methods, and the same frames and estimator, built at image build (`make pooled` locally; rename it if that's clearer).
- The file serves:
  - the average;
  - Find related's country-by-country table;
  - Compare two's country-by-country chart.
- **Tests:**
  - per-country values equal the on-demand estimator within 1e-12;
  - the average equals the mean of those values;
  - a question not asked in a country leaves that country out.
- Report the file size and build time in the PR.

**Labels:**
- **Subtitle:** "All countries (average of 23) · Wave 1, 2023". When fewer countries asked: "Average of 21 countries (not asked in China or Egypt) · …". Name the countries when there are three or fewer; otherwise give the count only.
- **Tooltips:** keep "Asked in 12 of 23 countries." on pooled rows and cells that cover fewer. Don't add any other marking.

### 2 · Label the correlation, and mark All countries on the country chart (review H4, L1)

- **The strip above each Compare two chart** names its scope: "United States: +0.54", "All countries: +0.10".
- **Country by country** (Compare two):
  - Draw a labelled vertical rule at the All countries average, with "All countries +0.10" at its top, in `INK`. It appears whatever country is chosen, and the chosen country's row stays picked out.
  - Countries that weren't asked have no row.
- **Zero:** a value that rounds to 0.00 gets neutral ink, in dots, values and the strip, never rust or teal.

### 3 · The grid (review H3, M1, M9 cells)

- **Bins reach the top:** 0, 5, 10, 20, 30, 45, 60, 75, 90%+.
  - Extend `SEQUENTIAL_RAMP` to nine tokens in both themes, with each step's ink contrast checked.
  - Update `SHARE_BINS`, `shareTint` and the key.
  - **Test:** 84% and 93% land in different steps.
- **The key's label** reads "Share of each column (columns add to 100%)". This is owner decision 3.
- **Narrow cells:** drop the "%" when a column is under 44 px. The key says "%". The asterisk stays.

### 4 · Tooltips in plain words (review M2)

On the Correlates page only:

- **Grid cell:** three lines, e.g.
  - "Life evaluation today: 0"
  - "65% — Finding it very difficult on present income"
  - "Likely range: 44%–86%"
- **Bar:** "Life evaluation today: 8", then "25% of people", then "Likely range: 25%–26%".
- **Wording rules:**
  - "95% CI [a, b]" becomes "Likely range: a–b".
  - No asterisk inside a sentence.
  - Still no n.
- Ranked rows and matrix cells keep "+0.41 · Gratitude".

### 5 · Midyear controls and notes (review M3, M4, M7 labels)

**Controls:**
- Remove the separate "Other questions' answers from" row.
- Put the choice in the standing note as an inline select, labelled for screen readers: "The other question uses the same people's [2023 ▾] answers, …".
  - Compare several and Find related use the plural ("The other questions use").

**Timing, worded for the country on screen:**
- **2024 pairing:**
  - "from the same interview" where every midyear respondent had type 2;
  - "about six months later" where all had type 1;
  - otherwise "from the same interview for some people, about six months later for others";
  - for All countries: "…for two in three people…".
- **2023 pairing:** "about 12 months earlier" (all type 2), "about 8 months earlier" (all type 1), else "usually 8–12 months earlier".
- **Serve each country's midyear-type split.** Don't hard-code country lists.

**The swap notice** says only what changed, e.g. "Daily social media time is a midyear question, so the page switched to Midyear." It never repeats the standing note.

**Year labels:**
- Compare two keeps "(2023)" or "(2024)" on the other question's title.
- Compare several's chips and labels and Find related's rows drop the per-label year suffix. Instead, **midyear** questions get a small muted "Midyear" tag. The subtitle already names the year.

### 6 · One place for the scope toggle (review M5)

- Compare two's "In {country} · Country by country" moves out of the figure, to where Find related has it: directly under the shared control row.
- The figure header keeps only the labelled strip.

### 7 · The data table (review M6)

- **Compare two's table gains:**
  - the column shares (the bars);
  - the correlation;
  - a "Small sample" column.
- **Captions:**
  - one country: "Weighted to each country's adult population."
  - All countries: "Each country weighted to its adult population; countries averaged equally."
  - No weight codes such as `w_c1`.
- **Headings:** "Estimate" becomes "Share of column", and "Measure" becomes "Question".
- **Test:** the screen-reader summary's "The data table below carries every number" is true.

### 8 · Compare several's table, and one colour scale (review M7, M8)

- **Layout:**
  - Drop the shaded empty corner and "Question ↓ · with →".
  - Column headings go horizontal, wrapped to at most three lines.
  - When the table has more than six questions, or on phones, number the columns 1–10 and prefix the row labels with the same numbers.
- **Colour:**
  - Deepen the diverging ramp's upper steps, keeping −1 to 1 fixed, so +0.3 and +0.7 read clearly apart in both themes.
  - Find related's country-by-country table uses the same fixed −1 to 1 scale and ramp (no fitted ±max).

### 9 · Phone (review M9)

- **Under 40 rem:** Wave, Country and Correlation type collapse into one summary line ("2023 · United States · Straight-line"), with a "Change" button that opens them in place.
- **Grid row labels** (stacked layout): more space above each label than below it, so it reads with its own row.

### 10 · Copy and small fixes (review H2, L2–L6)

- **H2:** the *Daily social media time* wording becomes "…using social media platforms (the survey named popular ones in each country)?".
  - Fix it at the source (`overrides/variables.yaml`) and regenerate the catalog and static tier with the smallest make target. If that needs the full data build, say so in the PR.
  - Add a test that no displayed wording contains "[".
- **L2:** use "higher answers to X", never "a higher X", in:
  - Find related's axis ends ("← goes with lower answers to X");
  - Compare two's country-by-country axis ends ("← higher answers to A go with lower answers to B").
  - Keep the italic, bold "higher"/"lower".
- **L3:** Swap stays on the line of the last picker and the "?" (no-wrap group).
- **L4:** in the Correlates picker only, the midyear topic reads "Midyear survey". `topics.ts`'s label stays for other pages.
- **L5:** "Straight-line" is not bold in the info box's last sentence.
- **L6:** remove the dot key above Find related's list. The axis ends carry the direction.

## Verification

- **Per task:** run only the affected pytest and vitest files.
- **Playwright:** update journey 10 to cover:
  - All countries in each view;
  - the country-chart rule;
  - Midyear with each pairing, through the inline select;
  - the phone summary line.
- **End, once:** `make lint typecheck`, the full pytest and vitest suites, and the Playwright journeys.
- **Screenshots:** at 1470, 768 and 390 px, in light and dark. Don't commit them. Cover:
  - Compare two at `?a=ATTEND_SVCS&b=WB_TODAY&country=all`, both scopes;
  - `?a=ATTEND_SVCS&b=CLOSE_TO`;
  - Compare several at Midyear;
  - Find related, All countries;
  - the Midyear note in the US and in India.
- **Confirm:**
  - no overlapping or clipped text;
  - no horizontal page scroll at 390 px;
  - All countries for attendance × life evaluation reads about +0.10.
- Then push.
