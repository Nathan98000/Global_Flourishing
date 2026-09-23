# Phase 5 — Panel, midyear and US views

**Read this file first and follow its "read only these" list.** It carries the
context, the file anchors and the two owner decisions. Do not sweep the repo, and
do not read `docs/PROPOSAL.md` beyond §7's Phase 5 line if you read it at all —
the scope below supersedes it where they differ. Do not run the data pipeline or
`make deploy`.

## Context

Flourish Atlas is a public explorer for the Global Flourishing Study, live at
`flourish-atlas.pages.dev` on v0.4.0. Phases 0–4 shipped: pipeline, statistics
engine, API, and the Atlas / Breakdowns / Codebook / Methods front end. Phase 5
adds four views.

**The statistics and the API already exist. This is a front-end phase.**

- `stats/src/flourish_stats/panel.py` has `paired_change`,
  `paired_change_distribution`, `three_point_panel`, `transition_matrix`.
- `GET /v1/change` and `GET /v1/states` are implemented and tested
  (`services/api/src/flourish_api/routes/{change,states}.py`).
- `apps/web/src/api/schema.d.ts` already types both endpoints — the OpenAPI
  contract does not change in this phase. **Do not touch `openapi.json`, the
  generated client, the API, the stats engine or the pipeline.** If you believe
  a change there is required, stop and say why instead of making it.

Work in `apps/web` plus the documents named at the end.

### Invariants

- Initial route ≤ 250 kB gzipped (`pnpm -C apps/web budget`); currently ~190 kB,
  so every new view is a lazy route like the existing non-index ones.
- Lighthouse ≥ 90 performance, ≥ 95 accessibility.
- `src/__tests__/tokens.test.ts` may be extended, never weakened.
- Chart code passes colours as `var(--token)` strings from `charts/theme.ts`;
  no hex literals.
- **The front end computes no statistics and owns no labels** (CLAUDE.md). Every
  estimate, CI, n and label comes from the response. The one exception already in
  the codebase is navigation copy in `src/topics.ts`; new navigation copy goes
  there too.
- Numbers shown to users always carry their weight, unweighted n and CI.
- The URL is the state: every view's controls round-trip through
  `src/state/search.ts` in the established `parse*Search` / `*SearchParams` /
  `*Request` pattern, with defaults omitted from the address bar.
- Visual system is ADR-0012: warm paper, serif headings over a sans interface,
  hairline rules, no cards, quiet segmented controls. Reuse
  `charts/ChartFigure.tsx`, `components/EstimateTable.tsx`,
  `components/controls/*`, and the chart components in `src/charts/`. Add no new
  runtime dependency.

### Files to read

`src/router.tsx` · `src/state/search.ts` · `src/state/searchCodec.ts` ·
`src/api/{estimates,meta,types,http,variables}.ts` · `src/components/Skeleton.tsx` ·
`src/components/AppShell.tsx` · `src/charts/{ChartFigure,usePlot,DotPlot,RankedBar,Histogram,SmallMultiples,Choropleth}.tsx` ·
`src/components/EstimateTable.tsx` · `src/views/{AtlasView,BreakdownsView}.tsx` ·
`src/topics.ts` · `src/labels.ts` · `e2e/journeys.spec.ts` ·
`services/api/src/flourish_api/routes/{change,states}.py` (for their parameters
only) · `stats/src/flourish_stats/outcomes.py` (for `SFI_DOMAINS` and the domain
display names).

---

## Owner decision 1 — a progress affordance for slow calls

None of the four new views is in the static tier, so all four hit the live API.
A cold Cloud Run instance answers `/health` in ~7s; warm calls are ~0.3s. The
existing bare `Skeleton` gives no sign that a 7-second wait is progressing.

Build `src/components/Loading.tsx` exporting **`LoadingBlock`**, which replaces
the bare `Skeleton` at every *estimate*-loading call site (leave the simple
list/detail skeletons alone):

1. **0 ms** — the skeleton exactly as today, sized like the content it stands in
   for. Layout must not shift when the data lands.
2. **After 600 ms** — a thin indeterminate progress bar appears at the top of the
   block, 2px, `var(--accent)` on `var(--grid)`, a slow sweep.
3. **After 4 s** — one line of plain-language copy under the bar:
   **"Still working — the first data fetch can take a few seconds."**

Rules:

- **Never a spinner.** The proposal's risk table commits to skeletons; this is a
  progress bar attached to a skeleton, not a replacement for it.
- Honour `prefers-reduced-motion: reduce` — the bar becomes a static filled rule,
  no sweep.
