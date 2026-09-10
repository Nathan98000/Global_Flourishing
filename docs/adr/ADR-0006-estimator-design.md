# ADR-0006: Estimator design — Taylor linearisation matching R `survey`

**Status:** Accepted · **Date:** 2026-09-10 · **Phase:** 2

## Context

Every number the app shows needs a design-based standard error over 411
strata and 136,781 PSUs, computed per request inside a 512 MiB Cloud Run
instance, and provably equal to the reference implementation (R `survey`)
— proposal §5.3 and the Phase 2 exit criterion. Five countries are
self-representing (PSU = respondent), 38 strata have a single PSU in the
release, and domain estimation (any subgroup view) creates more lonely
strata at runtime. `w_r2` being populated on all rows, and the two
midyear administration modes, make weight/eligibility rules a correctness
hazard if they live in more than one place.

## Decision

1. **With-replacement Taylor linearisation, mirroring `survey` 4.5
   exactly.** Scores `z_i = w_i (y_i − ȳ)/Σw` are summed to PSU totals;
   a stratum with `n_h` design PSUs and `m_h` of them present in the
   domain contributes `n_h/(n_h−1)·(Σ z_hj² − T_h²/n_h)` (absent PSUs
   enter as zero totals — R pads them, so the stratum mean divides by the
   *design* count). Verified against the installed package's source
   (`svymean.survey.design2`, `onestage`, `onestrat`), not just its
   documentation.
2. **Lonely-PSU policy = R's `adjust` options.** With
   `survey.lonely.psu="adjust"` and `survey.adjust.domain.lonely=TRUE`:
   a stratum lonely *in the design* (`n_h = 1`) contributes
   `(z − z̄)²` with no factor; a stratum lonely *in the domain*
   (`m_h = 1 < n_h`) keeps the `n_h/(n_h−1)` factor and the padded
   zeros, centred at the grand mean `z̄ = Σ scores / Σ design-PSU counts
   of the strata present. The two cases differ in R's code and both are
   reproduced (the grand mean is identically zero for Hájek means, but is
   computed faithfully so totals/ratios stay correct later).
3. **Domain estimation keeps the full design.** The frame handed to an
   estimator *is* the design; null values and `by=` groups only zero the
   scores. Consequently each weight spec's *eligible rows* are the design
   for that spec (an R `svydesign` built on the eligible subset), which
   the parity fixture pins — including the `my_y2` spec, whose design is
   the standalone-midyear rows.
4. **The wave→weight→eligibility table is data** (`flourish_stats.weights`):
   frozen dataclass rows with a JSON export for `/v1/meta`, the *only*
   home of the `w_r2` quirk and the `midyear_type = 1` restriction;
   `three_point_panel` enforces the restriction internally as domain
   estimation.
5. **Normal-based 95% CIs** (`statistics.NormalDist`), matching
   `confint` on a `svymean`; no scipy. Quantiles are `qrule = "math"`
   point estimates with `ci_method = "none"` (Woodruff CIs are backlog);
   correlations are point estimates (Pearson equals the `svyvar` ratio;
   Spearman = weighted Pearson on average ranks, one defensible
   definition, documented in METHODS.md).
6. **Arrow in, Arrow out; polars group-bys inside.** No Python loops
   over PSUs or strata; proportions/transitions reuse the mean machinery
   on indicator columns (levels × rows cross join on a slimmed frame).
   Suppression is a pure parameterised function applied to every record.

## Measured performance (M-series laptop, 207,919-row Wave 1 frame)

| Path | Median |
|---|---|
| Weighted mean + Taylor SE, by country (23 groups) | **38 ms** |
| Weighted mean + Taylor SE, single group | 28 ms |
| 11-level distribution with per-bin CIs, by country | 361 ms |

The mean path beats the 100 ms Phase 2 target by ~3×; the distribution
path pays for the 11× indicator expansion and stays acceptable for the
API tier (hot views are precomputed statically in Phase 3 regardless).

## Parity outcome and tolerances

All 30 cases (`stats/verify/cases.csv` → committed
`stats/verify/reference.json`, R 4.6.0 / survey 4.5) pass at:

- point estimates |Δ| ≤ 1e-9 · SEs relative Δ ≤ 1e-6 · quantiles exact ·
  correlations |Δ| ≤ 1e-9 · unweighted n exact.

No per-case loosening was needed (`CASE_TOLERANCES` in
`stats/verify/test_parity.py` is empty); any future entry must name its
mechanism there and here. One release fact the fixture leans on: **no
substantive item spans MY and Y2** (the 16 midyear items exist only at
MY), so MY→Y2 change is necessarily a cross-item contrast — the fixture
pairs `GOOD_RELATION` (MY) with `SAT_RELATNSHP` (Y2), which is also how
the Phase 5 What Matters view will use `w_l1m2`.

## Alternatives considered

- **Replicate weights (bootstrap/BRR/jackknife)** — the release ships
  none, generating them adds a large artefact and RAM cost per request,
  and Taylor is the reference R workflow for this design; rejected.
- **`samplics`/`statsmodels` for estimation** — new heavy dependencies,
  none reproduce `survey`'s lonely-PSU domain semantics exactly, and the
  core is ~200 lines of group-bys; rejected.
- **Naive weighted SEs with a design-effect disclaimer** — materially
  wrong in the six clustered countries, and the proposal's whole point is
  doing this correctly; rejected.
- **Finite-population correction** — the release carries no FPC columns
  and `survey`'s default (with-replacement) matches its absence; revisit
  only if a future release ships them.

## Consequences

- Any subgroup view the API can express inherits correct variance
  behaviour for free, including runtime-lonely strata.
- The engine is pinned to `survey`'s *current* semantics; a future
  `survey` release changing the lonely-PSU adjustment would surface as a
  parity failure with a recorded version trail (`reference.json` meta,
  survey ≥ 4.2 enforced in `reference.R`).
- Quantiles ship without CIs until Woodruff intervals are implemented
  (backlog); the record's `ci_method = "none"` makes that visible to the
  API rather than silently absent.
