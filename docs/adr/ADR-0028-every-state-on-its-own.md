# ADR-0028: Every US state on its own

**Status:** Accepted · **Date:** 2026-10-21 · **Phase:** 7

Replaces the release's pooled small-state groups as the US States
page's unit (Phase 5): a US respondent's `state` and `state_y2` are now
the state they live in.

## Context

The release keys US respondents for the state weights by
`STATE_FOR_ANALYSIS_Y1/Y2`: 37 states and four groups of the 13 smallest
(`ME_NH_RI_VT`, `DE_MS_WV`, `AK_HI_MT`, `ND_SD_WY`), "so state
estimates keep adequate n"; its state weights are calibrated to those 41
units. The pipeline copied the column, so the map painted, say, Hawaii
and Montana with one number. The owner asked on 21 October 2026 not to
pool small states unless there is a very good reason.

The same release carries `REGION1_Y1/Y2`, which for the United States is
the state itself (codes 2201–2250, labelled in the codebook; 2251
"Other"). Checked against the file:

- every `REGION1` state lies in exactly one analysis unit, and every
  respondent of a pooled group has a member state;
- "Other" is exactly the 157 respondents without an analysis unit (and
  without a state weight);
- for the 6,046 people with no Wave 2 interview the release carries the
  Wave 1 unit forward as `STATE_FOR_ANALYSIS_Y2` (all equal), so their
  Wave 2 state is their Wave 1 one.

The 13 states would rest on 75–195 people at Wave 1 and 59–177 at Wave 2
and the midyear survey; the smallest unpooled state has 300 and 239.

## Decision

- **The pipeline keys each respondent by their own state.** `state` is
  the postal code of `REGION1_Y1`'s label and `state_y2` that of
  `REGION1_Y2` (else `REGION1_Y1`), wherever the release gives an
  analysis unit — so exactly where the state weights are populated.
  Reshape refuses to write a respondent whose state is missing or lies
  outside its unit; validation checks 50 distinct states and that the
  Wave 2 state and its weights go together.
- **No pooled codes anywhere.** `flourish_stats.states` names the 50
  states and DC only; `/v1/meta`'s state labels lose `members`; the map
  loses its dashed outline and "One estimate for …" card.
- **Not a very good reason to pool.** The weights' calibration to the
  group is the release's reason. A member state's figure is a domain
  estimate within its group (as an age band within a state is), valid
  under the design, with an interval that widens honestly; ADR-0011
  already shows every number however few people are behind it, and the
  release publishes every respondent's state, so nothing new is
  disclosed.

## Alternatives considered

- **Keep the groups** — what the release recommends, but it hides the
  13 states the page is for, and the owner's bar for pooling is a very
  good reason, which this is not.
- **Pool only where an estimate falls below a size** — ADR-0011 retired
  size rules for display; a map whose units change with the question
  would be harder to read.

## Consequences

Easier: every state reads as itself, on the map and in the chart.
Harder: the 13 smallest states' intervals are wide, and they tend to sit
at the ends of the map's colour range (small samples vary most) — the
interval in each card says how far to trust them. Their weights match
their group's population, not their own (METHODS says so). The deployed
static tier and database must be rebuilt for the change to show.
