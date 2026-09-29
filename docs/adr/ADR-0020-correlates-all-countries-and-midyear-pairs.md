# ADR-0020: Correlates: all countries and midyear pairs

**Status:** Accepted · **Date:** 2026-09-29, revised the same day after the review · **Phase:** 7

Supersedes, in ADR-0019: §5's legend, tooltip sentence and screen-reader
words for a flagged estimate, §7's column explanation under Compare two,
and §9's footnote under Find related (the dedupe sentence). The rest of
ADR-0019 stands. Answers ADR-0015's open item "revisit the ranking floor
if the sweep ever runs on pooled countries" (decision 3). Its first
version pooled the countries by adult population; the review replaced
that with the average of the countries (see "History" at the end).

Related: ADR-0007 (the API's data tier and its memory budget), ADR-0011
(every cell shown), ADR-0015 (signs follow the label; the ranking floor),
ADR-0016 (no n in any tooltip), ADR-0019 (Correlates by task),
`docs/prompts/correlates-polish-2026-09-29.md` (the owner's ten requests
and decisions of 29 September), `docs/reviews/correlates-2026-09-29.md`
(the browser review of this branch) and
`docs/prompts/correlates-review-2026-09-29.md` (the owner's decisions on
it).

## Context

The owner used the live Correlates page (v0.9.0) and asked for ten
changes. Two are features the page lacked. Every GFS weight has mean 1
within its country, so countries could only be read one at a time; the
population-rescaled "all countries" figure promised in PROPOSAL §3.3 had
been deferred (ADR-0013). And the midyear survey's 15 questions could not
be reached at all: the Midyear chip was disabled whenever a question in
view came from another wave, and at 2023 or 2024 the picker refused them.
The other eight fix labels, copy and type: Compare two's caption and
titles ran into its bars in a narrow gutter, the question sentences mixed
a serif with a sans in boxes, tooltips repeated a sentence the asterisk
already carried, and "In every country" read too close to the coming
"All countries".

Before release, a browser review of this branch found that one estimate
over every country's people can contradict almost every country:
religious service attendance and life evaluation go together in 20 of
the 23 countries, but one estimate over everyone, each country weighted
to its adult population, read 0.00. It mixes the relationship *inside*
countries with the differences *between* them (the countries where more
people attend services report lower life evaluations). The owner chose
the plain average of the countries, which reads +0.10.

## Decision

1. **All countries, the plain average of the countries.** The Country
   select opens with "All countries" (`country=all`), then the 23
   countries A–Z; the default stays the United States. Every GFS weight
   has mean 1 within its country, so no estimate is taken over every
   country's people at once: for each pair of questions, All countries is
   the plain mean of the countries' own correlations over the countries
   that asked both — every country counts the same, and one that wasn't
   asked drops out (`flourish_stats.averaging.average_countries`). The
   mean is of the unrounded estimates on their own scale (no Fisher z),
   so it equals what a reader gets by averaging the country chart's dots;
   by rank and at the midyear survey (each pairing, decision 4) the same.
   Compare two's grid averages the same way: each cell is the plain mean,
   over countries, of that country's share of the column's people who gave
   the row's answer; a country drops out of a column's average when nobody
   there gave that column's answer, so every column still adds to 100%;
   the bars are the plain mean of the countries' shares. The countries are
   independent samples, so an average of K estimates has standard error
   √(Σ SE²) ⁄ K and the normal interval every estimator here takes.

   The API takes `pooled=average` in place of a country filter on
   `/v1/correlates`, `/v1/correlations/pair` and `/v1/correlations` (a
   422 with a country filter, with `by=country_code`, with
   `adjusted=true` or for another value; without it, the one-country
   rule and its 422 stand). A response says `meta.pooled = "average"` and
   lists `meta.countries` (every country in at least one of its
   averages); every averaged row carries `n_countries`, and its `n` is
   the complete cases summed over its countries. An average of
   correlations wears the asterisk (`flagged`) only when every country in
   it does; a grid cell or bar is flagged on the existing thresholds
   (fewer than 30 people gave both answers, or fewer than 100 are in the
   column) applied to the countries' summed n. The page subtitles an
   average "All countries (average of 23) · Wave 1, 2023", or "Average of
   21 countries (not asked in China or Egypt) · …" when fewer asked (the
   missing countries named when three or fewer, the count alone
   otherwise); a row or cell covering fewer than all adds "Asked in 12 of
   23 countries." to its tooltip, and nothing else marks it; data tables
   and CSVs gain a Countries column.

