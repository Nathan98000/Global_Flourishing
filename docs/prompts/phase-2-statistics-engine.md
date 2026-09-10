# Phase 2 — Statistics engine

You are implementing **Phase 2** of Flourish Atlas in this repository. Phases 0 and 1 are complete and merged on `main`. Phase 2 delivers the survey-weighted statistics engine with design-based confidence intervals, verified against R's `survey` package, as a new workspace package that the Phase 3 API and the Phase 3 static-aggregate exporter will both consume.

## 0. Before writing any code

Read, in this order: `CLAUDE.md`, `docs/PROPOSAL.md` §3.2–3.4, §5.2–5.3, §6 and §7 (Phase 2), `docs/adr/ADR-0003-pipeline-engine-and-storage.md`, `docs/adr/ADR-0004-codebook-parsed-not-transcribed.md`, `data/README.md`, `data/validation_report.md`, `pipeline/src/flourish_pipeline/schemas.py`, `pipeline/src/flourish_pipeline/derive.py`, `pipeline/tests/conftest.py`, the root `pyproject.toml`, `.github/workflows/ci.yml`, and `infra/Dockerfile`.

The built data is present on this machine (`data/flourish.duckdb`, `data/parquet/*.parquet`, built by `make data`). `Rscript` with the `survey` package is installed. Run `make setup` first if `.venv` is missing, then confirm `make lint typecheck test` is green on `main` before you branch.

Phase discipline (CLAUDE.md): scope to Phase 2. Anything from Phases 3, 5 or 6 that the design must anticipate gets a loud `NotImplementedError("Not implemented: Phase N")` stub with the intended signature — never a partial implementation. Do **not** add `/v1` endpoints, do not build the static exporter, do not implement adjusted regressions.

## 1. Ground truth about the data the engine consumes

These facts were verified against the Phase 1 outputs. Use them; don't rediscover them, and don't contradict them without proving otherwise in a test.

**Tables** (`data/parquet/`, mirrored in `data/flourish.duckdb`):

- `respondents` — one row per `id` (207,919). Weights: `w_c1` (never null), `w_c2`, `w_l2`, `w_r2`, `w_l1m`, `w_l1m2`; US state variants `w_state_c1|c2|l2|r2|l1m|l1m2` and `w_state_adj_c2|l2|r2|l1m|l1m2`. Design: `strata` (Int32, 411 distinct), `psu` (Int64, 136,781 distinct). Flags: `retained_y2`, `has_midyear`, `midyear_type` (1 = standalone midyear interview, 2 = midyear items appended to the Wave 2 interview). Demographics incl. `country_code`, `age_band`, `gender`, `education_3`, `employment`, `marital_status`, `urban_rural`, `income_quintile`, `state`, `fips`.
- `responses_long` — `(id, wave ∈ {Y1, MY, Y2}, variable, value, nonresponse)`, 33.3M rows, sorted `(variable, wave, id)`. `value` is null for non-response; `nonresponse ∈ {skipped, dk, refused, null}`.
- `responses_oriented` — a DuckDB view over `responses_long` that flips the 11 `direction = lower_better` variables (`min + max − value`). Orientation is a **data-layer** concern; the engine is direction-agnostic and estimates whatever values it is handed.
- `derived` — `(id, wave)` with `sfi`, `sfi_n_items`, six `sfi_*` domain means, `phq2_score/positive`, `gad2_score/positive`, `priority_top`, `money_minus_relationships` (468,274 rows: 207,919 Y1 + 131,487 MY + 128,868 Y2).
- `variables` (182 rows; 150 substantive) with `scale_type ∈ {scale_0_10, ordinal, nominal, binary, count, …}`, `direction`, `min`, `max`, `waves_available` (list), and per-variable non-response code lists. `value_labels`, `countries` (code, name, iso3), `coverage`.

**Design structure:**

