# Flourish Atlas — Project Proposal

An interactive explorer for the Global Flourishing Study (GFS), built as a full-stack portfolio project.

| | |
|---|---|
| **Author** | Nathan |
| **Date** | September 9, 2026 |
| **Stack** | React + TypeScript front end, Python (FastAPI) API, DuckDB/Parquet data layer |
| **Timeline** | ~16 weeks part-time, in 9 phases |
| **Hosting** | Free tiers only (Cloudflare Pages + Google Cloud Run) |
| **Data** | GFS Waves 1–2 public release with midyear survey: global file (207,919 × 253) and US state-weighted file (38,312 × 257), plus the Wave 2 codebook |
| **Status** | Proposal — awaiting go/no-go |

---

## 1. Summary

The Global Flourishing Study is a five-year panel of roughly 200,000 adults in 22 countries and one territory, run by Harvard, Baylor, Gallup and the Center for Open Science. Waves 1 and 2 became fully open in April 2026. The data are clean, richly documented, and cover exactly the kind of questions people are curious about: how happy are people in Japan versus Indonesia, does religious attendance track with meaning, do young adults really report the lowest wellbeing, and who moved up or down between 2023 and 2024.

Today that data lives in a 138 MB CSV with integer codes and an 84-page PDF codebook. **Flourish Atlas** turns it into a public web application where anyone can pick an outcome, slice it by country and demographics, compare places, follow the same people across two annual waves and the midyear survey between them, and read the exact question wording behind every number, with survey weights and confidence intervals applied correctly and small cells suppressed.

For a portfolio, the project is deliberately shaped to show the full stack: a reproducible data pipeline with validation, a statistics engine with tests against a reference implementation, a typed API with caching and contract tests, a responsive React front end with shareable URL state, CI/CD, and a written case study. Each phase below ends in something deployable, so the project is never more than a week from a demo.

**Working name.** "Flourish Atlas" (the GFS defines flourishing as "living in a state in which all aspects of a person's life are going well"; an atlas is a book of maps you browse rather than read cover to cover). Easy to rename.

## 2. Goals and non-goals

**Product goals**

1. Let a curious non-expert answer "how does X vary by Y in Z" in under a minute without knowing the codebook.
2. Make the survey design visible: every chart shows the weight used, the unweighted n, and a confidence interval.
3. Make every view shareable by URL and exportable as CSV/PNG.
4. Surface the panel structure: the same respondent at Wave 1, the midyear survey, and Wave 2, in every country.

**Portfolio goals**

1. Demonstrate data engineering (ingestion, validation, reproducibility), backend (API design, caching, performance), front end (state management, charts, accessibility) and delivery (CI/CD, monitoring, documentation) in one coherent codebase.
2. Produce artifacts a hiring manager can evaluate in five minutes: a live URL, a README with architecture diagram, a methods page, and a short case-study write-up.

**Non-goals (v1)**

- No causal claims. Every association view carries an "associations, not causes" note and the methods page explains why.
- No raw microdata download. The app serves aggregates; the raw files stay on the server and out of the repository.
- No user accounts, saved dashboards, or comments.
- No ingestion of Wave 3 until it becomes public (scheduled April 2027); the pipeline is designed so adding it is a configuration change.

## 3. What the data actually is

This section records what profiling the two CSVs and the codebook turned up. It drives the pipeline design in Section 5 and the risks in Section 9.

### 3.1 Files

| File | Rows | Columns | Notes |
|---|---|---|---|
| `gfs_all_countries_wave2_with_midyear.csv` | 207,919 respondents | 253 | 23 countries/territories. 136 `_Y1` columns, 82 `_Y2` columns, 19 `_MY` midyear columns, 16 system/demographic columns without a wave suffix (including the two `RETENTION_WEIGHT_*` midyear weights). Supersedes the earlier 232-column release, which had identical IDs and annual columns but no midyear data. |
| `gfs_us-state-weight_wave2_with-midyear.csv` | 38,312 respondents | 257 | US only. Same `_Y1`/`_Y2`/`_MY` columns plus 11 state-level weight columns (`ANNUAL_STATE_WEIGHT_*`, `RETENTION_STATE_WEIGHT_*` and their `_ADJ_` variants). |
| `GFS_codebook_wave2.pdf` | 84 pages | — | Sections: main survey (pp. 3–36), midyear (37–41), system variables (42–46), demographics (47–50), country-specific demographics (51–84). ~169 variable definitions with question wording and value labels. |

Wave 1 fieldwork dates in the file run January–June 2023; the midyear survey runs November 2023–December 2024; Wave 2 runs February–June 2024. Countries are coded 1–25 (15 and 21 unused): Argentina, Australia, Brazil, Egypt, Germany, India, Indonesia, Israel, Japan, Kenya, Mexico, Nigeria, Philippines, Poland, South Africa, Spain, Tanzania, Türkiye, United Kingdom, United States, Sweden, Hong Kong, China. The US is the largest sample (38,312), Türkiye the smallest (1,473).

