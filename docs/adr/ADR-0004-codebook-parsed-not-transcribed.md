# ADR-0004: Codebook as source of truth, parsed not transcribed

**Status:** Accepted · **Date:** 2026-09-10 · **Phase:** 1

## Context

Every number the app shows needs wording, value labels, and sentinel codes
from the 84-page Wave 2 codebook PDF. Transcribing ~170 entries by hand
would be error-prone, unreviewable, and would have to be redone for Wave 3
(April 2027). But the PDF cannot be the *only* source: it does not say
which waves asked a variable, which direction a scale runs in for chart
labelling, or how to group variables into families — and it contains
errors (a duplicated `DOI_ANNUAL_Y2` heading, `ANNUAL_WEIGHT_1` for a
column named `ANNUAL_WEIGHT_C1`, wave flags documented as `1` that the
data code as `2`/`11`).

## Decision

Parse the PDF mechanically and merge it with the CSV headers and a
hand-curated overrides file, with precedence **overrides > CSV header >
PDF**:

1. **Two-stage parser.** `codebook/extract.py` (the only module that
   touches pdfplumber) classifies PDF words into `Line` records — label
   column vs content column by x-position, headings and section titles by
   font — and `codebook/parse.py` is a pure function from lines to
   entries. The pure stage carries all the layout logic: value labels are
   recognised by pattern wherever they sit (the block labels are
   vertically centred, so `Value labels:` routinely appears mid-list),
   and variable-label vs wording lines are split by minimising each
   label's distance to its block midpoint.
2. **Facts derived from the CSV, not the PDF:** `waves_available` comes
   from the `_Y1/_Y2/_MY` header suffixes; catalog variables are keyed by
   base column name (169 global + 13 US-file-only).
3. **Facts that need judgement live in
   `flourish_pipeline/overrides/*.yaml`:** display names, families,
   direction (read from labelled endpoints, reviewed by hand), scale-type
   corrections, SFI domain membership, rulings for parenthesised labels
   that are answers rather than non-response (`INCOME 9900`,
   `SELFID 9997`, the childhood `97 = (Does not apply)`), the alias table
   and the duplicated-heading fix. Every variable must have an entry;
   coverage in both directions (column → entry, heading → column) is
   enforced by the stage, which fails on any unlisted gap.
4. **Ten real entries are committed as a fixture**
   (`pipeline/tests/fixtures/codebook_lines_sample.json`, regenerated via
   `flourish-pipeline codebook --dump-lines`) so the parser is fully
   tested in CI without the PDF; the country-specific entries are
   truncated to two countries. A ten-entry excerpt of codebook text is
   documentation, not microdata. The PDF itself stays out of git.

When Wave 3's codebook arrives: run `flourish-pipeline codebook
--draft-overrides` to get a review skeleton for new entries (with endpoint
labels embedded), review it by hand into `variables.yaml`, regenerate the
fixture if the layout changed, and let the coverage check enumerate
everything that moved.

## Alternatives considered

- **Hand-transcribed catalog JSON** — unreviewable at ~3,300 value labels
  and repeats for every wave; rejected.
- **PDF-only automation, no overrides** — cannot express direction,
  families, or the judgement calls above; the parser would grow
  special-cases per variable; rejected.
- **`pdftotext -layout` + regex** — loses the x-coordinates that make
  label/content splitting and page-break continuation reliable; rejected.

## Consequences

- Wave 3 ingestion is a config change (new overrides entries) plus a
  fixture refresh, as the proposal requires.
- The overrides file is large (~170 entries) and is the single place
  where human judgement is recorded; `review_status: draft` marks the
  entries still awaiting confirmation.
- Parser changes are cheap to verify: the fixture reproduces every known
  layout quirk, and an integration test pins the full-document counts
  (172 heading lines, 5 sections, 169 + 13 catalog variables).
