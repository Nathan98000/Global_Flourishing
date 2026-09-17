# Design review — Flourish Atlas

A repeatable procedure for reviewing the **running** app's visual and interaction design. It produces evidence-backed findings, not impressions, and ends with an implementation prompt scoped to whatever the owner accepts. Run it from a Cowork session with the browser pane and the connected repo folder; nothing here edits the app.

## 0. Read the intent before looking at the app

Critique is measured against what this app set out to be, not against taste. Read first:

- `docs/PROPOSAL.md` §4.1 (three audiences: curious public, researchers, hiring managers), §4.2 (the user stories), §4.4 (design principles — uncertainty always shown, wording one click away, URL is the state, fast on a phone on a bad connection, colour encodes meaning consistently).
- `docs/adr/ADR-0010-frontend-rendering-stack.md` (stack, measured bundle, the Hong Kong map decision) and `ADR-0009-static-first-fetch-layer.md` (why some views say "precomputed" and some don't).
- `apps/web/src/styles/tokens.css` — the whole design system, both themes, with the contrast reasoning in its header comment.
- `CLAUDE.md` — charts may use `var(--token)` strings only; every number ships with weight, unweighted n and CI; suppression is rendered, never dropped.

Write down the constraints a fix may not break, and keep them visible while reviewing:

| Constraint | Where it bites |
|---|---|
| Initial route ≤ 250 kB gzipped (currently 187.5) | `scripts/check-budget.mjs`, CI |
| Lighthouse performance ≥ 90, accessibility ≥ 95 | `lighthouserc.cjs`, CI |
| Token contrast pairs are unit-tested | `src/__tests__/tokens.test.ts` |
| Six SFI domain hues are fixed across every view | proposal §4.4 |
| No new runtime dependency without an ADR line | ADR-0010 |
| Six Playwright journeys must still pass | `apps/web/e2e/journeys.spec.ts` |

## 1. Get the app running

**A — local, real data (preferred).** The owner runs, in the repo root:

```sh
rsync -a --delete data/static/ apps/web/public/data/   # 2,158 real files, not the 2-country fixtures
make api                                                # terminal 1
make web                                                # terminal 2 → http://localhost:5173
```

Review through the browser pane at `http://localhost:5173`. Confirm you are on real data before judging anything: the Atlas country list must show 23 countries with Indonesia at the top for `sfi` at Y1.

**B — the deployed site** (`https://flourish-atlas.pages.dev`) once a Phase 4 release tag has shipped. Same procedure; add a check that the deployed precomputed tier carries `meta.json` (the Phase 4 catalog files).

**C — synthetic fallback**, only if neither is available: `make web-fixtures && pnpm -C apps/web build && pnpm -C apps/web preview`. Two countries and a handful of variables — usable for state coverage (errors, empty, suppression), useless for density, ranking and map judgments. Say so in the report if any finding rests on it.

Browser-pane technique: `get_page_text` / `read_page` for structure, labels and copy; `computer {action: "screenshot"}` when the question is visual; `resize_window` between viewports. Save every screenshot you cite.

## 2. The sweep

Visit every cell. The URL is the state, so each is addressable — paste them rather than clicking through.

**Atlas** — `/?outcome=sfi&wave=Y1` (ranked bars, 23 rows) · `&view=map` · `&stat=distribution` · `&stat=median` · `&wave=Y2` (coverage banner) · a midyear-only outcome at `wave=MY` (e.g. `outcome=MONEY`) · a `lower_better` outcome (`outcome=LONELY`) · a categorical outcome (`outcome=ATTEND_SVCS`, proportions) · a three-country subset · a single country.

**Breakdowns** — by `age_band` (8 levels × 23 panels), by `employment` (8 levels), by `income_quintile`, a categorical outcome, and a cut deep enough to produce suppressed and flagged cells.

**Codebook** — the list; a search with many hits; a search with none; a detail page with long question wording, many value labels and country-specific labels; a non-servable variable (it should explain itself).

**Methods** — the long-form read: measure, rhythm, heading hierarchy, link density.

**Cross-cutting** — first paint (skeletons, layout shift); the API blocked at the network level (offline banner, tier badge, what still works); an invalid URL parameter (the notice); an unknown route (404); CSV and PNG export — open both files and judge them as standalone deliverables; the theme toggle; a full keyboard walk (tab order, focus visibility, skip link); `prefers-reduced-motion`.

**Viewports × themes** — 390×844 (phone), 768×1024, 1280×800, 1680×1050, each in light and dark. Start at 390: the stylesheet has **no width-based media queries at all**, so phone layout rests entirely on fluid rules and is the most likely place to find real defects.

## 3. The lens list

For each cell, look through these, in this order:

1. **First impression / orientation** — in five seconds, does the page say what this is, whose data it is, and what to do first?
2. **Information hierarchy** — what the eye hits first; whether the chart or the controls dominate; how the title, weight, n and CI relate.
3. **Typography** — scale steps in use, line length in prose, label sizes on charts, numeric alignment and tabular figures.
4. **Spacing and alignment** — rhythm between control groups, optical alignment of the chart frame with the header, gutters at phone width.
5. **Colour** — both themes; whether the accent is doing too much or too little; whether suppression and flags read as meaningful rather than broken; the sequential map ramp's discriminability.
6. **Chart legibility** — 23-row bar density, CI whisker visibility at small values, label collisions, axis and grid weight, direct labelling, legend need, small-multiple panel size, map projection and empty-country treatment.
7. **Controls** — affordance and grouping, selected vs unselected, the disabled state (e.g. MY greyed for `sfi`) and whether its reason is discoverable, touch targets ≥ 44 px, the country filter at 23 entries.
8. **State design** — loading, empty, error, offline, suppressed, flagged: does each look designed or accidental?
9. **Copy** — the tier badge wording, banner phrasing, button labels, the associations-not-causes note; jargon that a curious non-expert would stumble on.
10. **Motion and transition** — presence, restraint, reduced-motion behaviour.

## 4. Recording a finding

One entry per finding, severity first:

- **Blocker** — misleads about the data, or makes a view unusable at some viewport.
- **Major** — a first-time visitor is slowed or confused; a hiring manager would notice.
- **Minor** — inconsistency a careful eye catches.
- **Polish** — taste; label it as taste and say so plainly.

Each entry carries: what it is · where (view, viewport, theme, URL) · evidence (screenshot file, or quoted text/DOM) · why it matters (tie it to an audience or a stated principle) · the proposed fix (file path, and the token or property to change) · rough cost · risk (does it touch a budget, a contrast test, or a journey?).

Two rules: **no finding without evidence**, and **no fix without a file**. "Make the charts nicer" is not a finding.

## 5. Verify before recommending

- Search the ADRs and `CLAUDE.md` for the decision you may be about to re-litigate. Rejected already, with reasons: Tailwind, Radix primitives, Vega-Lite, Recharts, the 110m map with a synthetic Hong Kong marker.
- Check contrast claims against the actual token values, not against a screenshot's rendering.
- Anything that would change what a number *means* — a scale baseline, a default weight, a rounding rule — is out of scope for a style review: note it and stop.
- Re-check any density or ranking finding on the real tier before writing it up.

## 6. Deliverables

1. `docs/design-review-<YYYY-MM-DD>.md` — a findings table ordered by severity, then one section per finding as specified in §4.
2. `docs/design-review/<YYYY-MM-DD>/` — the cited screenshots, named `<view>-<viewport>-<theme>.png`.
3. **The three changes with the best ratio of perceived quality to effort**, called out at the top — this is what the owner reads first.
4. A ready-to-run implementation prompt for Claude Code covering only the accepted findings, carrying the §0 constraint table and the verification commands (`pnpm -C apps/web test`, `make lint typecheck`, `pnpm -C apps/web e2e`, the budget script).

## 7. Rules of engagement

- Review first, propose second; do not edit the app mid-review.
- Prefer a token-level fix to a component-level one, and a component-level fix to a new dependency.
- Never propose hiding uncertainty, suppression, sample sizes or the direction label to make a chart cleaner.
- Distinguish "this is broken" from "I would have done it differently", every time.

## 8. Open questions to test (hypotheses, not conclusions)

- No width media queries exist — how does the control row, the 23-row chart and the small-multiples grid behave at 390 px?
- `--ink-muted` is documented as below AA and reserved for hairlines — is it used anywhere for text?
- Does the ranked bar chart earn its 23 rows, or does it want a scroll, a top-n, or a different mark?
- Is "served from precomputed files" meaningful to a non-technical visitor, or is it engineer-facing copy in a public surface?
- The map chunk carries a 230 kB topology — does the map's first paint feel like a jump from the bars view?
- Does the disabled MY toggle explain why it is disabled, or leave a dead control?
