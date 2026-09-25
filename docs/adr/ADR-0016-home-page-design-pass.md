# ADR-0016: The home-page design pass — fewer controls, plainer numbers, server-owned subtopics

**Status:** Accepted · **Date:** 2026-09-25 · **Phase:** 7

## Context

The owner's page-by-page review started with the Atlas (home) page on
25 September 2026 (`docs/prompts/home-page-design-2026-09-25.md`). Most
of what it found lives in shared components, so the decisions below apply
on every view that uses them. Five of them change a rule an earlier ADR
or `CLAUDE.md` stated, so they are recorded here rather than left to the
diff.

## Decision

1. **No world map.** Twenty-three countries are too few for a map to
   inform: a ranked chart separates them, a map mostly shows where they
   are. The Atlas loses its Chart/Map toggle and `view` param (an old
   `?view=map` link just loads the chart, with no invalid-parameter
   notice), and the world topology, choropleth and `world-atlas`
   dependency go. The **US States map stays** — fifty-plus areas on a
   familiar shape do inform — and keeps the quantized scale and legend
   through a small shared module (`charts/mapScale.tsx`). This revises
   the map part of ADR-0010.
2. **Tooltips carry the interval only; n lives in the data table.** Every
   tooltip writes its interval as `95% CI [7.59, 7.68]` — the same
   brackets the data tables use, one formatter (`format.ts ciText`) — and
   no tooltip or hidden screen-reader string says `n = …`. The unweighted
   n stays on every row of the data table and in every CSV; the Correlates
   matrix's below-floor cells say "Too few respondents to rank (fewer
   than N)" with N from the response. This revises the `CLAUDE.md` rule
   that every number shown carries its n.
3. **No "Orient so higher = better" checkbox.** Reversing an item's scale
   on the page added a mode the subtitle then had to explain. The Atlas
   loses the checkbox and its `oriented` param; the API's `oriented`
   parameter stays for callers that want it.
4. **Scale endpoints, not "better".** A subtitle names an item's endpoints
   from its own value labels — `Average score, 0–10 (0 = Not true of you
   at all, 10 = Completely true of you)`, lowest and highest valid code
   exactly as the server labels them — and a derived score shows just the
   range. Neither the subtitle, the axis nor the Codebook detail line says
   "higher/lower is better" or "no better-or-worse direction" any more;
   the value-labels table shows the ends. Change's "a rise is better /
   worse" note (owner decision, 24 September) and the catalog's
   `direction` field are unchanged.
5. **Server-owned subtopics.** A family may carry a `subfamily` code per
   variable (`overrides/variables.yaml` → catalog → `/v1/variables` and
   the static `variables.json`). Religion & spirituality's 45 items split
   9 / 5 / 4 / 5 / 15 / 7 into affiliation, beliefs, practice, daily life,
   teachings by tradition and the country's main religion; the picker
   shows a Subtopic select between Topic and Measure for such a topic.
   Membership is the server's; only the subtopic *display names* live in
   the client (`apps/web/src/topics.ts`), the same exception the topic
   names already had.

The pass also fixed a control change scrolling the page to the top
(search-only navigations keep the scroll position through one helper),
turned long answer lists (above six options) into a compact select in
the shared answer-level control, put answer labels rather than codes in
the data tables' "Answer" column, tightened the space around every
view's lede, named downloads in words
(`flourish-atlas_<measure>_<view>_<waves>[_by-<breakdown>][_<country>]`,
the same string on the server and the client) and dropped the data
version from the PNG footer. None of those changes a stated rule.

## Alternatives considered

- **Keep the map behind the toggle.** It cost a 230 kB lazy chunk and a
  control on every Atlas visit for a view the owner found uninformative;
  the US map keeps the code path that earns it.
- **Keep n in tooltips but shorten it.** The tooltip's job is the value
  and its interval; the n belongs with the row it qualifies, in the table
  and the CSV, where it can be read at leisure.
- **Client-side subtopic membership** (a list of codes per subtopic in
  `topics.ts`). It would be the first data grouping the front end owned;
  the catalog already carries every other per-variable fact, and the
  static tier mirrors it for free.
- **A `subtopic` URL param.** The subtopic is a mid-selection like the
  search query, not a fact about the chart; it stays local to the picker
  and follows the chosen measure.

## Consequences

- The Atlas has no `view` or `oriented` param; the US States view keeps
  its `view` (map/bars).
- `flourish_api.schemas.VariableSummary` carries `subfamily` (nullable),
  so `/v1/variables` and `variables.json` change shape; the contract test
  pins both, and the data tier needs a rebuild (`make data`, then
  `data-build.yml`) before the subtopics appear in production.
- Any new tooltip must use `ciText` and must not print an n; any new
  scale subtitle goes through `scaleSubtitle` with the variable's detail
  so the endpoints appear.
- A file name change on either side must be mirrored on the other; the
  paired tests (`export.test.ts`, `test_states_export.py`) fail otherwise.
- Revisit the map decision if the study grows well beyond its 23
  countries, and the tooltip decision if user testing shows readers
  looking for n before opening the table.
