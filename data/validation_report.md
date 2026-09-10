# Validation report

Pipeline `flourish-pipeline 0.1.0` — regenerate with `make data`.
**62 / 62 checks passed.**

## Checks

| Check | Status | Observed | Expected |
|---|---|---|---|
| respondents rows | pass | 207919 | 207919 |
| respondent ids unique | pass | 207919 | 207919 |
| US file rows | pass | 38312 | 38312 |
| US IDs missing from global | pass | 0 | 0 |
| US rows are the COUNTRY=22 rows | pass | True | True |
| US shared columns | pass | 242 | 242 |
| US shared columns with differing cells | pass | 0 | 0 |
| countries | pass | 23 | 23 |
| retained at Wave 2 | pass | 128868 | 128868 |
| retention share (%) | pass | 61.980 | 61.98 ± 0.01 |
| midyear respondents | pass | 131487 | 131487 |
| midyear share (%) | pass | 63.240 | 63.24 ± 0.01 |
| midyear type 1 (separate) | pass | 54358 | 54358 |
| midyear type 2 (combined) | pass | 77129 | 77129 |
| full/partial Y1 | pass | (205906, 2013) | (205906, 2013) |
| full/partial Y2 | pass | (128554, 314) | (128554, 314) |
| full/partial MY | pass | (131471, 16) | (131471, 16) |
| strata | pass | 411 | 411 |
| PSUs | pass | 136781 | 136781 |
| gender codes 1-4 | pass | {1: 97761, 2: 109331, 3: 406, 4: 172} | {1: 97761, 2: 109331, 3: 406, 4: 172} |
| gender null (blank + DK + refused) | pass | 249 | 249 |
| AGE keeps 99 as a valid top-code | pass | 28 | 28 |
| AGE keeps 98 as a real age | pass | 4 | 4 |
| age range | pass | (18, 99) | (18, 99) |
| US respondents with a state | pass | 38155 | 38155 |
| state weight present iff state present | pass | 0 | 0 |
| responses_long rows | pass | 33,295,632 | > 30,000,000 |
| duplicate (id, wave, variable) keys | pass | 0 | 0 |
| non-response rows with a value | pass | 0 | 0 |
| values outside catalog [min, max] | pass | 0 | 0 |
| nominal values without a label | pass | 0 | 0 |
| sentinel codes left in value | pass | 0 | 0 |
| country-specific codes with wrong country prefix | pass | 0 | 0 |
| coverage rows sum to responses_long | pass | 33295632 | 33295632 |
| pandera schema: respondents | pass | valid | valid |
| pandera schema: variables | pass | valid | valid |
| pandera schema: value_labels | pass | valid | valid |
| pandera schema: derived | pass | valid | valid |
| pandera schema: coverage | pass | valid | valid |
| sfi outside [0, 10] | pass | 0 | 0 |
| sfi with fewer than 10 items | pass | 0 | 0 |
| phq2/gad2 outside [0, 6] | pass | 0 | 0 |
| derived waves | pass | (207919, 131487, 128868) | (207919, 131487, 128868) |
| priority_top only at MY | pass | 0 | 0 |
| catalog coverage lists empty | pass | clean | clean |
| SFI top five order | pass | ['Indonesia', 'Israel', 'Philippines', 'Mexico', 'Poland'] | ['Indonesia', 'Israel', 'Philippines', 'Mexico', 'Poland'] |
| SFI bottom three order | pass | ['United Kingdom', 'Türkiye', 'Japan'] | ['United Kingdom', 'Türkiye', 'Japan'] |
| SFI mean: Indonesia | pass | 8.100 | 8.10 ± 0.03 |
| SFI mean: Israel | pass | 7.868 | 7.88 ± 0.03 |
| SFI mean: Philippines | pass | 7.707 | 7.70 ± 0.03 |
| SFI mean: Mexico | pass | 7.635 | 7.64 ± 0.03 |
| SFI mean: Poland | pass | 7.553 | 7.56 ± 0.03 |
| SFI mean: United Kingdom | pass | 6.786 | 6.79 ± 0.03 |
| SFI mean: Türkiye | pass | 6.318 | 6.31 ± 0.03 |
| SFI mean: Japan | pass | 5.895 | 5.89 ± 0.03 |
| SFI pooled mean (all respondents) | pass | 7.068 | 7.07 ± 0.03 |
| SFI age 18-24 flat near 7.0 | pass | 7.072 | 7.00 ± 0.15 |
| SFI age 25-29 flat near 7.0 | pass | 6.978 | 7.00 ± 0.15 |
| SFI age 30-39 flat near 7.0 | pass | 6.962 | 7.00 ± 0.15 |
| SFI age 40-49 flat near 7.0 | pass | 6.944 | 7.00 ± 0.15 |
| SFI non-decreasing from 50-59 upward | pass | 7.03 → 7.21 → 7.39 → 7.66 | non-decreasing |
| SFI age 80+ | pass | 7.655 | 7.66 ± 0.05 |

## Wave 1 SFI by country (ANNUAL_WEIGHT_C1)