- Strata nest within countries (no stratum spans two countries) and PSUs nest within strata (no PSU appears in two strata), so `nest=TRUE` semantics hold and per-country estimation equals domain estimation over the full design.
- **Five countries are self-representing with PSU = respondent**: Japan (9), United States (22), Sweden (23), Hong Kong (24), China (25) each have exactly 1 stratum and one PSU per row. Overall, 134,048 PSUs contain a single respondent.
- **38 strata contain exactly one PSU** ("lonely PSUs"): Brazil (code 3) has 19 of them, Israel (8) 9, Türkiye (19) 4, Philippines (13) 3, Egypt (4) 2, India (6) 1. Some of these strata hold up to 37 respondents. Domain estimation (e.g. one age band within a country) will create many more lonely strata at runtime. The engine needs an explicit, tested policy for this that matches R exactly (see §2.3).
- Egypt (22 strata, 125 PSUs), Israel (37/140), Kenya (15/250), Nigeria (18/250), South Africa (18/249) and Tanzania (24/250) are genuinely clustered designs where Taylor linearisation differs materially from a naive weighted SE — pick parity cases from these.

**Weight availability (verified counts):**

| Weight | Non-null rows | Population it represents |
|---|---|---|
| `w_c1` | 207,919 | everyone at Wave 1 |
| `w_c2` | 128,868 | exactly `retained_y2` |
| `w_l2` | 128,868 | exactly `retained_y2` |
| `w_r2` | **207,919** | populated for all rows, including the 79,051 non-retained — it is *not* a retention indicator; see quirk below |
| `w_l1m` | 131,487 | exactly `has_midyear` |
| `w_l1m2` | 116,038 | exactly `retained_y2 AND has_midyear` (38,982 with `midyear_type = 1`, 77,056 with type 2) |
| `w_state_*` | 38,155 | US respondents with a `state` (157 US rows have none) |

Every weight has mean 1.0 within each country (checked for `c1, c2, l2, r2, l1m, l1m2`; max deviation 2.4e-4), so pooling countries is only meaningful after population rescaling (Phase 5).

**Quirk to record:** `w_r2` (the "rectangular" panel weight) is non-null for all 207,919 rows and differs from both `w_c1` and `w_l2` on every row. Row eligibility must therefore be an explicit predicate on the flags (`retained_y2`, `has_midyear`, `midyear_type`), never "weight is non-null". Document this in the weight table, `docs/METHODS.md`, and the README quirks paragraph.

**Midyear semantics:** for `midyear_type = 2` the MY and Y2 answers were given on the same day, so any MY→Y2 comparison must be restricted to `midyear_type = 1`. Enforce this in the weight/eligibility table so the API (Phase 3) and the Change view (Phase 5) cannot get it wrong.

## 2. What to build

### 2.1 A third workspace package: `stats/` → `flourish_stats`

Mirror the layout of `pipeline/`: `stats/pyproject.toml` (hatchling, `packages = ["src/flourish_stats"]`, `py.typed`), `stats/src/flourish_stats/`, `stats/tests/`, `stats/verify/`. Register it everywhere the other two packages are registered: root `[tool.uv.workspace] members`, `[tool.pyright] include` + `strict`, `[tool.pytest.ini_options] testpaths`, the CI `--cov` flags, `Makefile` help text, `CLAUDE.md` repo map, README layout table. Runtime dependencies: `numpy`, `pyarrow`, `polars` only. **No pandas** (ADR-0003), no scipy, no statsmodels; use `statistics.NormalDist` for quantiles of the normal. `duckdb` is an optional extra (`flourish-stats[duckdb]`) used only by `flourish_stats.io`, the verify script and built-data tests.

Make `flourish-api` depend on `flourish-stats` now and update `infra/Dockerfile` (copy `stats/pyproject.toml` into the first `uv sync`, copy `stats/` before the second) so the CI `docker` job proves the package installs into the runtime image. Do not import it from the API yet. The pipeline gains the dependency in Phase 3.

Write **ADR-0005** (package boundary: why a third package rather than `services/api/stats/` as proposal §5.3 says — both API and pipeline exporter need it, and the API image must not inherit pdfplumber/pandera) and **ADR-0006** (estimator design: with-replacement Taylor linearisation, lonely-PSU policy, domain estimation, normal-based CIs, Arrow in/out with polars/numpy inside, the wave→weight→eligibility table as data). Add both to `docs/adr/README.md`.

