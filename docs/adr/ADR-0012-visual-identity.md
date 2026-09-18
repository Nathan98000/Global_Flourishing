# ADR-0012: Visual identity — warm paper, serif structure, quiet controls

- Status: Accepted
- Date: 2026-09-18
- Deciders: repo owner, Claude
- Related: ADR-0010 (rendering stack and chart domain rules — unchanged
  by this pass), proposal §4.4 (the six SFI hues are fixed)

## Context

The Phase 4 app shipped on a near-neutral palette with a stock blue
accent, one sans family at one or two sizes, filled accent blocks for
selected controls, and a card around the chart. It worked, and read as
an internal tool. The September 2026 redesign pass restyles it as a
data publication — **no information architecture changes, no new views,
no chart-data logic** — under the standing gates: ≤ 250 kB gz initial
route, Lighthouse ≥ 90/≥ 95, unit-tested token contrast, `var(--token)`
charts, six fixed SFI hues, six green journeys, no new runtime
dependency.

## Decision

**Palette.** Warm paper surfaces (`#f6f4ee` page / `#fbfaf5` surface)
with warm near-black ink, an ink-teal accent (`#1f5d55`, dark
`#7fb8ad`), warm data series (teal / burnt orange / violet) and a
sand→teal sequential ramp for the map. Both themes are selected steps,
not automatic flips, as before. The six SFI domain hues are untouched.
Contrast stays unit-tested; the redesign *extended* the test (selected
control tint, both ramp ends against the surface) and shrank the
light-mode relief list to the three fixed SFI hues — the new series all
clear 3:1.

**Type.** Two families, split by role. Source Serif 4 carries structure
and voice: wordmark, headings, deck lines, chart titles, Methods prose.
The system sans stack keeps the interface: nav, labels, controls, table
headers, axis ticks and every data value (`charts/theme.ts` still emits
the sans stack; numerals are `tabular-nums` everywhere). The serif is
**self-hosted** — two static latin-subset WOFF2 files (≈ 41 kB total)
under `public/fonts/`, `font-display: swap`, the 600 preloaded — because
this app makes no third-party requests and a font CDN would be the
first. OFL 1.1 ships beside the files and in `docs/NOTICES.md`. Assets,
not a dependency: the no-new-runtime-dependency rule is untouched.

**Controls.** Segmented groups are demoted from filled accent blocks to
a tinted row where the selected option carries a deeper tint, ink text
and a 2px inset ink rule. Five of the old filled blocks stacked above
the chart and read as primary actions; the data is the primary thing.
There are no filled buttons anywhere — every button is a quiet bordered
surface, and chart exports are plain text links.

**Rules and space over cards.** The chart card, the Methods lead card
and the notice cards are gone; hairline rules (`--grid`, or ink for the
Methods lead) plus a 4rem section rhythm (`--space-7`) do the
separating. The one bordered surface left in the chart block is the
expanded data table. Radii drop to 2/3/4px. Notices are full-width
top-and-bottom-rule bands, bold only on the state word.

## Rejected

- **Filled accent buttons** — read as product chrome competing with the
  charts; the selected state now rides a tint plus an ink rule.
- **Pure-white surfaces with near-black `#000`-ish ink** — harsh
  against warm paper; the palette keeps warm whites and a warm
  near-black (`#1b1a17`), and the contrast test proves nothing was
  traded away (13.6:1 body text).
- **A blue sequential ramp** — indistinguishable from off-white paper
  at its light end; the sand→teal ramp starts visibly darker than the
  surface, and the token test now pins a floor for the ramp's light end
  against `--surface` so a future swap cannot regress it silently.
- **Google Fonts CDN** — a third-party request (and a privacy surface)
  in an app that deliberately makes none; self-hosting costs two small
  files and an OFL notice.

## Consequences

Easier: the identity is entirely tokens + component CSS, so it retints
live in both themes and the PNG export inherits it through the computed
`var()` resolver; future views get the publication look by using the
existing components. Harder: the serif is a real asset with a licence
notice to maintain, and any new token pair must be added to
`tokens.test.ts` (that is the point). The budget is unaffected — fonts
live in `public/`, outside the initial-route count (189.9 kB gz of
250). Charts keep every ADR-0010 rule: fitted windows with stated
edges, zero-based bars, direct value labels, `var(--token)` colors
only.

## Revised — 18 September 2026

A side-by-side against the wireframe canvas found ten differences; the
owner accepted all ten (`docs/prompts/visual-redesign-followups.md`).
Five of them reverse a choice recorded above, so they belong here rather
than in a commit message alone:

- **Segmented groups are framed.** A 1px `--border` outline with 1px
  dividers between options, not a bare tinted field. The tint-plus-rule
  selected state is unchanged; the frame is what keeps unselected
  options reading as separate targets.
- **The type scale is the system.** `--text-xs/sm/base/prose/deck/h2/
  brand/h1` replace the old ladder plus the literal pixel sizes that had
  accumulated at call sites; `--text-lg` and `--text-xl` are gone.
  Chart-internal sizes stay numeric (Plot needs numbers) but come from
  the same ladder: 11, 12, 13.5.
- **Long-label control groups become a native `<select>` under 30rem**
  rather than wrapping as a segmented row.
- **Charts fill the column.** `chartWidth` treated its design width as a
  ceiling, capping dot plots at 660px inside a 960px column; it now
  fills the measured width, with the design width only as the fallback.
  A chart that genuinely needs a ceiling carries its own.
- **Row labels are 13.5px `--ink`, value axes 11px.** The shipped 12px
  `--ink-secondary` labels sat below the value labels in weight and
  flattened the row hierarchy the dot plot depends on.

Also settled here: the chart title carries the measure alone (wave and
scale live in the subtitle), the phone keeps exactly two controls above
the "More options" disclosure, and the Codebook renders answer types as
words rather than catalog codes. Nothing in the palette, the fonts or
the card-free chart block changes.
