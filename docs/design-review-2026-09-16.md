# Design review — Flourish Atlas, 16 September 2026

Reviewed the running app (`make web` on real data, 2,158 precomputed files; `make api` was **not** running, so the app was in its offline mode throughout — noted per finding where that matters). Procedure: `docs/prompts/design-review.md`.

> **Status (17 September 2026): all findings addressed** — F1+F16 in the
> `claude/design-charts` PR, everything else (with the owner's
> post-wireframe decisions) in `claude/design-shell`. Deltas from the
> text below: **F3** turned out to be the second branch (derived scores
> ship no missingness rows, so the banner could never render for sfi,
> API up or down — coverage now falls back to per-country n from the
> wave's own estimates vs Wave 1, both static files); **F5**'s
> "notice names only stat" was a router URL-rewrite eating the list,
> fixed at the root (middleware ordering + rejected raws stay in the
> URL until dismissed); **F12** superseded by decision 4 (badge
> removed); **F14** was already half-done (prose capped at 46rem the
> CSS-only ultra-wide pass missed) and is now ~70ch.

Instrument note: the review ran in the Claude desktop browser pane, which renders but cannot write screenshots to disk. Every finding below therefore carries a **reproduction** — URL, viewport, theme — instead of an image file. Widths of 390 px and ~800 px rendered 1:1 and are trustworthy; emulated widths above the pane's own size were scaled and were not used for judgments. Ultra-wide (1680) layout was assessed from the CSS (`.layout { max-width: 68rem }`) rather than by eye.

## Start here: the three changes with the best return

1. **Fit the scales to the data (F1).** Every chart in the app currently shows *rank* clearly and *difference* barely, because each scale spans the item's full range while the data occupies a sliver of it. This is one coherent change across four chart components and it transforms the product's core promise.
2. **Give the phone a layout (F2).** There are no width media queries anywhere. At 390 px a visitor scrolls past two screens of chrome to reach a chart whose labels are ~6 px tall.
3. **Say what the site is, in one sentence, and drop the engineer vocabulary (F5 + F6).** The landing view never states what this is; the copy that *is* there says "precomputed views", "custom queries", "w_c1".

None of the three touches the statistics, the envelope, or a documented decision.

---

## Findings

| # | Severity | Finding | Where | Status |
|---|---|---|---|---|
| F1 | Major | Scales anchored to the item's full range, not the data's — ordering reads, magnitude doesn't | all four chart types | ✅ |
| F2 | Major | No responsive breakpoints; phone layout buries and shrinks the data | every view at 390 px | ✅ |
| F3 | Major | Wave 2 shows no retention/coverage context | Atlas, `wave=Y2` | ✅ |
| F4 | Major | Empty state blames the API when the real problem is "no outcome chosen"; invalid-param notice is incomplete | Atlas with bad params | ✅ |
| F5 | Major | The landing page never says what the site is | Atlas, first paint | ✅ |
| F6 | Minor | Engineer-facing copy on public surfaces | global | ✅ |
| F7 | Minor | Methods page opens with repo-internal framing | `/methods` | ✅ |
| F8 | Minor | Sort control above the chart on Breakdowns, below it on Atlas | both | ✅ |
| F9 | Minor | Country picker: no Escape-to-close, ambiguous "Show all", 26 px rows, state not reflected | Atlas | ✅ |
| F10 | Minor | Distribution silently defaults to Argentina; hatched "withheld" bins have no legend | Atlas, `stat=distribution` | ✅ |
| F11 | Minor | "chart this →" wraps to two lines in every row | `/codebook` | ✅ |
| F12 | Minor | Tier badge sits among the controls, reading as one of them | `/codebook`, variable detail | ✅ (removed — decision 4) |
| F13 | Minor | Global offline banner shows on Methods and 404, where it is irrelevant | `/methods`, unknown routes | ✅ |
| F14 | Minor | Prose measure runs the full 68 rem container (~140 characters) | `/methods` | ✅ (was 46rem, now ~70ch) |
| F15 | Polish | Theme button label ambiguous: state or action? | global | ✅ (names the action) |
| F16 | Polish | Axis appears only after 23 rows; only the top bar carries a value | Atlas ranked bars | ✅ |
| F17 | Polish | Nav wraps to a second line from ~800 px down | global | ✅ |

---

### F1 — Scales are anchored to the item's range, so the charts show rank but not difference · **Major**

**Reproduction.** `/?outcome=sfi&wave=Y1` (any viewport, either theme) · `/?outcome=LONELY&view=map` · `/breakdowns?outcome=sfi&wave=Y1&by=age_band` · `/?outcome=sfi&wave=Y1&stat=distribution`.

**What I saw.** Atlas: 23 bars whose values run 5.89–8.10 drawn on a 0–10 axis — they read as one solid block; only the leading value (8.10) is labelled, and the axis sits below all 23 rows. Map: all 23 countries render as effectively one mid-blue step of a 0–10 ramp. Breakdowns: in every one of the 23 panels, the eight age-band dots occupy roughly 15 px of a ~370 px panel — about 85% of each panel is empty grid, repeated 23 times down a long page. Distribution: the y-axis runs to 10% while the tallest bin is ~2.5%.

**Why it matters.** Product goal 1 is that a curious non-expert can answer "how does X vary by Y in Z" in under a minute. Right now the app answers "in what order" and leaves "by how much" to the data table. The Breakdowns view — the one that should show the age curve the study is famous for — is the worst case.

**Fix.** Position and colour encodings do not need a zero baseline; bars do. So change the mark rather than truncating an axis:

- `src/charts/RankedBar.tsx` — for `scale_0_10` means, default to the existing `DotPlot` mark with its CI, on a domain padded around the observed min/max; keep the full scale in the axis caption ("0–10 scale · showing 5.5–8.5"). Keep bars (zero-based) for proportions, which already work well.
- `src/charts/SmallMultiples.tsx` — one shared, data-fitted domain across panels, so panels stay comparable while the variation becomes visible.
- `src/charts/Choropleth.tsx` — anchor the sequential ramp to the observed range; label both legend ends with values and add a "no data" swatch.
- `src/charts/Histogram.tsx` — fit the y-domain to the tallest bin across the countries being compared.

**Risk.** Touches PNG/CSV snapshot expectations and possibly one Playwright assertion; no effect on the contrast tests or the bundle. The categorical Atlas view (`/?outcome=ATTEND_SVCS&wave=Y1`) is the proof this works — shares run 0–60%, the CI whiskers are visible, and the chart is immediately readable.

### F2 — No responsive breakpoints; the phone gets the desktop layout, shrunk · **Major**

**Reproduction.** Any view at 390×844, either theme. Confirmed in CSS: the only media queries in `apps/web/src` are `prefers-reduced-motion` and `prefers-color-scheme`.

**What I saw.** The header's `flex-wrap: wrap` puts the brand on one line and then each nav item on its own line — four lines, ~300 px, before any content. Five control groups then stack, each label-over-control, so the chart card starts around 700 px down an 844 px screen. The chart itself keeps its aspect ratio instead of its row height: 23 rows compressed into ~330 px, with country labels around 6 px and bars about 5 px tall.

**Why it matters.** §4.4: "fast on a phone on a bad connection". It is fast. It is not usable.

**Fix.** `src/components/AppShell.module.css` — give `.nav` its own full-width row below the brand (`flex-basis: 100%`), reduce the gap, and add tap padding to the links. Add a `@media (max-width: 40rem)` block for the control row (two-up grid, labels inline) in `AtlasView.module.css` / `BreakdownsView.module.css`. In `src/charts/usePlot.tsx`, derive chart height from row count with a minimum per-row height (≈18 px) so a 23-row chart scrolls on a phone rather than shrinking.

### F3 — Wave 2 carries no retention or coverage context · **Major**

**Reproduction.** `/?outcome=sfi&wave=Y2`, any viewport.

**What I saw.** No coverage banner above, beside or below the chart. The footnote names the weight (`w_c2`), the SE method, the CI and the suppression rule — nothing about who is missing. Retention varies from 23% (Hong Kong) to 90% (China).

**Why it matters.** Proposal §3.4 is explicit: any Wave 2 or midyear view must display coverage alongside the estimate. A reader comparing Hong Kong's Wave 2 figure with China's is comparing a 23% follow-up with a 90% one.

**Caveat — verify before fixing.** `CoverageBanner.tsx` exists, and the API was down during this review. But the per-variable coverage data is in the static tier: the Codebook detail page renders "Answered, by country and wave" fully offline. So even if the banner returns with the API up, it should read from the same offline source. Re-run this one with `make api` running; if it renders, the finding narrows to "must also work in offline mode".

### F4 — The empty state blames the API; the invalid-parameter notice is incomplete · **Major**

**Reproduction.** `/?outcome=NOT_A_VARIABLE&wave=Y9&stat=banana`.

**What I saw.** Three amber blocks stacked on one screen: the global offline banner, "Some URL parameters were invalid and were reset to defaults: stat. Dismiss", and a content-area box reading "The live API is unreachable / Precomputed views still work; custom queries need the API." The notice names only `stat`; the invalid `outcome` and `wave` were dropped silently, leaving the picker on "Pick a match…". The content-area message is about the wrong problem — nothing is selected, and that has nothing to do with the API.

**Fix.** In `AtlasView.tsx`, make "no outcome selected" the higher-precedence empty state ("Choose an outcome to begin"), and have `state/searchCodec.ts` report every rejected parameter in the notice, not the first. Consider muting the second and third amber blocks to one.

### F5 — The landing page never says what this is · **Major**

**Reproduction.** `/` at any viewport, first paint.

**What I saw.** Brand, nav, (banner), controls, chart. No sentence anywhere above the fold about the study, the 23 countries, the 207,919 respondents, or the years. The Phase 0 scaffold this replaced had exactly that sentence; it did not survive.

**Why it matters.** Two of the three stated audiences arrive cold: the curious visitor and the hiring manager clicking a portfolio link. The footer does carry the citation, two screens down.

**Fix.** One deck line under the h1 on the Atlas route (`AtlasView.tsx`), styled from `--ink-secondary` at `--text-md` — the study, the scale, and what the controls do. It costs one line of vertical space and answers the first question every visitor has.

### F6 — Engineer-facing copy on public surfaces · **Minor**

`served from precomputed files` (tier badge) · `The live API is unreachable — showing precomputed views; custom queries are unavailable` · `Second breakdown (live query)` · `direction: none` (variable detail) · `weighted (w_c1) · design-based (Taylor) SEs · 95% CI` (chart footnote).

Each is accurate and each is written for the person who built it. Suggested register: "standard view (instant)" for the badge; "Live data service is offline — the standard views still work; filters and medians are unavailable" for the banner; "Second breakdown (needs the live service)"; a plain gloss plus a Methods link on the footnote. `src/components/TierBadge.tsx`, `AppShell.tsx`, `BreakdownsView.tsx`, `CodebookDetailView.tsx`, `ChartFigure.tsx`.

### F7 — The Methods page opens with repo-internal framing · **Minor**

**Reproduction.** `/methods`, first paragraph after the summary card: "This page is the source for the in-app Methods view (Phase 4); the implementation is the `flourish_stats` package, verified against R's `survey` package (see R parity below)."

A visitor does not know what Phase 4 is, and "this page is the source for" is a sentence about the file, not about the method. Fix in `docs/METHODS.md` (rewrite that paragraph so it reads as the page) rather than in the renderer, so the document stays the single source.

### F8 — Sort placement is inconsistent · **Minor**

Atlas puts "Sort: By value / By country" *below* the chart card, after the footnote; Breakdowns puts "Sort countries" *above* it with the other controls. Same control, same job. Move the Atlas one up into the control row (`AtlasView.tsx`).

### F9 — Country picker details · **Minor**

`/?outcome=sfi&wave=Y1` → "Countries (all)": the panel does not close on Escape (pressed twice, once with focus inside it); "Show all" is a real button but reads as a panel heading; rows are ~26 px, below the 44 px touch guideline the phone needs; and when the Distribution view is showing Argentina, no country is checked in the picker — the view's state and the control's state disagree. `src/components/controls/CountryFilter.tsx`.

### F10 — Distribution defaults to Argentina, unexplained; hatch has no legend · **Minor**

`/?outcome=sfi&wave=Y1&stat=distribution` shows Argentina — the first country code — with the caption "Showing Argentina — pick countries above to compare (up to four)". Switching from Mean (23 countries) to Distribution (one arbitrary country) is a jolt. Prefer carrying over the current country filter, or an explicit "choose up to four countries" state. Separately, bins 0–4 render as hatched withheld placeholders with nothing saying what the hatch means; the footnote mentions the n < 50 rule but never connects it to the pattern. `AtlasView.tsx`, `charts/Histogram.tsx`.

### F11 — "chart this →" wraps in every Codebook row · **Minor**

`/codebook` at ~800 px: the arrow drops to a second line in all 161 rows, inflating row height. `white-space: nowrap` on that cell in `CodebookView.module.css`.

### F12 — The tier badge reads as a control · **Minor**

On `/codebook` the badge sits inline at the end of the filter row, looking like a fourth filter; on the variable detail page it sits inside the metadata line. It is provenance, not a control — right-align it with the result count, or move it beside the data-version line in the footer.

### F13 — The offline banner appears where it cannot matter · **Minor**

It renders on `/methods` and on the 404 page, neither of which loads data. Scope it to the data views (`AppShell.tsx`).

### F14 — Prose measure is unconstrained · **Minor**

`.layout` caps at 68 rem (~1088 px) and the Methods prose fills it — roughly 140 characters per line on a wide screen, about double a comfortable measure. Cap the Methods column at ~70ch (`MethodsView.module.css`); the data views can keep the full width.

### F15 — Theme button label · **Polish**

The button reads "☀ Light" in light mode and "🌙 Dark" in dark mode — that is the current state, but a button usually names its action. Either label the action ("Switch to dark") or make the state reading unmistakable with `aria-pressed` and a segmented look. `ThemeToggle.tsx`.

### F16 — Reading values off the ranked chart · **Polish**

The axis renders once, below all 23 rows, and only the leading bar carries a number. Mid-list values can be read only by scrolling to the axis or opening the data table. Direct-label every row (or every other row) once F1 gives the labels room.

### F17 — Nav wraps below ~800 px · **Polish**

`.nav { flex: 1; flex-wrap: wrap }` with a 1.5 rem gap sends "Methods" to a second line at the pane's natural width, and to four lines at 390 px. Fixed by the same change as F2.

---

## What is working well

Worth not breaking: suppression is genuinely rendered, with the n in place ("withheld (n = 46)") and a dagger for flagged cells — rare and exactly right. The Codebook detail page (breadcrumb, question in a blockquote, value labels with non-response flags, coverage by country and wave) serves the researcher audience better than most published codebooks. The categorical Atlas view, with its "share answering 'More than once a week'" subtitle and a contextual answer-level selector, is the best-designed screen in the app. Offline mode exists at all, and says so honestly. Focus rings are visible and consistent, the skip link is real, and `scrollbar-gutter: stable` shows someone chased a layout shift to its cause. The Hong Kong marker on the map is a small, correct piece of cartography.

## Still to verify (API was down)

Medians, filtered cuts, the second breakdown, the `oriented` toggle, the live-tier badge state, and whether F3's coverage banner appears when `/v1/variables/{name}` is reachable. Re-run the Atlas and Breakdowns rows of the sweep with `make api` running.