Weighted means of the 12-item Secure Flourishing Index; unweighted n.

| Country | Mean SFI | n (unweighted) |
|---|---|---|
| Indonesia | 8.10 | 6,965 |
| Israel | 7.87 | 3,667 |
| Philippines | 7.71 | 5,288 |
| Mexico | 7.64 | 5,766 |
| Poland | 7.55 | 10,348 |
| Nigeria | 7.37 | 6,817 |
| Egypt | 7.31 | 4,709 |
| Kenya | 7.28 | 11,384 |
| Tanzania | 7.19 | 9,056 |
| Argentina | 7.14 | 6,719 |
| China | 7.13 | 5,020 |
| Hong Kong | 7.12 | 2,999 |
| United States | 7.11 | 38,299 |
| Sweden | 7.10 | 15,036 |
| South Africa | 7.07 | 2,647 |
| Brazil | 7.02 | 13,184 |
| Australia | 7.01 | 3,840 |
| Germany | 7.01 | 9,497 |
| Spain | 6.90 | 6,285 |
| India | 6.87 | 12,713 |
| United Kingdom | 6.79 | 5,360 |
| Türkiye | 6.32 | 1,473 |
| Japan | 5.89 | 20,500 |

## Wave 1 SFI by age band (ANNUAL_WEIGHT_C1)

| Age band | Mean SFI | n (unweighted) |
|---|---|---|
| 18-24 | 7.07 | 25,197 |
| 25-29 | 6.98 | 20,843 |
| 30-39 | 6.96 | 41,750 |
| 40-49 | 6.94 | 34,617 |
| 50-59 | 7.03 | 31,372 |
| 60-69 | 7.21 | 29,118 |
| 70-79 | 7.39 | 19,881 |
| 80+ | 7.66 | 4,774 |

## Retention and midyear coverage by country

| Country | n (Y1) | Retained Y2 % | Midyear % | Midyear separate | Midyear combined |
|---|---|---|---|---|---|
| China | 5,022 | 90.5 | 90.5 | 0 | 4,544 |
| United States | 38,312 | 84.2 | 84.0 | 0 | 32,192 |
| Sweden | 15,068 | 77.0 | 76.8 | 0 | 11,570 |
| Japan | 20,543 | 68.0 | 67.6 | 0 | 13,886 |
| Israel | 3,669 | 67.9 | 67.5 | 0 | 2,476 |
| Kenya | 11,389 | 67.6 | 80.0 | 9,115 | 0 |
| United Kingdom | 5,368 | 67.4 | 62.5 | 1,240 | 2,114 |
| Australia | 3,844 | 67.2 | 65.9 | 2,533 | 0 |
| Egypt | 4,729 | 64.3 | 71.6 | 3,386 | 0 |
| Poland | 10,389 | 62.4 | 41.5 | 4,316 | 0 |
| Tanzania | 9,075 | 61.5 | 72.5 | 6,577 | 0 |
| Germany | 9,506 | 58.2 | 43.8 | 820 | 3,343 |
| Philippines | 5,292 | 50.7 | 65.2 | 3,448 | 0 |
| India | 12,765 | 49.9 | 64.3 | 8,206 | 0 |
| Spain | 6,290 | 46.5 | 35.2 | 570 | 1,645 |
| Nigeria | 6,827 | 46.1 | 72.4 | 4,487 | 456 |
| Argentina | 6,724 | 43.6 | 40.6 | 1,826 | 902 |
| Mexico | 5,776 | 39.4 | 36.8 | 1,238 | 888 |
| Indonesia | 6,992 | 38.4 | 38.3 | 2,675 | 0 |
| South Africa | 2,651 | 36.9 | 61.3 | 1,625 | 0 |
| Türkiye | 1,473 | 33.9 | 44.7 | 659 | 0 |
| Brazil | 13,203 | 32.4 | 30.6 | 1,637 | 2,407 |
| Hong Kong | 3,012 | 23.5 | 23.4 | 0 | 706 |

## Tables

| Table | Rows |
|---|---|
| respondents | 207,919 |
| responses_long | 33,295,632 |
| derived | 468,274 |
| coverage | 4,752 |
| variables | 182 |
| value_labels | 3,298 |
| countries | 23 |

## Outputs

| File | Size |
|---|---|
| catalog.json | 0.7 MiB |
| flourish.duckdb | 144.0 MiB |
| parquet/countries.parquet | 0.0 MiB |
| parquet/coverage.parquet | 0.0 MiB |
| parquet/derived.parquet | 2.8 MiB |
| parquet/respondents.parquet | 8.8 MiB |
| parquet/responses_long.parquet | 43.7 MiB |
| parquet/value_labels.parquet | 0.0 MiB |
| parquet/variables.parquet | 0.0 MiB |

## Stage runtimes (this machine, seconds)

| Stage | Seconds |
|---|---|
| codebook | 2.6 |
| derive | 2.4 |
| ingest | 0.6 |
| manifest | 0.2 |
| reshape | 2.9 |
| validate | 0.8 |

All figures above are aggregates; no raw microdata appears in this report.