- Accessibility: the block keeps `role="status"`, carries `aria-busy="true"`, and
  announces **once**. The 4 s line must not re-announce on every repaint.
- **Refetches keep the chart.** When a query refetches with data already on
  screen (`isPlaceholderData`), do not swap in a `LoadingBlock` — keep today's
  dimmed-figure treatment (`ChartFigure`'s `isRefreshing`) and put the same thin
  progress bar at the top of the figure.
- The thresholds are two exported constants, and the delay logic is one small
  hook (`useDelayedFlags` or similar) with its own unit test using fake timers.

**Warm the instance.** On entering any of the four new routes, fire a single
`GET ${API_BASE_URL}/health` immediately (fire-and-forget, errors ignored, once
per session per route entry) so the cold start overlaps with the user choosing
their options rather than following it. Do not block render on it, and do not add
it to the Atlas, which is served statically.

## Owner decision 2 — retention is for the maths, not the interface

The panel weights (`L2`, `L_1M2`) already carry the attrition adjustment, and
`flourish_stats.weights` enforces eligibility. **Use them freely. Keep the
vocabulary off the screen.**

This narrows the Phase 5 exit criterion in `docs/PROPOSAL.md` §7, which asked for
coverage to be displayed wherever Wave 2 or midyear data appear. It is now:

- **No retention percentages, coverage tables, or attrition figures in the
  default interface.** The words *attrition*, *retention*, *panel*,
  *longitudinal*, *cohort* and *wave pair* do not appear in user-facing copy.
- The honest signal is already in the numbers: the confidence interval widens as
  the follow-up group shrinks, and unweighted n is already in every data table
  and CSV. That is sufficient for the normal case — add nothing.
- **One reserved exception.** Where a country's follow-up group is small enough
  that the estimate could mislead, the figure carries a single plain sentence —
  no number, no jargon — such as **"In some countries fewer people answered the
  second time, so those estimates are less certain."** Use one threshold,
  defined once as a named constant, derived from what the response already
  carries (the change row's `n` against the same country's Wave 1 `n`); do not
  invent a coverage fetch to compute it. Show the sentence at most once per
  figure.
- Full numbers stay available to anyone who wants them: unweighted n in the data
  table, the CSV export, and a short Methods paragraph. Methods may use the
  technical terms; the views may not.

Judgement call, stated so you do not have to guess: "sparingly" is not "never".
If you find a case where a reader would draw a clearly wrong conclusion without a
word of warning, add the reserved sentence rather than staying silent — and note
it in the PR description.

---

## The four views

Each is a lazy route registered in `src/router.tsx` with its own search schema in
`src/state/search.ts`, and appears in the `AppShell` nav. Nav order:
**Atlas · Change · Compare · What Matters · US States · Breakdowns · Codebook ·
Methods** — and check the header still works at 390px; if eight items will not
fit, collapse the secondary ones rather than shrinking the type.

### A. Change — `/change`

`GET /v1/change?outcome=&from=Y1&to=Y2` (plus `via=MY` for the three-point panel,
`by=`, `filter=`, `scope=`, `rect=`). One request returns **several row kinds in
one envelope**, discriminated by `row.stat`:

- `stat: "change"` — mean within-person change with CI. With `via`, one row per
  `leg` ∈ `y1_my` · `my_y2` · `y1_y2`.
- `stat: "change_distribution"` — the histogram of individual change; `level` is
  the signed change bucket.
- `stat: "transition"` — the transition matrix for ordinal/nominal/binary items;
  keyed by `from_level`, `to_level`, `measure`.

Note `Stat` in `src/api/types.ts` is `'mean' | 'proportion' | 'distribution' |
'quantile'` and does **not** cover these. Add a separate `ChangeStat` union and
row-narrowing helpers rather than widening `Stat`, which the Atlas and the static
tier both depend on.

Render: a dumbbell or arrow chart of Wave 1 → Wave 2 per country with the change
CI (build it from the existing `DotPlot` marks rather than a new chart module if
that is honest); the change histogram via `Histogram`; the transition matrix as a
small heatmap table for categorical items. **Zero must be visible and marked on
any change axis** — a change chart that crops zero is a lie. Countries sort by
change, not level, with the usual high-to-low / low-to-high control.

Copy: "how the same people answered a year later", never "longitudinal panel".
The three-point option appears only for outcomes and countries where it is
available, labelled by what it is ("2023 → mid-2024 → 2024"), and the standalone-
midyear restriction is the API's job — do not re-state or re-implement it.

### B. Compare — `/compare`

2–5 countries or segments across the six SFI domains, plus any chosen item.
Domains come from `outcomes.py`: `sfi_happiness`, `sfi_health`, `sfi_meaning`,
`sfi_character`, `sfi_relationships`, `sfi_financial`, with their display names
from the response, not hardcoded. Fetch through the existing
`useEstimates`/`/v1/aggregate` path — these are ordinary cross-sections.

A dumbbell per domain reading down the page beats a radar: radar distorts
magnitude and has no honest place for a CI. If you build a radar, it is an
alternate view, not the default. Selection is a country multi-select capped at
five with a plain message at the cap.

### C. What Matters — `/what-matters`

The midyear family (`family: midyear`, wave `MY`). The seven importance items —
`MONEY`, `GOOD_RELATION`, `MEANINGFUL`, `HEALTHY`, `REL_LIFE`, `HAPPY_IMPORT`,
`GOOD_PERSON` — form the ranking; the remainder (`TIME_MEDIA`, `FOOD_INSECURE`,
`NATURE`, `BEAUTY`, `ENGAGE_ARTS`, `DILIGENT`, `MIND_FOCUSED`, `ACHIEVING`) are
chartable items. Fetch the item list from the variables catalog by family; do not
hardcode the names in a component.

Three things it shows: what people rank highest by country; how that shifts by
age band (`by=age_band`); and two prepared crossings — social media time ×
mental health, and food insecurity × the financial domain — each a breakdown
request, each carrying the "associated with, not caused by" framing the Methods
page already uses.

### D. US States — `/states`

`GET /v1/states?outcome=&wave=&stat=&adj=&by=&filter=`. A US state choropleth on
the state-calibrated weights, plus state-vs-national comparison. `adj=true`
selects the adjusted weight variants, which **do not exist for Wave 1** — the
control must be unavailable, with a reason, on Y1 rather than erroring.

The existing `Choropleth` is world-topology; a US states topology is a **lazy
chunk**, loaded the way the world map already is, so it stays out of the initial
bundle. 157 US respondents have no state and are simply absent — no empty-state
drama. Reuse the existing "no estimate" swatch treatment for states with no data.

## Out of scope — do not build

- **The population-rescaled "all countries" option.** The owner has not decided
  on it; leave it out entirely and do not add a placeholder control.
- **Extending the static exporter** to precompute these views. They are API-only
  this phase; decision 1 is the answer to the latency.
- Correlates, model cards, adjusted associations — Phase 6.

---

## Tests and gates

- Component tests for every new chart and control; hook tests for the new search
  schemas' round-tripping, including bad params degrading to defaults.
- A unit test for the delay hook with fake timers, and one asserting the 4 s copy
  is not announced twice.
- A test that asserts **no retention/coverage percentage renders** in a change
  view's default output — this is the guard that keeps decision 2 from eroding.
- Two new Playwright journeys, matching the launch checklist: **Change with a
  low-retention country** and **What Matters with a combined-midyear country**.
  Reuse the synthetic fixtures; add fixture rows rather than real data.
- Run: `pnpm -C apps/web test && pnpm -C apps/web budget && pnpm -C apps/web e2e`
  then `make lint typecheck`. Report the gzipped initial-route figure in each PR
  description — four new routes is the phase's main budget risk.

## Shape of the work

Four stacked PRs, conventional-commit subjects, each green before the next:

1. **Plumbing** — `LoadingBlock` + delay hook + warm-up ping, the four routes and
   nav, the search schemas, and the change/states query hooks with their types.
2. **Change** — the view, its charts, the reserved sentence and its threshold.
3. **Compare + What Matters**.
4. **US States**, the ADR, and the doc updates below.

Stop before pushing tags or deploying.

## Documents

- **New ADR** in `docs/adr/` (MADR, next number after 0012) recording: the
  progress-affordance rule and why it does not contradict "skeletons, never
  spinners"; the narrowed retention-display rule and that it reverses the Phase 5
  exit criterion in the proposal; API-only serving for these views.
- **`docs/METHODS.md`** — a short plain-language section on what "the same people
  a year later" means, why fewer second answers widen the interval, and where to
  find the n. Technical terms are allowed here.
- **`docs/PROPOSAL.md`** — one line under Phase 5 noting the narrowed exit
  criterion and pointing at the new ADR. Do not rewrite the phase.
- **README** — add the new views to the feature list; refresh the screenshot only
  if the nav change makes the current one wrong.
