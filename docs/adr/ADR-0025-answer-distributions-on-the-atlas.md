# ADR-0025: Every answer's share on the Atlas

**Status:** Accepted · **Date:** 2026-10-21 · **Phase:** 7

Related: ADR-0010 (token colours), ADR-0015 (polarity: which end of a
question is "more"), ADR-0022 (the hover card).

## Context

The owner asked on 21 October 2026 for a way to see the distribution of
a question's answers on the Atlas when its answers are levels like "A
lot / Some / Not very much / Not at all". The Atlas showed one answer's
share at a time.

## Decision

1. **A categorical question gets a Distribution view.** Beside "Share",
   the Statistic control offers "Distribution" for a categorical question
   with 2 to 9 answers (the most the ramp's nine steps tell apart). It
   draws one 100% stacked bar per country (`charts/StackedShares.tsx`): a
   segment per answer in the codebook's order, its share printed where
   it fits, a key above. The shades are the sequential ramp spread over
   the answers, deepest at the answer that is most of what the question
   names (its served polarity) — so an ordered question reads as a
   gradient. Each segment's card is ADR-0022's. The rows sort by name or
   by one answer's share ("Sort by answer"); the Countries control
   subsets them.
2. **Served from the share file.** A categorical question's distribution
   *is* its share at every answer, and the proportion response already
   carries every level for every country, so `stat=distribution` on a
   categorical question requests `proportion` (`atlasRequest`): static,
   offline-safe, the same numbers, and the same CSV. A question with more
   than nine answers keeps the share view only (a link's
   `stat=distribution` shows it).

## Alternatives considered

- **The scale questions' histogram for up to four countries** — a
  distribution of a few countries at a time; the stacked bars show all of
  them, comparable at a glance.
- **A tinted matrix (countries × answers)** — it reads as a table, which
  the owner had just removed; bars are the chart people know for this.
- **A qualitative palette for unordered answers** — the only categorical
  hues are the six SFI domain colours, fixed to those domains; the ramp
  with a key keeps every page's colours meaning one thing.

## Consequences

Easier: the full answer pattern of a question across 23 countries in one
chart. Harder: an unordered question's shades suggest an order its
answers do not have (the key names them); a question with ten or more
answers has no distribution view.
