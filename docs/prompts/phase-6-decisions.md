# Phase 6 — three owner decisions, then release prep

Small, mostly documentary. Work efficiently: read only what each task names, edit
directly, no narration, no refactors, no speculative work. Phase 6 is merged to
`main`; nothing here changes engine, API or view behaviour.

Context: Flourish Atlas monorepo. Live site is v0.4.0; Phases 5 and 6 are on
`main` and unreleased. Standing rules from CLAUDE.md apply. Gates unchanged:
coverage ≥ 90% on `stats/src` and `services/api/src`, web initial route
≤ 250 kB gz, Lighthouse ≥ 90 / ≥ 95.

---

## 1. The adjusted sweep stays slow — book it into Phase 7

**Decision: no optimisation now.** ADR-0014 already records the measurements
(warm: unadjusted one country 0.6 s, unadjusted by country 1.8 s, adjusted one
country 3.0 s, the view's cross-country matrix ~6 s, the full adjusted sweep
20.8 s) and names the lead — a numpy-only design-matrix build with a shared
per-group control matrix. **Do not implement it and do not micro-optimise
anything.**

Make sure a Phase 7 session actually finds it:

- Create `docs/phase-7-backlog.md`: a short, flat list of what Phase 7 must pick
  up, each item one or two lines with a pointer to where the detail lives. Seed
  it with, at minimum: this adjusted-sweep optimisation (pointing at ADR-0014's
  performance paragraph); security headers (`apps/web/public/_headers` does not
  exist — CSP, HSTS, `frame-ancestors`, `Permissions-Policy`); `ARCHITECTURE.md`,
  `DATA.md` and a rollback/rebuild runbook, none of which exist; a dependency and
  licence audit gate in CI (none today, though Dependabot is configured); the
  Sentry DSN and an uptime monitor (the server hook exists in `ops.py` and needs
  a DSN); a WCAG 2.1 AA pass by keyboard and screen reader across all nine views;
  the k6 load profile and an honest p95 measurement against the checklist's
  300 ms; and the question of whether the Phase 5 and 6 views should stay
  API-only or gain a precomputed tier.
- `docs/PROPOSAL.md` Phase 7: one line pointing at that backlog file. Do not
  rewrite the phase.

## 2. Prepare the statistics reviewer packet

**Decision: prepare materials; the owner arranges the reviewer.**

Write `docs/stats-review-packet.md` — self-contained, readable in about twenty
minutes by a statistician who has never seen this repo, and honest about what has
and has not been checked. Draw from `docs/METHODS.md`,
`docs/adr/ADR-0014-adjusted-associations.md`, `docs/model-cards/*.md`,
`stats/src/flourish_stats/{weights,design,estimators,correlations,panel}.py` and
`stats/verify/` — **read, do not restate at length**; the packet summarises and
links, it is not a second copy of the docs.

Cover, in this order:

1. **What the study is and what the app claims** — three sentences, plus the data
   version the numbers come from.
2. **Design and weights** — the wave → weight → eligibility table as the single
   source of truth, the strata/PSU counts, why `w_r2` being populated for
   everyone makes "weight is non-null" an invalid eligibility test, and the
   `midyear_type = 2` same-day restriction.
3. **Estimators** — mean, proportion, quantile, distribution, paired change,
   three-point panel, transition matrix, weighted correlation, adjusted
   association. One line each: what it computes and how its SE is formed.
   Name the Taylor/Kish split and that `se_method` is reported on every row.
4. **The adjusted models** — specification, the fixed control set, dummy coding,
   the country-fixed-effects rule when grouping by country, the sandwich SE, and
   the rank-deficient/undefined behaviour.
5. **What has been verified against R** — the parity harness, R 4.6.0 with
   `survey` 4.5, the case count, the tolerances, and specifically which of the
   new regression cases are covered (gaussian and binomial, with and without a
   domain). State the `survey` options used (`lonely.psu`, domain adjustment).
6. **Known limitations and deliberate choices** — suppression set to zero so
   every cell shows with its n (ADR-0011); correlations served as point estimates
   with no interval; the weighted-Spearman definition chosen and why; no pooled
   all-countries estimate; cross-sectional design.
7. **What we want checked** — a numbered list of five to eight specific
   questions, not "please review". Make them answerable. For example: is the
   sandwich SE the right analogue of `svyglm`'s for a domain-restricted fit; is
   the weighted-Spearman definition defensible for publication; is dropping
   country fixed effects when grouping by country the right call rather than
   refusing the combination; does serving unadjusted correlations without any
   interval mislead more than it informs; is the SFI's ten-of-twelve-items rule
   reproduced correctly.

Plain technical prose, no marketing, no hedging about how much work it was. Link
to the live site and the repo so the reviewer can check anything themselves.

Add a one-line pointer to the packet from `docs/adr/ADR-0014`'s consequences
(where the pending review is already noted) and from `docs/METHODS.md`.

## 3. Release prep for v0.5.0 — Phases 5 and 6 together

**Decision: both phases ship now as one version.**

- Confirm `main` is releasable: clean tree, in sync with `origin/main`, and the
  full gate run below green. If anything fails, fix it or stop and report —
  do not tag around a failure.
- Write `CHANGELOG.md` (it does not exist) with a `v0.5.0` entry covering both
  phases: the five new views (Change, Compare, What Matters, US States,
  Correlates), the loading affordance, the retention-off-the-screen decision, the
  adjusted-association engine and `/v1/correlates`, the model cards, and
  ADR-0013/0014. Keep it to what a reader would want — no commit dump. Add brief
  entries for v0.1.0–v0.4.0 from the existing tags so the file is not a stub.
- README: confirm the feature list names all nine views and that the screenshot
  is not now misleading; refresh it only if it is.
- **Do not tag and do not deploy.** Leave `main` ready and say in your final
  message that `make deploy TAG=v0.5.0` is the owner's step.

---

## Verification

```sh
uv run pytest --cov=flourish_api --cov=flourish_pipeline --cov=flourish_stats
uv run coverage report --include='stats/src/*' --fail-under=90
uv run coverage report --include='services/api/src/*' --fail-under=90
pnpm -C apps/web test && pnpm -C apps/web budget && pnpm -C apps/web e2e
make lint typecheck
```

One PR, conventional commits. In the description give only: the files added, the
gate numbers, and anything that surprised you.