2. **Every country's correlations are precomputed when the image is
   built.** On demand, Find related's All countries sweep — about 100
   questions in each of 23 countries — takes 1.2 s straight-line and 1.7 s
   by rank on one local thread, and its country-by-country table 0.25 s; a
   single country's sweep already takes about 2 s on Cloud Run's 1 CPU /
   512 MiB instance. `flourish_api.country_correlations` therefore
   computes each country's correlation of every pair the views can ask
   for — each wave's servable ordered questions, at the midyear survey
   each pairing (decision 4), both methods — by **the same frames and the
   same estimator** as the on-demand path, when the image is built from
   the staged data (`infra/Dockerfile` runs it after the data is copied
   in; locally, `make country-correlations`). The file is a Parquet
   beside the DuckDB (699,554 rows, one per pair and country with people
   behind it; 10.6 MB; 106 s and 0.85 GB on a ten-core laptop), read at
   start in about 50 ms and held in memory in about 25 MB. It serves the
   averages, Find related's country-by-country table and Compare two's
   country-by-country chart, each in 2–16 ms. A file made from another
   data build is ignored, and anything it does not hold — a demographic
   domain, a breakdown, a pair built from the same answers, Compare two's
   grid (two questions, one small frame: 250–470 ms) — runs on demand. The
   serving policy is applied at serve time exactly as the estimator's
   `finalize` applies it. Tests hold the file's per-country values to the
   on-demand estimator's within 1e-12 (on the synthetic data for every
   request shape, and on a slice of the release), each average to the mean
   of its countries' values, and a question not asked in a country out of
   that country's rows.

   The proportion estimator now builds one level's indicator at a time
   instead of crossing every row with every level: the same arithmetic,
   and an eleven-answer question over every country's 208,000 people no
   longer holds some 600 MB at once (a one-country pair's peak fell too,
   353 → 229 MB).

3. **The ranking floor reads the countries' total** (ADR-0015's open
   item). The floor stays 100 complete cases (`FA_CORRELATES_MIN_N`),
   applied for All countries to the complete cases summed over the
   countries in the average; the flags and the dedupe are as before. A
   question asked in only a few countries still ranks on their people —
   its tooltip says how many asked it ("Asked in 12 of 23 countries.") —
   and no cutoff hides it: asterisks, never small-group cutoffs (ADR-0011,
   the owner's standing rule).

4. **The midyear survey, paired with 2023 or 2024.** Midyear is never
   disabled, and the wave follows the question. At `wave=MY` a midyear
   question reads its midyear answers and any other question the same
   respondent's answers from `other_wave` (`Y1`, the default, or `Y2`),
   joined on the person. Which people and which weight is a weight fact
   (`flourish_stats.weights.pairing_spec`): 2023 answers pair on `y1_my`
   — every midyear respondent (131,487), `w_l1m` — usually given 8–12
   months before; 2024 answers on `y1_my_y2` — those who also did Wave 2
   (116,038), `w_l1m2` — from the same interview for two in three (every
   such respondent in China, Hong Kong, Israel, Japan, Sweden and the
   United States), about six months apart for the rest. Never `my_y2`:
   its `midyear_type = 1` restriction exists because same-day answers are
   not *change*; for a correlation they are fine. Both weights calibrate
   to the Wave 1 population. Compare two and Compare several need a
   midyear question (a 422 that says to use the other wave directly); a
   question asked neither in the midyear survey nor at `other_wave` is a
   422; so is `other_wave` at another wave. Find related ranks, for a
   midyear question, every midyear question and every question asked at
   `other_wave`; for any other question, the midyear questions only.
   Responses say `meta.other_wave` and, per question, `meta.answer_waves`.
   A table's cells between two questions from another wave are taken on
   the same people, so they differ from that pair at its own wave. All
   countries works here too, and the precomputed file covers both
   pairings.

   On the page (`views/correlates/midyear.ts`, pure and tested): a
   midyear question picked at 2023 or 2024 switches to Midyear, that wave
   the other answers'; at Midyear with no midyear question left, the wave
   becomes the other answers'; with 2024, a question asked only in 2023
   switches the other answers to 2023; 2023 or 2024 chosen with midyear
   questions in view replaces them with the defaults; Midyear chosen with
   none in view brings in *Daily social media time* (`TIME_MEDIA`):
   Compare two's A (B stays if asked in the other answers' wave, else
   *Life evaluation today*), Find related's question, or the first of
   Compare several's table (its last dropped at ten). A link lands the
   same way. "Other questions' answers from: 2023 · 2024" sits under the
   Wave chips when another wave's question is in view at Midyear (always
   in Find related; `other=Y2`, 2023 omitted from the URL; 2024 disabled
   when a question in view wasn't asked then), and the row note says whose
   answers and when. One polite line under the row announces any automatic
   change ("Daily social media time was asked only in the midyear survey,
   so Life evaluation today took its place."). The picker tags midyear
   questions "Midyear" and, at Midyear, the others "2023 answers" or "2024
   answers"; a trigger holding one of them shows "2023" or "2024";
   subtitles read "… · Midyear survey, with 2024 answers from the same
   people"; axis titles, table headers and list rows of the other
   questions add "(2023)" or "(2024)". A question asked in the midyear
   survey *and* at the current wave (none in this release; one in the
   synthetic data) stays where it is: only a question the current wave
   did not ask pulls the page to Midyear.

5. **Copy, labels and type.** Tooltips lose "Few people gave these
   answers, so this estimate is less reliable." and keep the value's
   asterisk; still no n in any tooltip (ADR-0016). The asterisk's key
   reads "* small sample size" everywhere on the page, and screen readers
   hear ", small sample size"; Compare two's summary ends "… N cells are
   starred: small sample size." Every Correlates chart ends, after its
   data table, with one note — "Weighted so each country's sample stands
   for its adult population." — in place of the interval clause, where
   the n lives, any footnote and the Methods link (`ChartFigure`'s `note`;
   other pages keep their footnotes). "What's the difference?" is four
   short paragraphs, the method names in bold, in a 26rem panel (the
   column's width on a phone). The question sentences are one typeface —
   the page sans at the deck size — the pickers inheriting it at 600 on
   its baseline with a 0.7em chevron, the "?" kept beside the last picker,
   Swap a small button after the sentence. The scope toggle's second
   option is "Country by country"; its first reads "In {country}" or "All
   countries". "higher" and "lower" are set apart (italic, 600, ink)
   wherever the page says them — styled tspans in the SVG axis ends, so
   the PNG carries them, `<em>` in the HTML keys. Compare two's bars'
   caption and rows' title run on their own lines from the chart's left
   edge; the gutter holds only row labels; no text block is capped at a
   line count; cell and bar labels are sized to fit their columns.

Standing rules, unchanged: no generated takeaways; one chart on screen at
a time; no cause-and-effect reminder; no small-group cutoffs; no adjusted
model on the page; the QuestionPicker on Correlates only.

## Alternatives considered

- **Precompute at API start, in the background** (one of the owner's two
  options). Cloud Run allocates CPU only while it serves a request, so a
  background job on an idle instance barely advances, and every cold
  start would redo minutes of work in a 512 MiB instance also serving
  requests; done before the instance is ready, it would lengthen every
  cold start by minutes. Rejected.
- **Precompute in the data build** (the other option). A pipeline stage
  would need the API's frames (alignment, indicators, the midyear
  pairings) moved into the pipeline, a data rebuild before the next
  deploy, and a rebuild whenever the estimator changed. Building the file
  with the image keeps it tied to the code and the staged data that serve
  it, and needs no rebuild.
- **Faster on-demand estimation** (a numpy estimator over cached compact
  frames). A second implementation of the estimator to keep equal to the
  first; the precompute reuses the one there is.
- **One estimate over every country's people** (this ADR's first
  version, see "History"). It can contradict almost every country, and
  weighting by adult population gave China and India 58% of every figure.