### 2.2 The wave→weight→eligibility table (`flourish_stats/weights.py`)

One frozen table — a tuple of dataclass rows, also exported as JSON by a function for Phase 3 to serve from `/v1/meta` — that is the *only* place these facts live. Rows (global scope):

| key | waves | weight column | eligible rows | kind |
|---|---|---|---|---|
| `y1` | Y1 | `w_c1` | all | cross-section |
| `y2` | Y2 | `w_c2` | `retained_y2` | cross-section |
| `my` | MY | `w_l1m` | `has_midyear` | cross-section |
| `y1_y2` | Y1→Y2 | `w_l2` | `retained_y2` | paired change (default) |
| `y1_y2_rect` | Y1→Y2 | `w_r2` | `retained_y2` | paired change, alternative "rectangular" weight; document the quirk above |
| `y1_my` | Y1→MY | `w_l1m` | `has_midyear` | paired change |
| `y1_my_y2` | Y1→MY→Y2 | `w_l1m2` | `retained_y2 ∧ has_midyear` | three-point panel |
| `my_y2` | MY→Y2 | `w_l1m2` | `retained_y2 ∧ has_midyear ∧ midyear_type = 1` | paired change |

Add the US-state scope as parallel rows keyed `us_state:*` on `w_state_*` (and `us_state_adj:*` on the `_adj_` variants) with eligibility `country_code = 22 ∧ state IS NOT NULL` plus the same flags. Every row carries a one-sentence human rationale used verbatim by `docs/METHODS.md`. Provide `resolve(waves: tuple[str, ...], scope: str = "global") -> WeightSpec`, `eligibility_expr(spec) -> polars.Expr`, and `validate_frame(frame, spec)` that raises if the frame's weight column is null on an eligible row or if ineligible rows are present. Tests: every weight column named in the table exists in `respondents` (unit test against a hard-coded column list; built-data test against the Parquet schema when data is present), and the observed non-null counts above are reproduced.

### 2.3 Estimators (`flourish_stats/estimators.py`, `design.py`, `suppression.py`, …)

Public API takes and returns `pyarrow.Table` (accept `polars.DataFrame` too via `.to_arrow()`); use numpy/polars internally. **No Python loops over PSUs or strata** — 136,781 PSUs must be handled with group-by sums. Target: weighted mean by country for one variable across 207,919 rows with Taylor SE in well under 100 ms; record measured timings in ADR-0006.

`Design(weight: str, strata: str | None, psu: str | None)`; `se_method` is `"taylor"` when both design columns are given, `"kish"` otherwise. The Kish path is a fallback the API must never choose silently, so the output record always states which was used.

Every estimator returns one row per group with a common record: `stat`, `estimate`, `se`, `ci_lo`, `ci_hi`, `ci_level` (0.95), `n` (unweighted valid responses), `sum_w`, `n_psu`, `n_strata`, `df` (= PSUs − strata among rows in the design), `se_method`, `weight` (column name), `suppressed`, `flagged`, plus the `by` columns. Rows with a null value are excluded from estimation (complete-case per item) but the design keeps them for variance (domain estimation).