**The midyear survey** is a short between-waves instrument: 131,487 respondents (63%) have midyear data. It was administered two ways, recorded in `MIDYEAR_TYPE_MY`: as a separate survey for 54,358 respondents (type 1) and combined with the Wave 2 questionnaire for 77,129 (type 2). Its 16 substantive items are the "what matters to you" importance ratings (money, good relationships, meaning, health, religious life, happiness, being a good person; 0–10), plus social media time, food insecurity, connection to nature, experiencing beauty, arts engagement, diligence, focus, and whether people are happy with what they are achieving. Because these items exist nowhere else in the study, the midyear file is what makes questions like "does valuing money over relationships track with lower flourishing?" answerable across all 23 countries rather than only the US.

### 3.2 Coding conventions the pipeline must handle

- **Every value is an integer code**, including 0–10 scales. Labels live only in the codebook.
- **Missing values are blank strings, not NaN.** A respondent who wasn't in Wave 2 has `" "` in every `_Y2` column, and one without a midyear interview has `" "` in every `_MY` column. Pandas reads these columns as object dtype; the pipeline must strip and cast.
- **Sentinel codes**: `-98` "saw, skipped", `98` don't know, `99` refused for ordinary items; `-998`/`998`/`999` for `AGE`; `-9998` for country-specific variables (`INCOME`, `POLITICAL_ID`, `REGION1–3`), whose valid codes are prefixed by country (e.g. `2201` = a US party, `2205` = a US state).
- **Scales differ in direction.** `HAPPY` runs 0 = extremely unhappy → 10 = extremely happy, but `LONELY` runs 0 = always → 10 = never and `EXPENSES` 0 = worry all the time → 10 = never worry. Categorical items like `ATTEND_SVCS` run 1 = more than weekly → 5 = never. The variable catalog needs an explicit `direction` field so charts label "higher is better/worse" correctly.
- **Wave-specific columns.** 54 items were asked only at Wave 1 (childhood retrospectives, parents' religion, most demographics) and a few only at Wave 2. The catalog needs `waves_available` per variable.
- **Wave flags don't match the codebook literally.** `WAVE_Y2` is coded `2` when present (codebook says `1 = Year 2`) and `WAVE_MY` is coded `11` (codebook says `1 = Midyear`); the pipeline should treat non-blank as "present" rather than trusting the literal.
- **Midyear mode matters.** `MIDYEAR_TYPE_MY` distinguishes a standalone midyear interview (1) from midyear items appended to the Wave 2 interview (2). For the combined group the midyear and Wave 2 answers were given on the same day, so "midyear → Wave 2 change" is only meaningful for type 1. The catalog records this and the Change view enforces it.

### 3.3 Weights and design variables

| Column | Use |
|---|---|
| `ANNUAL_WEIGHT_C1` | Wave 1 cross-sectional estimates (all 207,919). Mean ≈ 1.0 within each country, range 0.18–49.4. |
| `ANNUAL_WEIGHT_C2` | Wave 2 cross-sectional estimates (retained respondents). |
| `ANNUAL_WEIGHT_L2` | Longitudinal Wave 1 → Wave 2 change (retained respondents, adjusted for attrition). |
| `ANNUAL_WEIGHT_R2` | "Rectangular" panel weight for analyses requiring both waves complete. |
| `RETENTION_WEIGHT_L_1M` | Midyear cross-sectional estimates (the 131,487 with midyear data; mean ≈ 1.0 within country). |
| `RETENTION_WEIGHT_L_1M2` | Longitudinal Wave 1 → midyear → Wave 2 analyses (respondents with all three). |
| `ANNUAL_STATE_WEIGHT_*`, `RETENTION_STATE_WEIGHT_*`, `*_ADJ_*` | US file only: the same weights calibrated to state populations, plus adjusted variants. |
| `STRATA`, `PSU` | 411 strata and 136,781 primary sampling units for design-based standard errors. |

Because weights are normalized to mean 1 **within** each country, pooling countries into a "global" figure requires rescaling by adult population; otherwise Türkiye and the US count equally. The app will show per-country estimates by default and offer a population-rescaled "all countries" figure only with an explicit label.

### 3.4 Retention

62% of Wave 1 respondents (128,868) have Wave 2 data, but it varies enormously by country: China 90%, United States 84%, Sweden 77%, Israel/Japan/Kenya 68%, Australia/UK 67%, Egypt 64%, Poland/Tanzania 62%, Germany 58%, Philippines 51%, India 50%, Nigeria/Spain 46%, Argentina 44%, Mexico 39%, Indonesia 38%, South Africa 37%, Türkiye 34%, Brazil 32%, Hong Kong 23%. Midyear coverage is similar in aggregate (63%, 131,487) but follows a different pattern by country, because some countries ran a standalone midyear interview and others folded it into Wave 2: Kenya 80%, Egypt/Nigeria/Tanzania 72%, India 64%, Philippines 65%, but Germany 44%, Poland 42%, Spain 35%, Brazil 31%. Any Wave 2, midyear, or change view must display coverage alongside the estimate, and the longitudinal weights (`L2`, `L_1M2`) are the only defensible basis for change figures.

### 3.5 Variable families (≈150 substantive items)

| Family | Examples | Waves |
|---|---|---|
| Secure Flourishing Index (12 items, 6 domains) | `HAPPY`, `LIFE_SAT` · `PHYSICAL_HLTH`, `MENTAL_HEALTH` · `WORTHWHILE`, `LIFE_PURPOSE` · `PROMOTE_GOOD`, `GIVE_UP` · `CONTENT`, `SAT_RELATNSHP` · `EXPENSES`, `WORRY_SAFETY` | Y1, Y2 |
| Wellbeing extras | `WB_TODAY` / `WB_FIVEYRS` (Cantril ladder), `PEACE`, `LIFE_BALANCE`, `HOPE_FUTURE`, `EXPECT_GOOD`, `GRATEFUL`, `LONELY`, `SUFFERING`, `FREEDOM` | Y1, Y2 |
| Mental health screeners | PHQ-2: `DEPRESSED`, `INTEREST`; GAD-2: `FEEL_ANXIOUS`, `CONTROL_WORRY` | Y1, Y2 |
| Physical health & behaviour | `BODILY_PAIN`, `HEALTH_PROB`, `DAYS_EXERCISE`, `CIGARETTES`, `DRINKS` | Y1, Y2 |
| Social & civic | `CLOSE_TO`, `PEOPLE_HELP`, `SHOW_LOVE`, `BELONGING`, `TRUST_PEOPLE`, `DISCRIMINATED`, `VOLUNTEERED`, `DONATED`, `HELP_STRANGER`, `GROUP_NOT_REL`, `SAT_LIVE` | Y1, Y2 |
| Character & personality | `FORGIVE`, `PROMOTE_GOOD`, `TRAITS1–10` (TIPI Big Five) | Y1 (traits), Y1/Y2 |
| Religion & spirituality (~35) | `ATTEND_SVCS`, `PRAY_MEDITATE`, `REL_IMPORTANT`, `BELIEVE_GOD`, `REL1–9`, `TEACHINGS_1–15`, `CNTRY_REL_*`, `LOVED_BY_GOD`, `GOD_PUNISH` | mixed |
| Politics & government | `APPROVE_GOVT`, `SAY_IN_GOVT`, `OBEY_LAW`, `INCOME_DIFF`, `POLITICAL_ID` (country-specific) | Y1, Y2 |
| Childhood (retrospective) | `ABUSED`, `OUTSIDER`, `MOTHER_RELATN`, `FATHER_RELATN`, `MOTHER_LOVED`, `FATHER_LOVED`, `PARENTS_12YRS`, `INCOME_12YRS`, `HEALTH_GROWUP`, `SVCS_12YRS` | Y1 only |
| Demographics | `AGE`, `GENDER`, `EDUCATION_3`, `EMPLOYMENT`, `MARITAL_STATUS`, `INCOME` (country-specific bands), `INCOME_FEELINGS`, `URBAN_RURAL`, `NUM_CHILDREN`, `NUM_HOUSEHOLD`, `OWN_RENT_HOME`, `BORN_COUNTRY`, `REGION1–3` | mostly Y1 |
| Midyear (all countries) | Importance of `MONEY`, `GOOD_RELATION`, `MEANINGFUL`, `HEALTHY`, `REL_LIFE`, `HAPPY_IMPORT`, `GOOD_PERSON` (0–10); `TIME_MEDIA` (5 bands), `FOOD_INSECURE` (often/sometimes/never), `NATURE`, `DILIGENT`, `MIND_FOCUSED` (0–10), `BEAUTY`, `ACHIEVING` (yes/no), `ENGAGE_ARTS` | MY only |

### 3.6 Sanity check: the pipeline approach reproduces published results

A 60-line prototype (blank → NaN, sentinel codes → NaN, mean of the 12 SFI items, weighted by `ANNUAL_WEIGHT_C1`) reproduces the published country ordering: Indonesia 8.10, Israel 7.88, Philippines 7.70, Mexico 7.64, Poland 7.56 … United Kingdom 6.79, Türkiye 6.31, Japan 5.89; all-country mean 7.07. The age curve is flat from 18–49 (≈7.0) and rises to 7.66 at 80+, matching the Nature Mental Health study profile. This confirms the coding conventions above and gives Phase 1 a concrete acceptance test.

### 3.7 Data governance

- **Citation.** Every page footer and the README cite the dataset DOI `10.17605/OSF.IO/3JTZ8` and the study profile paper, as the data-use terms require.
- **Redistribution.** Raw CSVs are excluded from git (`.gitignore` + a checksum manifest). The build fetches them from OSF or a private bucket. The deployed API only ever returns aggregates.
- **Small cells.** The data are already de-identified, but cross-tabs (state × religion × age band) can produce tiny cells that are statistically meaningless. Cells with unweighted n < 50 are suppressed by default (configurable), and n is always displayed.
- **Sensitive variables.** None of the IRB-gated fields (coarse geolocation, interviewer demographics, interview language) are in these public files, so nothing special is required, but the schema reserves a `restricted` flag in case Wave 3 access is added.
- **Terms.** The public Waves 1–2 data carry no stated use restrictions; the data-use agreement is written for academic use, and COS invites non-academic descriptive use via `globalflourishing@cos.io`. A one-line courtesy note before launch is cheap insurance.

## 4. Product definition

### 4.1 Audiences

1. **Curious public / students / journalists** who want a quick, trustworthy answer and a chart they can share.
2. **Researchers** checking a number before opening R, or exploring which variables exist.
3. **Hiring managers and engineers** evaluating the codebase, who will read the README, click around for two minutes, and open the network tab.

### 4.2 Core user stories

- As a visitor, I can pick any outcome and see it by country as a ranked bar chart or map, with confidence intervals and sample sizes, in one click.
- As a visitor, I can break an outcome down by age band, gender, education, employment, marital status, income feelings, urban/rural, or religious attendance, faceted by country.
- As a visitor, I can compare two to five countries (or two segments) across the six flourishing domains.
- As a visitor, I can see how the same people changed from 2023 to 2024: average shift, distribution of individual change, and transitions between categories.
- As a visitor, I can explore the midyear "what matters to you" items in every country, and see how the things people say they value relate to how they are actually doing.
- As a US visitor, I can explore any of this by state.
- As a researcher, I can search the codebook by keyword, read the exact question wording and value labels, see which waves asked it and its missingness, and jump straight to a chart.
- As anyone, I can copy a URL that reproduces exactly what I'm looking at, and download the underlying aggregate as CSV or the chart as PNG.

### 4.3 Views

| View | What it shows | Phase |
|---|---|---|
| **Atlas** | Choose a variable; see a ranked bar chart and a world map by country, with CI, n, weight, and question wording. Toggle Wave 1 / Midyear / Wave 2. | 4 |
| **Breakdowns** | Outcome × demographic, small multiples by country; sortable; suppression indicators. | 4 |
| **Codebook** | Searchable variable catalog with families, wording, labels, waves, missingness; "chart this" link. | 4 |
| **Compare** | 2–5 countries or segments across the six SFI domains (dumbbell / radar) and any chosen items. | 5 |
| **Change** | Wave 1 → Wave 2 for the same respondents using `L2` weights: mean change with CI, histogram of individual change, transition matrix for categorical items, retention shown prominently. | 5 |
| **What Matters** | The midyear importance items across all countries: what people rank highest (money vs relationships vs meaning), how that varies by age and country, and how stated priorities relate to Wave 2 flourishing (e.g. valuing money over relationships × life satisfaction), using `L_1M` / `L_1M2` weights. Also social media time × mental health and food insecurity × financial-domain scores. | 5 |
| **US States** | State choropleth with state weights, state-vs-national comparisons for annual and midyear items. | 5 |
| **Correlates** | "What travels with X?": ranked weighted associations between an outcome and every other item, per country heatmap; adjusted associations with controls. | 6 |
| **Methods** | Plain-language explanation of weights, CIs, suppression, and the difference between association and cause; links to the study papers. | 4, updated 6 |

Stretch backlog: plain-English question → structured query (LLM with a constrained grammar, server-side validated); "Where would I sit?" personal SFI calculator that compares the visitor's answers to their country's distribution; embeddable chart widget; Wave 3 ingestion in 2027.

### 4.4 Design principles

- Numbers never appear without their uncertainty and their n.
- Question wording is one click away from every chart.
- The URL is the state. Back button, refresh, and sharing all work.
- Fast on a phone on a bad connection: the common views load from precomputed static files; only custom cuts hit the API.
- Colour encodes meaning consistently: the six domains have fixed hues across every view; "higher is better" is always the same direction.

## 5. Architecture

```
 raw CSVs (global with midyear, US state-weighted) + codebook PDF
        │
        ▼
 ┌─────────────────────┐   pandera checks,   ┌──────────────────────┐
 │ pipeline/ (Python)   │──── checksums ────▶│ data/ (Parquet +     │
 │ parse · clean · SFI  │                    │ DuckDB file + JSON   │
 │ · aggregates         │                    │ catalog + static     │
 └─────────────────────┘                    │ aggregates)          │
                                             └──────┬───────┬──────┘
                                                    │       │
                                   baked into image │       │ uploaded to CDN
                                                    ▼       ▼
                                  ┌──────────────────┐   ┌──────────────────────┐
                                  │ services/api      │   │ apps/web (React/TS)  │
                                  │ FastAPI + DuckDB  │◀──│ static-first: reads  │
                                  │ Cloud Run (free)  │   │ precomputed JSON;    │
                                  │ /aggregate etc.   │   │ calls API for custom │
                                  └──────────────────┘   │ cuts · Cloudflare    │
                                                         │ Pages (free)         │
                                                         └──────────────────────┘
```

### 5.1 Repository layout (monorepo)

```
flourish-atlas/
├── apps/web/            React 18 + TypeScript + Vite
├── services/api/        FastAPI, DuckDB, stats engine
├── pipeline/            ingestion, codebook parser, validation, aggregate export
├── data/                Parquet, DuckDB file, catalog JSON (git-ignored except manifests)
├── docs/                ADRs, METHODS.md, DATA.md, ARCHITECTURE.md
├── infra/               Dockerfile, Cloud Run config, GitHub Actions
└── Makefile             make data · make api · make web · make test · make deploy
```

### 5.2 Data pipeline (Python 3.12, polars/pandas + pyarrow, DuckDB, pandera)

1. **Codebook parser.** Extract variable name, label, question wording, value labels, and section from the PDF (pypdf/pdfplumber); write `catalog.json`. Hand-curate a small overrides file for scale direction, family, and display names. The parser is tested against a fixture of the PDF text so future codebooks are cheap to add.
2. **Ingest.** Read CSVs with an explicit dtype map; strip blanks → null; map sentinel codes → null but keep a separate `nonresponse_reason` column (skipped / DK / refused) so the Codebook view can report them.
3. **Reshape.** Produce `respondents` (one row per ID: country, demographics, all weights, strata, PSU, `retained_y2`, `has_midyear`, `midyear_type`) and `responses_long` (id, wave ∈ {Y1, MY, Y2}, variable, value). The US file contributes only its state weights and region codes, joined on `ID`; its annual and midyear columns duplicate the global file and are checked for equality rather than loaded twice. Long format makes "any variable × any breakdown" a single query pattern.
4. **Derive.** SFI (12-item mean and six domain means), age bands, harmonised income quintiles within country, PHQ-2/GAD-2 screen-positive flags, reverse-coded "higher is better" versions, and a "priorities" profile from the midyear importance items (rank of money vs relationships vs meaning within respondent).
5. **Validate.** pandera schemas plus acceptance tests: row counts (207,919 / 38,312), code ranges, retention 62% ± 0.5 and midyear coverage 63% ± 0.5, the US file's shared columns equal to the global file's, and the published SFI country ordering from §3.6.
6. **Aggregate.** Precompute the top ~2,500 view combinations (every variable × country × wave × 8 breakdowns) as compact JSON/Parquet for the static tier, with CIs and n. Build the DuckDB file for the API tier.
7. **Manifest.** SHA-256 of inputs and outputs, pipeline version, and timestamp written to `data/manifest.json`; the API and web app display the data version.

### 5.3 Statistics engine (`services/api/stats/`)

- Weighted means and proportions; weighted quantiles for distributions.
- Standard errors by Taylor-series linearisation using `STRATA`/`PSU` (the same approach as R's `survey` package and Stata's `svy`). Fallback: weighted SE with Kish effective sample size when design variables are unavailable (US state file variants).
- Change estimates: paired difference using `L2` weights (Wave 1 → Wave 2) or `L_1M2` (three-point panel); transition matrices for ordinal/categorical items. Midyear cross-sections use `L_1M`; midyear-to-Wave-2 comparisons are restricted to standalone midyear interviews (`MIDYEAR_TYPE_MY = 1`).
- Associations: weighted Spearman/Pearson; adjusted associations via weighted OLS/logistic regression with a fixed control set (age, gender, education, employment, marital status, country fixed effects).
- Suppression policy as a pure function (`n_unweighted < 50` → suppressed; `50–99` → flagged).
- Verified against R `survey` on a fixed set of 30 estimates (script in `pipeline/verify/`), with tolerances recorded in tests.

### 5.4 API (FastAPI on Cloud Run)

| Endpoint | Purpose |
|---|---|
| `GET /v1/meta` | data version, countries, waves, weight definitions |
| `GET /v1/variables?q=&family=` | catalog search |
| `GET /v1/variables/{name}` | wording, labels, waves, missingness by country |
| `GET /v1/aggregate` | `outcome`, `stat` (mean/prop/quantile), `by` (country, age_band, …), `filters`, `wave` (Y1/MY/Y2), `weight` → estimates, CI, n, suppression flags |
| `GET /v1/change` | `outcome`, `from`, `to`, `by`, `filters` → paired change, transition matrix (weight chosen automatically from the wave pair) |
| `GET /v1/correlates` | `outcome`, `country`, `adjusted` → ranked associations |
| `GET /v1/states` | US state-level aggregates with state weights |
| `GET /v1/export.csv` | same parameters as `/aggregate`, CSV out |

Implementation notes: DuckDB in-process, read-only, file baked into the container image (~50–80 MB) so there is no database to pay for; pydantic v2 request/response models generate the OpenAPI spec, from which the front end's TypeScript client is generated (`openapi-typescript`); responses carry `ETag` and `Cache-Control` so Cloudflare caches them at the edge; an in-process LRU for hot queries; per-IP rate limiting; structured JSON logs; `/health`. Cloud Run scales to zero (free tier: 2M requests, 180k vCPU-seconds per month); a cold start is ~2–4 s, which the static-first front end hides for common views.

### 5.5 Front end (React 18, TypeScript, Vite)

- **State:** TanStack Router with typed search params so every view is URL-addressable; TanStack Query for data with the static tier as the first source and the API as fallback.
- **Charts:** Observable Plot for standard marks (bars, dots with CI, small multiples, heatmaps) and D3-geo for the world/US maps with Natural Earth and US Census TopoJSON; PNG export via canvas.
- **UI:** a small design-token system (six fixed domain hues, semantic colours for suppression/flags), CSS modules or Tailwind, Radix primitives for accessible selects/dialogs, dark mode.
- **Quality:** Vitest + Testing Library for components and hooks; Playwright for the six critical journeys; Storybook for chart components; Lighthouse CI budget (performance ≥ 90, a11y ≥ 95); bundle budget 250 kB gzipped for the initial route.
- **Hosting:** Cloudflare Pages (unlimited free bandwidth) with the precomputed aggregates deployed alongside as static assets.

### 5.6 Delivery and operations

- GitHub Actions: lint (ruff, eslint), types (pyright, tsc), unit tests, contract tests against the OpenAPI spec, Playwright smoke, Docker build, deploy on tag. Data pipeline runs on demand (`workflow_dispatch`) with the raw files fetched from a private bucket.
- Sentry free tier for both API and web; UptimeRobot free tier for `/health`; Cloudflare analytics.
- ADRs in `docs/adr/` for each significant decision (DuckDB vs Postgres, static-first tier, Plot vs Vega-Lite, Cloud Run vs Fly/Render).

## 6. Data model

```
variables            respondents                     responses_long
─────────────        ───────────────────────         ──────────────────────
name (pk)            id (pk)                         id (fk)
label                country_code, country_name      wave  ∈ {Y1, Y2, MY}
wording              gender, age, age_band           variable (fk)
family               education_3, employment         value        (int, null if missing)
scale_type           marital_status, urban_rural     nonresponse  (skipped|dk|refused|null)
direction            income_band, income_quintile
min, max             region1, region2, region3
waves_available      w_c1, w_c2, w_l2, w_r2, w_l1m, w_l1m2
is_country_specific  w_state_*  (US only)
restricted           strata, psu
                     retained_y2, has_midyear, midyear_type
value_labels         derived
─────────────        ───────────────────────
variable (fk)        id, wave, sfi, sfi_happiness, sfi_health, sfi_meaning,
code                 sfi_character, sfi_relationships, sfi_financial,
label                phq2_positive, gad2_positive
country_code (nullable, for country-specific codes)

aggregates_static    (precomputed: variable, wave, country, breakdown, level, stat, estimate, ci_lo, ci_hi, n, suppressed)
```

DuckDB holds all of it in one file; Parquet copies exist for notebooks and for the static export. The long table is ~35M rows (207,919 respondents × 136 Wave 1 + 82 Wave 2 + 16 midyear items, minus blanks) and queries in tens of milliseconds with DuckDB's columnar engine, which is the reason to prefer it over Postgres here: no server, no cost, no ops.

## 7. Phases

Sixteen weeks part-time (roughly 8–10 hours per week). Each phase ends in something running, and each has explicit exit criteria so scope creep is visible. Numbers are a sequence, not decoration: Phase 3 cannot start before Phase 2's estimators exist.

| Phase | Weeks | Deliverable | Exit criterion |
|---|---|---|---|
| 0 Foundations | 1 | Monorepo, tooling, CI skeleton, ADR-0001 | Hello-world API and web app deployed from CI |
| 1 Data pipeline | 2–3 | `make data` builds catalog, Parquet, DuckDB | Validation suite passes; reproduces published SFI ranking |
| 2 Statistics engine | 4–5 | Weighted estimators with design-based CIs | 30 estimates match R `survey` within tolerance |
| 3 API | 5–7 | FastAPI on Cloud Run; static aggregate export | Contract tests pass; p95 < 300 ms on hot queries |
| 4 Front-end MVP | 7–10 | Atlas, Breakdowns, Codebook, Methods; URL state | Public MVP; Lighthouse ≥ 90 / a11y ≥ 95 |
| 5 Panel, midyear & US | 10–12 | Change, Compare, What Matters, US States views | All Y1/MY/Y2 data reachable through the UI |
| 6 Correlates | 12–14 | Correlates view, adjusted models, model cards | Methods page updated; caveats shown in-product |
| 7 Hardening | 14–15 | E2E, load test, monitoring, docs | Checklists in §8 complete |
| 8 Launch & packaging | 16 | v1.0 tag, case study, demo video, README | Published and linked from portfolio/résumé |

### Phase 0 — Foundations (week 1)

Set up the monorepo with `uv` (Python) and `pnpm` (web), pre-commit hooks, editorconfig, and a Makefile. Scaffold FastAPI with `/health` and a Vite React app with routing. Write GitHub Actions for lint/type/test on both sides and a deploy job to Cloud Run and Cloudflare Pages. Create the project board with this proposal's phases as milestones. Write ADR-0001 (stack and hosting) and ADR-0002 (DuckDB over Postgres). Add `CITATION.cff` and the data attribution. **Exit:** a green pipeline that deploys both apps from a tag.

### Phase 1 — Data pipeline and codebook (weeks 2–3)

Build the codebook parser and its fixture tests; write the overrides file (family, direction, display name) for all ~150 substantive variables, including the 16 midyear items. Implement ingest → clean → reshape → derive per §5.2 with an explicit dtype map and sentinel handling, loading the global-with-midyear file as the primary source and joining the US file's state weights on `ID`. Write pandera schemas and the acceptance tests from §3.6. Produce `manifest.json`. Add a short exploratory notebook that documents surprises (blank strings, `WAVE_Y2 = 2` and `WAVE_MY = 11`, the two midyear administration modes, income band structure) so the README's "data quirks" section is honest. **Exit:** `make data` is reproducible from raw files in under five minutes on a laptop, and the validation report is committed.

### Phase 2 — Statistics engine (weeks 4–5)

Implement weighted mean/proportion/quantile, Taylor-linearised SE with strata/PSU, Kish fallback, paired change with `L2` and `L_1M2`, transition matrices, weighted correlations, and the suppression policy as pure functions over Arrow tables. Encode the wave-to-weight mapping (Y1 → `C1`, MY → `L_1M`, Y2 → `C2`, Y1→Y2 → `L2`, Y1→MY→Y2 → `L_1M2`) as a single table that both the engine and the API validate against. Write property-based tests (Hypothesis) for invariants (weights of 1 reproduce unweighted results; CI widens as n shrinks; suppression is monotone). Cross-check 30 estimates against R `survey` via a one-off script and record tolerances. Document each estimator in `docs/METHODS.md` in plain language. **Exit:** parity within tolerance; coverage ≥ 90% on the stats module.

### Phase 3 — API (weeks 5–7)

Design the query model (outcome, stat, by, filters, wave, weight) as pydantic models with validation that rejects nonsense (a Y1-only variable at Y2; a weight that doesn't apply). Implement the endpoints in §5.4 over DuckDB; add ETag/Cache-Control, LRU, rate limiting, structured logs, Sentry. Containerise with the DuckDB file baked in; deploy to Cloud Run. Generate the TypeScript client from OpenAPI. Build the static aggregate exporter and publish its output to the web app's assets. Load-test with k6 to establish the p95 baseline and tune DuckDB threads/memory for the 512 MB Cloud Run instance. **Exit:** contract tests pass in CI; p95 < 300 ms warm on hot queries; cold start measured and documented.

### Phase 4 — Front-end MVP (weeks 7–10)

Define design tokens and the chart component library (ranked bar with CI, dot plot, small multiples, choropleth). Build Atlas, Breakdowns, Codebook, and Methods; wire typed URL state so every view is shareable; add CSV/PNG export; implement suppression and flag rendering; add loading, empty, and error states; dark mode; keyboard navigation and screen-reader labels for charts. Run Lighthouse CI and fix. **Exit:** public MVP at the production URL; six Playwright journeys green; a friend can answer "which country has the highest mental health rating among 18–24-year-olds?" without help.

### Phase 5 — Panel, midyear and US views (weeks 10–12)

Implement Change (paired shift with CI, histogram of individual change, transition matrix, retention banner; wave pairs Y1→Y2 and, for standalone-midyear respondents, Y1→MY→Y2), Compare (2–5 countries or segments across domains), What Matters (midyear importance rankings by country and age; priorities × Wave 2 flourishing; social media time × mental health; food insecurity × financial domain), and US States (state choropleth using state weights for annual and midyear items). Add the population-rescaled "all countries" option with its warning label. **Exit:** every Y1, MY, and Y2 variable can be reached through at least one view; coverage is displayed wherever Wave 2 or midyear data appear.

### Phase 6 — Correlates and modelling (weeks 12–14)

Add weighted correlations and adjusted associations (weighted OLS/logit with the fixed control set and country fixed effects) to the engine and API; build the Correlates view with a per-country heatmap and a ranked list; write model cards describing specification, controls, and limitations; place "associations, not causes" copy in the UI and expand the Methods page. **Exit:** view live; methods reviewed by at least one person with a statistics background.

### Phase 7 — Hardening (weeks 14–15)

Complete the E2E suite, run the accessibility audit (WCAG 2.1 AA), set performance budgets in CI, add security headers and CORS policy, set up alerts, write `ARCHITECTURE.md`, `DATA.md`, `METHODS.md`, and a runbook (how to rebuild data, how to roll back). Do a dependency and licence audit. **Exit:** the checklists in §8 are complete.

### Phase 8 — Launch and packaging (week 16)

Tag v1.0. Record a 90-second demo, write the case study (problem, architecture, three hard decisions, what you'd do differently), add résumé bullets with measurable outcomes (rows processed, p95 latency, Lighthouse scores, test counts), and post it. Send the courtesy note to COS. **Exit:** live URL, repo, and write-up linked from the portfolio.

### Backlog (post-v1)

Wave 3 ingestion (April 2027); plain-English query with a constrained grammar; personal SFI calculator; embeddable widgets; i18n for the study's languages; a Postgres/Supabase variant to demonstrate a managed-database path.

## 8. Quality, testing, and launch checklists

**Testing pyramid**

- Pipeline: pandera schemas, acceptance tests on known aggregates, parser fixture tests.
- Stats: unit and property-based tests; R parity script with recorded tolerances.
- API: pydantic validation tests, contract tests against OpenAPI, golden-file tests for representative queries, k6 load profile.
- Web: component tests for every chart and control, hook tests for URL state, Playwright journeys (Atlas → share URL → reload; Codebook → chart; Change with a low-retention country; What Matters with a combined-midyear country; suppressed cell; CSV export; dark mode).

**Launch checklist**

- Data version and DOI visible in footer; README explains provenance and quirks.
- Every chart shows weight, n, CI; suppression is rendered, not silently dropped.
- Lighthouse performance ≥ 90, accessibility ≥ 95 on Atlas and Codebook; bundle within budget.
- p95 warm latency < 300 ms; cold-start path documented; static tier serves Atlas with the API down.
- Sentry, uptime monitor, and rate limits active; security headers pass Mozilla Observatory B+.
- Licence file, third-party notices, and citation file present.

## 9. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Free-tier cold starts make the app feel slow | Poor first impression | Static-first tier for all default views; warm-up ping during demo windows; show a skeleton, never a spinner |
| Misusing weights (pooling countries, using C1 for change, treating combined-midyear answers as a separate time point) produces wrong numbers | Credibility | Wave-to-weight mapping is one table validated by engine and API; midyear type enforced in the Change view; methods page; R parity tests |
| Small-cell noise in deep cross-tabs | Misleading charts | Suppression policy with visible flags; n always shown |
| Codebook parsing errors (PDF text extraction is lossy) | Wrong labels | Fixture tests; manual review of all 150 substantive variables; overrides file |
| Scope creep across eight views | Never launching | Phase exit criteria; MVP at Phase 4 is a complete product; backlog is explicit |
| Data-use terms interpreted differently | Takedown request | Aggregates only; DOI citation; courtesy note to COS before launch |
| DuckDB file grows beyond Cloud Run's memory | Crashes | Column pruning, ZSTD Parquet, memory limit set; fallback to precomputed aggregates for the heaviest queries |
| Wave 3 schema changes | Pipeline breaks | Catalog-driven pipeline; per-wave overrides; version pinned in manifest |

## 10. Success metrics

- **Product:** a first-time visitor can answer a defined question in under 60 seconds in a hallway test (5 people); ≥ 95% of chart renders under 500 ms from the static tier.
- **Engineering:** ≥ 85% line coverage on pipeline and stats; zero high-severity findings in the dependency audit; CI under 8 minutes.
- **Portfolio:** live URL, README with architecture diagram, methods page, case study, and a demo video; three résumé bullets with numbers.

## 11. What each phase demonstrates

| Skill area | Evidence |
|---|---|
| Data engineering | Reproducible pipeline, schema validation, manifest/checksums, codebook parser |
| Applied statistics | Survey-weighted estimators with design-based CIs verified against R |
| Backend | Typed API, OpenAPI-generated client, caching/ETags, rate limiting, containerised deploy |
| Front end | Typed URL state, accessible chart components, maps, dark mode, performance budgets |
| DevOps | GitHub Actions CI/CD, Cloud Run + Cloudflare Pages, monitoring, runbook |
| Communication | ADRs, methods page, case study, demo video |

## 12. Immediate next steps

1. Approve the working name, stack, and phase plan (or edit them).
2. Create the GitHub repository and project board with the nine milestones.
3. Start Phase 0; the first commit is the Makefile, the ADRs, and the CI skeleton.
4. In parallel, request the OSF Wave 1 file to confirm the schema matches the Wave 2 release's `_Y1` columns (it should; this proposal assumes the Wave 2 with-midyear file's `_Y1` columns are authoritative).
---

**Data citation.** Global Flourishing Study, Waves 1–2 (2023–2024). Center for Open Science / Gallup / Harvard Human Flourishing Program / Baylor Institute for Global Human Flourishing. https://doi.org/10.17605/OSF.IO/3JTZ8. Study profile: VanderWeele et al., *Nature Mental Health* (2025).
