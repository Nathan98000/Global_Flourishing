# data/

Build outputs of the pipeline. Everything here except this README,
`manifest.json` and `validation_report.md` is git-ignored (data-use terms,
docs/PROPOSAL.md §3.7).

## Raw inputs (never committed)

Fetch from OSF (<https://doi.org/10.17605/OSF.IO/3JTZ8>) or the private
bucket, place in `data/raw/`, and run `make data`:

- `gfs_all_countries_wave2_with_midyear.csv` — 207,919 × 253, ~138 MB
- `gfs_us-state-weight_wave2_with-midyear.csv` — 38,312 × 257, ~33 MB
- `GFS_codebook_wave2.pdf` — 84 pages

## Outputs (`make data`, ~10 s on a laptop)

| Path | What it is | Size |
|---|---|---|
| `catalog.json` (+ `catalog.schema.json`) | Variable catalog: 182 variables, 3,298 value labels, countries, codebook aliases | 0.8 MB |
| `catalog/*.parquet` | The catalog's variables/value_labels as Parquet | 0.1 MB |
| `catalog_coverage.md` | Column ↔ codebook coverage report (must be clean) | — |
| `parquet/respondents.parquet` | One row per respondent: demographics, weights, design, US state columns | 9 MB |
| `parquet/responses_long.parquet` | (id, wave, variable, value, nonresponse) — 33,295,632 rows | 51 MB |
| `parquet/derived.parquet` | SFI + domains, PHQ-2/GAD-2, midyear priorities per (id, wave) | 3 MB |
| `parquet/coverage.parquet` | Missingness by variable × wave × country | 0.1 MB |
| `parquet/{variables,value_labels,countries}.parquet` | Catalog tables alongside the data | 0.1 MB |
| `flourish.duckdb` | All tables in one queryable file + the `responses_oriented` view | 210 MB |
| `validation_report.md` | 62 checks incl. the published SFI ranking — **committed** | — |
| `manifest.json` | data_version, sha256/rows for every input and output — **committed** | — |
| `intermediate/` | Typed wide frames, ingest report, stage timings | 60 MB |

Regenerate everything with `make data`; re-run only checks + manifest with
`make data-validate`.

## R parity (`make parity`)

`make parity` verifies the statistics engine against R's `survey` package:
it writes a slim extract to `intermediate/verify_extract.csv` (design
columns, weights, flags, and the ~10 items the 30 parity cases need — see
`stats/verify/cases.csv`), has `Rscript stats/verify/reference.R` compute
the reference estimates (base R + the `survey` package ≥ 4.2, nothing
else), and runs `stats/verify/test_parity.py` comparing the engine to the
committed `stats/verify/reference.json` (aggregates only — estimates, SEs
and counts, no rows or ids). The reference records the extract's sha256
and the `data_version` it was computed from, so the parity test refuses to
compare against a different data build. Byte-reproducibility: every Parquet/JSON output is
byte-identical across runs from the same inputs; `manifest.json` and
`validation_report.md` carry run metadata (timestamp, timings), and
`flourish.duckdb` is rebuilt each run (DuckDB's format is not
byte-deterministic) and verified by content.