1. **Weighted mean** with Taylor-linearised SE for stratified, with-replacement PSU sampling: the score for a mean is `u_i = w_i (y_i − ȳ) / Σw`; PSU totals within strata; variance `Σ_h n_h/(n_h−1) Σ_j (z_hj − z̄_h)²`. Must equal R's `svymean` on `svydesign(ids=~psu, strata=~strata, weights=~w, nest=TRUE)`.
2. **Domain (subpopulation) estimation** for `by=` groups and filters: keep the full design; observations outside the domain contribute zero to the score, so strata/PSU counts come from the whole design, not the subset. Must equal R's `svyby(..., subset(design, …))`. Since strata nest within country, a per-country estimate on the country subset and on the full design must agree — assert that in a test.
3. **Lonely PSUs**: implement R's `options(survey.lonely.psu = "adjust", survey.adjust.domain.lonely = TRUE)` — a stratum with one PSU (in the design, or in the domain) is centred at the grand mean of PSU totals instead of its own stratum mean, and contributes `(z_hj − z̄)²` with no `n_h/(n_h−1)` factor. Hand-compute a 3-stratum toy example in a unit test, and include Brazil and Israel in the parity set (§2.5). Document the policy in METHODS.md in plain language.
4. **Weighted proportions** for `scale_type ∈ {nominal, ordinal, binary}` and for value bins: one row per level, estimated as the mean of an indicator so the mean machinery is reused; levels with zero valid responses still appear with `n = 0`. Proportions in a group sum to 1 (property test). Also expose a *distribution* helper that returns the full weighted histogram of a 0–10 item with per-bin CIs (this is how "distributions" ship with uncertainty).
5. **Weighted quantiles** (`p` in (0,1)): smallest `x` with weighted CDF ≥ `p`, equivalent to R `svyquantile(..., qrule = "math")` in survey ≥ 4.1. Point estimate and `n` only; `se`/`ci_*` are null and `ci_method` is `"none"`. Note the limitation in METHODS.md and open a backlog issue for Woodruff CIs.
6. **Paired change** for the change rows of the weight table: on rows eligible for the spec and with both waves non-null, estimate the mean of `later − earlier` with Taylor SE (a mean of a derived variable — reuse the mean path), plus the weighted distribution of individual change (histogram with per-bin CIs via the proportion path) and `n` of the pairs. For three-point panels return the Y1→MY and MY→Y2 legs and Y1→Y2 under `w_l1m2`, with the MY→Y2 leg only for `midyear_type = 1` — enforced by the weight table, not by the caller.
7. **Transition matrix** for ordinal/nominal items: weighted joint distribution `P(earlier = i, later = j)` and row-conditional `P(later = j | earlier = i)` with SEs via the proportion path, unweighted `n` per cell, suppression applied per cell, rows sum to 1 (property test). Must match R `svymean(~interaction(from, to))` / `svytable`.
8. **Weighted correlations**: Pearson (weighted covariance over weighted variances — the denominator cancels) and Spearman (average-rank the unweighted values with ties, then weighted Pearson on the ranks; document that this is one of several defensible definitions). Return `r`, `n`, `sum_w`; no CI in Phase 2 (`ci_method = "none"`). Pearson must match `svyvar(~x + y)` → `cov / sqrt(vx · vy)`.
9. **Suppression** as a pure function: `suppress(n, threshold=50, flag_below=100) -> (suppressed, flagged)`. Suppressed rows keep `n`, `sum_w` and group keys and null out `estimate`, `se`, `ci_*`. Monotone in `n` (property test). Thresholds are parameters with these defaults; nothing else in the package hard-codes 50.
10. **Stubs, Phase-gated**: `pooled_population_weights(frame, populations) -> NotImplementedError("Not implemented: Phase 5")` (population-rescaled "all countries"), `adjusted_association(...) -> NotImplementedError("Not implemented: Phase 6")` (weighted OLS/logit with the fixed control set). Each carries a docstring with the intended signature and the proposal section.

`flourish_stats/io.py` (optional `duckdb` extra): `analysis_frame(con, variable, wave, *, oriented=False, columns=(...))` returning `responses_long` (or `responses_oriented`) for one `(variable, wave)` joined to `respondents` on `id`, and `derived_frame(con, column, wave)` for SFI-family outcomes. The verify script, the built-data tests and (in Phase 3) the API's DuckDB layer use these; the pure estimators never touch DuckDB.

### 2.4 Tests (`stats/tests/`) — target ≥ 90 % line coverage of `stats/src`

