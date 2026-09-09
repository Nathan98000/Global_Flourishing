# data/

Build outputs of the pipeline (Parquet, DuckDB file, `catalog.json`, static
aggregates) plus `manifest.json` with SHA-256 checksums of inputs and outputs.

Everything here except this README and `manifest.json` is git-ignored.

Raw inputs are **never** committed (data-use terms, docs/PROPOSAL.md §3.7):

- `gfs_all_countries_wave2_with_midyear.csv` (207,919 × 253)
- `gfs_us-state-weight_wave2_with-midyear.csv` (38,312 × 257)
- `GFS_codebook_wave2.pdf`

Fetch them from OSF (https://doi.org/10.17605/OSF.IO/3JTZ8) or the private
bucket, place them in `data/raw/`, and run `make data`.