- **Pooling inside countries** (people compared only with others in their
  own country, then combined): a within-country figure that needs
  "adjusted" language and still lands off the dots.
- **The countries averaged by adult population** (the review's
  recommendation). Always among the dots, but China and India would still
  carry most of every figure; the owner chose every country counting the
  same.
- **The median country.** Robust, but not the mean of the dots, and the
  grid's columns would no longer add to 100%.
- **Averaging on Fisher's z.** The number would no longer be the mean of
  the dots a reader sees.
- **`my_y2` for the 2024 pairing.** Its type-1 restriction is about
  change; it would drop the two in three whose midyear and Wave 2 answers
  share an interview, for no reason a correlation has.
- **A separate Midyear view.** The midyear questions belong beside the
  others; the wave row and the pickers reach them where they are.

## Consequences

- The API gains `pooled` and `other_wave` on the three correlation
  endpoints, `n_countries` on every row and four optional meta fields;
  the OpenAPI schema and client are regenerated, and the goldens gain the
  new null fields. The static tier is unchanged; no data rebuild is
  needed and `data_version` is unchanged (the ETag keys on the commit,
  ADR-0019).
- The image build runs the precompute: a few minutes more per deploy on
  the runner, which has the memory (about 0.85 GB). CI's image, built
  with no data staged, writes nothing and boots as before. Locally, `make
  country-correlations` after `make data`; without the file, every
  request runs on demand. The file's new name means a pooled file from
  the first version is never read.
- No data file joins the repository.
- The synthetic database gains *Daily social media time*, so tests and
  the journeys land where users do.
- Revisit the ranking floor if one-country questions crowd the All
  countries lists (decision 3).

## History

The first version of this ADR (29 September, never released) pooled
every country's people into one estimate, each country's weights
rescaled to its adult population: `pooled=population` on the API,
`flourish_stats.weights.pooled_population_weights`, the UN's World
Population Prospects 2024 adults (ages 18+, 1 July 2023) in
`stats/src/flourish_stats/data/adult_population.csv`, rebuilt by
`scripts/adult_population.py`, and `meta.population_source` on every
pooled response, with a precomputed file of pooled correlations
(`flourish_api.pooled`, `make pooled`). The review showed it could
contradict almost every country; the owner replaced it with the plain
average of the countries (decisions 1–3), and the population table, its
script and every population code path were removed.