- **Unit tests** on tiny hand-computable frames for every estimator, including the lonely-PSU toy example, an all-suppressed group, an empty domain, a level with zero responses, a variable present at one wave only, and `validate_frame` rejections.
- **Property-based tests with Hypothesis** (add `hypothesis` to the root dev group; use a registered CI profile with fixed `max_examples` and `derandomize=True` so CI stays under 8 minutes and is reproducible). Invariants at minimum: weights all equal to 1 reproduce unweighted mean and, with one stratum and PSU = row, Taylor SE equals `s/√n`; multiplying every weight by a positive constant leaves `estimate`, `se` and proportions unchanged; proportions sum to 1 and transition-matrix rows sum to 1; `suppress` is monotone in `n`; domain estimation on a union of whole strata equals estimation on the subset; Kish `n_eff = (Σw)²/Σw² ≤ n` with equality iff weights are equal; paired change equals `mean(later) − mean(earlier)` under the same weight on the same rows; Pearson `r` is invariant to affine transforms of either variable and Spearman to monotone ones.
- **Built-data tests** marked `built` (new marker, auto-skipped when `data/parquet/respondents.parquet` is absent; add it to `stats/tests/conftest.py` following `pipeline/tests/conftest.py` and describe it in CLAUDE.md next to the `raw` marker). They reproduce the Wave 1 SFI table in `data/validation_report.md` through the engine (means within ±0.005, same ordering), the weight-availability counts in §1, and the R parity fixture (§2.5).
- Enforce coverage in CI: add `--cov=flourish_stats` to the pytest step and a following `uv run coverage report --include='stats/src/*' --fail-under=90` step.

### 2.5 R parity (`stats/verify/`)

Proposal §5.3 puts this in `pipeline/verify/`; put it next to the package it verifies and say so in ADR-0005. Three parts:

1. `extract.py` — writes a slim extract (`id, country_code, strata, psu, age_band, gender, the weights, the ~10 needed items at their waves, sfi`) to `data/intermediate/verify_extract.csv` (git-ignored: everything under `data/` is). R's only dependency is then `survey`; no `arrow` package needed.
2. `reference.R` — `options(survey.lonely.psu = "adjust", survey.adjust.domain.lonely = TRUE)`; `svydesign(ids = ~psu, strata = ~strata, weights = ~<w>, nest = TRUE)`; computes the 30 estimates below with `svymean`, `svyby` + `subset`, `svyquantile(qrule = "math")`, `svyvar`, and `svymean(~interaction(...))`; writes `stats/verify/reference.json` — **committed** — containing estimate, SE, n, the R and `survey` package versions, the option values, and the extract's sha256 (the reference is only valid against the data version in `data/manifest.json`; record that too). Require `survey >= 4.2` and fail loudly otherwise.
3. `test_parity.py` (marked `built`) — runs the engine on the same extract and compares every case to `reference.json` with tolerances recorded per statistic in the test file: point estimates |Δ| ≤ 1e-9, SEs relative Δ ≤ 1e-6, quantiles exact, correlations |Δ| ≤ 1e-9. If any case cannot meet these, do not loosen silently: explain the mechanism in ADR-0006 and set a per-case tolerance with that explanation as the comment.

The 30 cases must cover: Wave 1 means under `w_c1` for `HAPPY`, `LIFE_SAT` and `sfi` in Japan (self-representing), Brazil and Israel (lonely PSUs), Egypt and Kenya (few, large PSUs), and the United States; domain estimates by `age_band` within Brazil and by `gender` within Egypt; proportions for all levels of `ATTEND_SVCS` in India and of `BELIEVE_GOD` in Nigeria; Wave 2 means under `w_c2` (`MENTAL_HEALTH`, Hong Kong — 23.5 % retention); midyear means under `w_l1m` (`MONEY`, `GOOD_RELATION`) and the `FOOD_INSECURE` proportions in Kenya; Y1→Y2 paired change of `HAPPY` and `sfi` under `w_l2` in Hong Kong and the US; MY→Y2 change under `w_l1m2` in Kenya (all standalone) and one country that mixes both midyear modes (United Kingdom or Germany) to prove the `midyear_type = 1` restriction; a `WB_TODAY` median; a `HAPPY`×`LIFE_SAT` Pearson correlation in Poland; and one `ATTEND_SVCS` Y1→Y2 transition matrix (Philippines).

Add `make parity` (extract → `Rscript` → pytest of the parity test) to the Makefile and describe it in `data/README.md`. The reference JSON contains aggregates only — no rows, no ids.

### 2.6 Documentation

