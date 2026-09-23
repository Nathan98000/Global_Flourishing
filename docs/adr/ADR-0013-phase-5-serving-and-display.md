# ADR-0013: Phase 5 — API-only views, a progress affordance that is not a spinner, and retention kept off the screen

- Status: Accepted
- Date: 2026-09-23
- Deciders: repo owner, Claude
- Related: ADR-0009 (static-first fetch layer — unchanged), ADR-0011
  (every cell shown, with its n), ADR-0012 (visual system — unchanged),
  proposal §7 Phase 5 (exit criterion revised here), proposal §8 risk
  table ("show a skeleton, never a spinner")

## Context

Phase 5 adds four views — Change (the same people a year later), Compare
(two to five countries across the six SFI domains), What Matters (the
midyear survey) and US States (state-calibrated weights) — on statistics
and endpoints that already existed (`flourish_stats.panel`, `/v1/change`,
`/v1/states`). Three questions had no answer in earlier records:

1. **None of the four views is in the static tier.** Every call goes to
   the live API on Cloud Run's free tier, where a cold instance answers
   its first request in about seven seconds and a warm one in a third of
   a second. The proposal's risk table commits to "a skeleton, never a
   spinner", and the bare skeleton gives no sign that a seven-second
   wait is progressing.
2. **What to say about retention.** The proposal's Phase 5 exit criterion
   asked for coverage to be displayed wherever Wave 2 or midyear data
   appear. The September design rounds had already taken coverage off
   the estimate views (ADR-0011's companion decision, recorded in
   `docs/METHODS.md`), and the Change view is where the question bites:
   Wave 2 follow-up runs from 23% of the Wave 1 sample in Hong Kong to
   90% in China.
3. **Whether to extend the static exporter** to precompute change, state
   and midyear views, so they too load with the API cold.

## Decision

**API-only serving for the four views.** The static exporter is not
extended. Change, Compare, What Matters and US States are lazy routes
that fetch from `/v1` (Compare and What Matters through the existing
static-first estimates path, which does find the six domain and seven
midyear cross-sections in the tier; Change and US States are API-only
by construction). The latency question is answered by the affordance
below, not by more precomputation; the population-rescaled "all
countries" option stays out entirely until the owner decides it.

**A progress affordance, not a spinner.** `LoadingBlock` replaces the
bare skeleton at every estimate-loading call site. It *is* the skeleton
— sized like the content, so nothing shifts when the data lands — with
two things attached on a clock: after 600 ms a 2px indeterminate bar
(accent on the grid track, a slow sweep; a static filled rule under
`prefers-reduced-motion`), and after 4 s one line of plain copy, "Still
working — the first data fetch can take a few seconds." The thresholds
are two exported constants; the timing is one hook. This does not
contradict the risk table: a spinner *replaces* content with a symbol
that says nothing about what is coming; this keeps the content-shaped
placeholder and adds a bar that says the wait is progressing and, past
four seconds, why. Refetches never swap in a block — a figure with data
on screen keeps its dimmed treatment and wears the same bar on its top
rule. Entering any of the four routes also fires one fire-and-forget
`GET /health`, so a cold start overlaps with the visitor choosing their
options rather than following it.

**Retention is for the maths, not the interface.** The panel weights
(`w_l2`, `w_l1m2`) carry the attrition adjustment and
`flourish_stats.weights` enforces eligibility; the views use them and
say nothing about them. No retention percentage, coverage table or
attrition figure appears in the default interface, and the words
*attrition, retention, panel, longitudinal, cohort* and *wave pair* do
not appear in user-facing copy (a unit test and a journey guard it).
The honest signal is already in the numbers: the interval widens as the
follow-up group shrinks, and unweighted n rides on every table row and
CSV. One reserved exception: where a country's follow-up group is small
enough that an estimate could mislead — its change row's `n` (complete
pairs) under **half** of the same country's earlier-wave n, both taken
from responses the view already has, never from a coverage fetch — the
figure carries a single plain sentence, at most once, with no number:
"In some countries fewer people answered the second time, so those
estimates are less certain." The threshold is one named constant
(`FOLLOW_UP_CAUTION_RATIO`). On the current release this line trips for
roughly ten of the 23 countries on a 2023 → 2024 index change, so the
sentence shows on most default Change figures; that is the honest
reading of the data, and the constant is the owner's to move.

**This reverses the Phase 5 exit criterion** in `docs/PROPOSAL.md` §7
("coverage is displayed wherever Wave 2 or midyear data appear"). The
technical account lives in `docs/METHODS.md`, which may use the
technical terms; the views may not.

Two smaller calls made under the same brief, recorded so they are not
re-litigated:

- **Compare draws a dumbbell per domain reading down the page, never a
  radar** — a radar distorts magnitude and has no honest place for a
  confidence interval. The selection is capped at five countries, with
  the cap stated in plain words.
- **The US states topology is vendored, not a dependency.** `us-atlas`'s
  `states-10m.json` (ISC; Census Bureau geometry, public domain) ships
  under `apps/web/src/charts/assets/` and loads through `?url` inside
  the lazy states-map chunk, exactly as the world topology does — an
  asset, so the no-new-runtime-dependency rule is untouched (notice in
  `docs/NOTICES.md`).

## Alternatives considered

- **A spinner for the cold start** — replaces a content-shaped
  placeholder with a symbol; the proposal already rejected it, and it
  shifts layout when the data lands.
- **A modal "warming up" message** — blocks the controls the visitor
  could be using while the instance warms.
- **Coverage tables or follow-up percentages beside Wave 2 and midyear
  estimates** (the original exit criterion) — a wall of jargon on every
  figure that most readers cannot act on, duplicating what the interval
  and the n already say; kept for the Methods page and the Codebook's
  per-variable table instead.
- **Precomputing change and state views into the static tier** — 161
  outcomes × several wave pairs × transition matrices would multiply the
  2,158-file tier several times over for views with far fewer visits
  than the Atlas; the affordance costs nothing per deployment.
- **A radar for Compare** — rejected above.
- **`us-atlas` as an npm dependency** — the same bytes, one more entry
  in `dependencies`; the brief said none.

## Consequences

- Every Phase 5 view shows a plain, honest wait; nothing in the app
  spins. `LoadingBlock` is the one loading primitive for estimates;
  list/detail skeletons stay bare.
- Readers never see a retention rate in a view. Anyone who needs it
  reads the n in the table or the CSV, or the Methods page. Moving the
  caution line is a one-constant change.
- The four views depend on the live API; when it is offline they say so
  in the same words the Atlas uses, and the static views keep working.
- The two prepared What Matters crossings (social media time × mental
  health; food insecurity × the financial domain) cannot be made from
  this release through `/v1/aggregate`: the midyear items exist only at
  the midyear survey and their partners only at Waves 1–2, and the API
  requires a `by` variable at the outcome's wave. A cross-wave breakdown
  is an engine/API decision (which rows, which weight) left to the
  owner; the view is catalog-driven and explains itself until then.
- Revisit if the API moves off a scale-to-zero tier (the affordance
  would rarely fire), or if the owner wants a sparser caution line.
