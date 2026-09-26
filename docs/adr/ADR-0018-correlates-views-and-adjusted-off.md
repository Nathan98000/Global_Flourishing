# ADR-0018: Correlates in four views; overlap left out of the ranking; two pair endpoints; the adjusted models off the page and off by default

**Status:** Accepted · **Date:** 2026-09-25 · **Phase:** 7

Related: ADR-0010 (rendering stack, fitted windows), ADR-0011 (every cell
shown), ADR-0014 (adjusted associations, model cards), ADR-0015 (signs
follow the label, the ranking floor), ADR-0016 (tooltips without n, the
picker's topics), `docs/reviews/correlates-2026-09-25.md`,
`docs/prompts/correlates-2026-09-25.md`.

## Context

The owner's review of the Correlates page on 25 September 2026 found it
hard to read for a first-time visitor: two charts stacked on one page;
an axis refitted to every measure, so a weak association and a strong
one both reached "far right"; a composite and its own questions filling
a third of the top 20 (the PHQ-2 score, both its items and its screen
flag); jargon ("Adjusted difference", "per 1 SD", "point estimate");
countries out of order and the chosen one off-screen in the matrix. The
owner decided to remove the adjusted model from the page, to approve the
rest of the review, and to add two views: two questions side by side,
and a correlation table the reader builds. The adjusted sweep is also
the API's most expensive request (20.8 s across countries, ADR-0014),
and nothing on the site would use it any more.

## Decision

1. **One view at a time.** A segmented View row under the shared
   controls picks what the page shows: **In {country}** (the ranked
   list, default) · **Across countries** · **Compare two** · **Compare
   several**, in the URL as `view = ranked | countries | pair | matrix`
   (the default omitted). Only the chosen view mounts, and only its
   queries run (`enabled`); a view whose default comes from the ranked
   list (Compare two's `x`, Compare several's `vars`) runs that list too,
   from the same cache.
2. **The adjusted models leave the page, and the server stops offering
   them by default.** The Model control, the adjusted subtitles, axis
   title, hint, footnote and model-card link go; `adjusted` leaves the
   URL schema, and an old link carrying it gets the usual invalid-param
   notice while nothing is sent. Server side, `adjusted_enabled` (env
   `FA_ADJUSTED_ENABLED`, default off) gates the flag: while it is off,
   `/v1/correlates?adjusted=true` is a 422 — "Adjusted associations are
   not offered on this server." — raised by a dependency that runs before
   any parsing, loading or estimating. `adjusted_association` and every
   adjusted branch in the API stay, tested through a fixture that
   switches the setting on (the adjusted golden included); `deploy.yml`
   does not set the variable. The model-card page (`/model-cards`,
   `ModelCardsView`) is retired — its copy described "the adjusted
   associations on the Correlates view" — and an old link lands on the
   not-found page; `docs/model-cards/*.md` stay, as ADR-0014 cites them.
   **This is reversible:** set the variable, and restore
   `apps/web/src/views/ModelCardsView.tsx` and its route in `router.tsx`
   from git history, to bring them back.
3. **A ranking holds a construct once.** After ranking, of two kept
   predictors that share answers (`shares_answers`, now in `queries.py`)
   only the one built from more answers stays — a score over its own
   questions — and on a tie the non-binary one — a score over its
   screen-positive flag. The walk goes down the ranking until `limit`
   predictors are kept, so the list backfills; only kept predictors
   compete, so a score below the cut never displaces its question.
   `meta.dropped_overlap` maps each name left out to the one standing in
   for it (empty when nothing overlapped, null on every other response),
   and the page builds its footnote from it ("PHQ-2 depression score and
   GAD-2 anxiety score are shown; their individual questions and
   screen-positive flags are left out.").
4. **Compare two: `GET /v1/correlations/pair`** (`y`, `x`, `wave`,
   `filter=country_code:N`, `method`). Both must be ordered items asked
   at the wave, in exactly one country; a pair built from the same
   answers is a 422 in plain words. The response carries the weighted
   correlation (the number `/v1/correlates` reports for the pair) and
   y's weighted mean in each group of x as an `EstimateResponse` — the
   `/v1/aggregate` estimator with `by = [x]`, same design, weight and SE
   (a yes/no y is its share answering yes, `stat = "proportion"`) — plus,
   per group, its label, its weighted share of the people who answered
   both, and `below_min_n` at the ranking floor (flagged, never dropped).
   x's groups are its **answers** when it has at most eleven (the
   catalog's short answer labels; numbers on 0–10 and count scales), else
   **equal-width bins between x's weighted 1st and 99th percentiles**
   (R `svyquantile`'s rule): ten for a derived score, whole-number-wide
   and at most ten for an item counted in whole numbers (so no bin is
   empty by construction), the end bins taking in the tails and their
   labels saying so ("26 or less", "9.0 and above"). Groups run in x's
   aligned order (ADR-0015), so a positive correlation slopes up. Only
   group means are served; respondent-level points never are — they
   would publish microdata, and 38 000 answers on a 0–10 × 0–10 grid only
   overplot. The page draws a **binned scatter**: one dot per group at
   y's mean with its CI whisker, area proportional to the share, a thin
   line through them, one hue (`--div-pos-mark`), thin groups hollow and
   named in the footnote; y on its full scale (`measureBounds`), never a
   fitted window. y's means stay as coded (ADR-0015: means are never
   re-coded), so for a descending y the axis is reversed — up is always
   more of what y names — and the label above it says what the top is in
   the item's own words ("↑ Nearly every day").
5. **Compare several: `GET /v1/correlations`** (`vars`, 2–10, `wave`,
   `filter=country_code:N`, `method`): every pair i < j, each row's
   correlations taken in one pass (`weighted_correlations`), each with
   its n and `below_min_n`; a pair built from the same answers is marked
   `shares_answers` and never estimated. A dedicated response model
   (`CorrelationsResponse`): a table of many questions has no single
   outcome for the estimate envelope's meta. The page draws the lower
   triangle of a `HeatTable` — rows "1 · {name}", columns numbered with
   the full names as their tooltip and accessible name — with a muted
   "·" for pairs sharing answers and a muted "—" below the floor; each
   cell is a button that opens Compare two, row on y and column on x.
   Its default is the measure and its top five correlates (after the
   dedupe), so it is never empty. Both endpoints answer in 20–60 ms on
   the release (a ten-question table: ~58 ms), against 0.2 s for the
   ranked sweep.
6. **Display rules this page revises.**
   - *A correlation's axis is fixed at −1 to 1* (ticks −1, −0.5, 0, 0.5,
     1; three on a phone), revising ADR-0010's fitted windows for this
     chart: "far right" must mean the same number for every measure. The
     axis ends are labelled in words ("← goes with lower …"); a key above
     the rows names the two hues.
   - *Tooltips on this page carry the n*, revising ADR-0016 §2 here only:
     a correlation has no interval, so how many people answered both is
     the one number that says how much it rests on ("{n} people answered
     both"), and a Compare two group's n is what its dot and its flag are
     about. The pair tooltip writes its interval "(95% CI lo–hi)" as the
     owner specified. The n stays in the data tables and CSVs too.
   - *The chart can hold controls:* the ranked list's rows and the
     table's cells are real buttons, keyboard reachable, with their
     tooltip on focus as on hover; the chart node is then a labelled
     group, not an image, so they stay in the accessibility tree.
   - *Countries run A–Z by name* everywhere on the page; Across countries
     pins the chosen country first, marked and outlined, and from 1200 px
     breaks out of the text column (up to 1216 px, headers upright) so all
     23 fit without scrolling. Its legend is a swatch key from
     `DIVERGING_RAMP` outside the scroll box; a cell below the floor reads
     a muted "—" there too (its number in the tooltip and the table).
   - *"{short}" is the display name:* the catalog serves no
     variable-level short label (only answers have one); the helper reads
     one if it ever does.
7. **The PHQ-2 and GAD-2 scores and screen flags are listed under Mental
   health** in the picker, a web-side mapping (`topics.ts topicFamily`);
   their catalog family (`derived`) is unchanged. This is an exception to
   ADR-0016's rule that which measures sit under a topic is the
   server's.
8. **The dark diverging ramp is widened** (about 9 L\* a step, 16 on the
   end step, the end steps on the dark ink), so neighbouring tints clear
   1.3:1 where they sat near 1.16:1; `tokens.test` pins it.
9. **No change for "doesn't widen on resize".** Every Plot chart re-fits
   in both directions in a rendering page (headless Chromium: viewport
   and window-bounds resizes, dev and live builds, three views). The
   review's case reproduces only in a hidden document, where the browser
   holds ResizeObserver notifications until it renders again, and Plot's
   `max-width: 100%` hides a missed shrink but not a missed growth. A
   test pins the grow path; `usePlot` says why a hidden tab lags.

## Alternatives considered

- **Keep the adjusted model behind the Method disclosure.** The owner
  removed it: its caveats need a statistician, and a toggle that changes
  what every number means is the page's hardest control.
- **Delete the adjusted code.** It is tested, cited by ADR-0014 and the
  model cards, and cheap to keep behind a setting; deleting it would make
  the decision one-way.
- **Leave a composite's questions out whenever the composite is a
  candidate.** A score ranked below the cut would then remove its own
  question from the list without appearing itself, losing the construct.
- **Plot respondents in Compare two.** Microdata, and an unreadable
  cloud; group means with intervals say the same thing honestly.
- **Equal-count (quantile) bins for a long x.** Unequal widths make the
  x axis read as a rank, not the item's own units; the owner asked for
  equal widths between the 1st and 99th percentiles.
- **Compute pairs on the client from the ranked lists.** The front end
  computes no statistics, and a table needs pairs no list carries.
- **Re-code a descending y so its means run upward.** It would print
  means that disagree with the Atlas and the codebook; reversing the
  axis keeps the numbers and still slopes a positive correlation up.

## Consequences

- The API gains two routes, `ResponseMeta.dropped_overlap`, the
  `adjusted_enabled` setting and two response models; the goldens and
  the generated client were regenerated. The static tier is unchanged
  and needs no re-bake.
- Production keeps the adjusted models off until someone sets
  `FA_ADJUSTED_ENABLED`; a request for them there is a cheap 422.
- The ranked list can show a construct's question when its score falls
  below the cut; that is the rule working, not an overlap.
- The Correlates page's tooltips are the one place a tooltip prints an
  n; any other view still follows ADR-0016.
- PNG export of the two matrices still says it is unavailable (they are
  HTML tables, as What Matters' is); the data table and CSV carry them.
- Revisit the fixed axis if the page ever shows statistics other than
  correlations, the short name if the catalog gains a variable-level
  short label, and the web-side topic mapping if the catalog grows a
  mental-health family for derived scores.