- `docs/METHODS.md` — plain language, for the Phase 4 Methods page: what a survey weight is and why every number carries one; the weight table from §2.2 with its rationales and the R2 and midyear-type notes; how the CI is computed (linearisation, strata/PSU, lonely PSUs, why SEs differ from a naive formula, normal-based 95 %); domain estimation; suppression and flagging; how change is estimated and why only longitudinal weights are defensible; what quantiles and correlations mean here and their current limitations; the "associations, not causes" statement (proposal §4.4); the R parity check and where its results live; the data citation and version.
- ADR-0005 and ADR-0006 as above (MADR, `docs/adr/template.md`).
- README: status line to "Phase 2 complete", repo layout row for `stats/`, phases table tick, and the `w_r2` quirk added to the quirks paragraph. `CLAUDE.md`: repo map row, `built` marker, the rule that weight/eligibility facts live only in `flourish_stats.weights`. `pipeline/notebooks/01_data_quirks.ipynb`: one cell showing the `w_r2` finding (aggregates only; outputs stripped by pre-commit).

## 3. How to work

- Branch from an up-to-date `main`; conventional commits (`feat(stats): …`, `test(stats): …`, `docs(adr): …`, `ci: …`, `build: …`); the Phase 2 issue and milestone already exist (`gh issue list --milestone "Phase 2 — Statistics engine"`); reference the issue in every PR body and use `.github/PULL_REQUEST_TEMPLATE.md`.
- Land the phase as **three PRs**, each green on `make lint typecheck test` and `uv run pre-commit run --all-files` before it is opened, each reviewable on its own:
  1. `claude/phase-2-package` — package skeleton and workspace/CI/Docker wiring, the weight table, `Design`, weighted mean/proportion/quantile with Taylor and Kish SEs, domain estimation, lonely-PSU policy, suppression, `io.py`, unit + property tests, ADR-0005.
  2. `claude/phase-2-panel` — paired change, three-point panel, transition matrices, correlations, distribution helper, Phase 5/6 stubs, their tests, the built-data SFI reproduction test.
  3. `claude/phase-2-parity-docs` — extract + `reference.R` + committed `reference.json` + parity test + `make parity`, METHODS.md, ADR-0006, README/CLAUDE.md/notebook/data-README updates, coverage gate.
- Never commit anything under `data/` except the three allowed files, and never commit CSV/Parquet/DuckDB anywhere (pre-commit enforces it; do not bypass hooks). The verify extract lives in `data/intermediate/`.
- Keep pyright strict clean on `stats/src` without blanket ignores; a single-diagnostic module-level disable with a comment (as `derive.py` does for polars) is acceptable.
- Anything only the repo owner can do goes into `docs/SETUP.md` as copy-pasteable commands; nothing in this phase should need it, but if R produces different results from a different `survey` version, record the version pin there.
- Do not "simplify" a discrepancy away. If the engine and R disagree, the R output is the reference until you can show, with a hand-computed example in a test, why R is wrong for this design.

## 4. Exit criteria (all must hold before the third PR is opened)

1. `flourish_stats` is a workspace member; `uv sync --all-packages`, `make lint`, `make typecheck`, `make test` and the Docker build are green in CI.
2. `stats/verify/reference.json` is committed with 30 cases and `make parity` passes locally with the recorded tolerances; the parity test is auto-skipped in CI (no data there) but its fixture is validated structurally in CI.
3. Coverage of `stats/src` ≥ 90 % and enforced in CI.
4. Every estimator returns the common record with `n`, `se_method`, `weight`, `suppressed` and `flagged`; suppression thresholds are parameters.
5. The wave→weight→eligibility table is the only place weight and eligibility rules live, exports to JSON, enforces the `midyear_type = 1` restriction, and documents the `w_r2` quirk.
6. `docs/METHODS.md`, ADR-0005, ADR-0006 exist; README, CLAUDE.md and the quirks notebook are updated; Phase 5/6 stubs raise `NotImplementedError("Not implemented: Phase N")`.
7. Measured timings for the mean-by-country path are recorded in ADR-0006 and no estimator loops over PSUs or strata in Python.

Finish by posting, in the third PR's description, a short table of the 30 parity cases with engine vs R estimate and SE, and a one-paragraph note on what Phase 3 should know (the `analysis_frame` contract, the weight-table JSON export, and the DuckDB-size follow-up from ADR-0003 that Phase 3 owns).
