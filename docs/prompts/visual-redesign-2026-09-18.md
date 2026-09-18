# Visual redesign — 18 September

> **Superseded in part.** Ten follow-up corrections were accepted after comparing the shipped result with the wireframes — see `visual-redesign-followups.md`, which wins wherever the two disagree.

A design pass over the shipped app. **No information architecture changes, no new views, no chart-data logic, no statistics.** Same content, same controls, same behaviour — it should look like a considered data publication rather than an internal tool.

The reference is the canvas "Flourish Atlas — visual redesign" in the owner's artifact gallery: six artboards (Atlas desktop and dark, phone, Methods, Codebook, and a specimen sheet carrying every token value). Where this prompt and the artboards disagree, this prompt wins — it is the one with the hex codes.

## Ground rules

| Constraint | Where it bites |
|---|---|
| Initial route ≤ 250 kB gzipped | `pnpm -C apps/web budget` (fonts sit outside it — see §2) |
| Lighthouse performance ≥ 90, accessibility ≥ 95 | `lighthouserc.cjs` in CI |
| Token contrast pairs are unit-tested | `src/__tests__/tokens.test.ts` — update it, never weaken it |
| Charts read `var(--token)` strings only; no hex in chart code | `charts/theme.ts`, CLAUDE.md |
| Six SFI domain hues stay as they are | proposal §4.4 |
| Six Playwright journeys stay green | `apps/web/e2e/journeys.spec.ts` |
| No new runtime dependency | ADR-0010 (two self-hosted font files are assets, not a dependency) |

What this pass must not do: add a component, add a card, add an icon set, animate anything, or make a number harder to read. Every change below is CSS, tokens, or a few lines of markup.

## 0. The direction

Warm paper, ink-teal accent, serif headings over a sans interface, hairline rules instead of cards, and controls that stop competing with the data. Four changes carry most of it: quieter control states (§3), a serif (§2), the new palette (§1), and removing the chart card (§5). Do those four first and stop to look before going further.

## 1. Tokens

Replace the surface, ink, interactive and ramp groups in `src/styles/tokens.css`. Keep the six `--sfi-*` hues, keep the token names (the contrast test reads them), and keep the dark block's structure (`@media (prefers-color-scheme: dark) :root:not([data-theme='light'])` plus `:root[data-theme='dark']`).

Light:

```css
--page:            #f6f4ee;
--surface:         #fbfaf5;
--surface-raised:  #fffefb;
--ink:             #1b1a17;
--ink-secondary:   #57544c;
--ink-muted:       #8a867c;   /* hairlines only, as now */
--border:          rgba(27, 26, 23, 0.14);
--grid:            #e4dfd3;
--axis:            #c0bbac;

--accent:          #1f5d55;
--accent-hover:    #16453f;
--accent-ink:      #fbfaf5;
--focus-ring:      #1f5d55;

--control-bg:       #f1eee6;
--control-selected: #e5e0d3;
--control-rule:     #1b1a17;

--series-1: #1f5d55;
--series-2: #b4531f;
--series-3: #6b5ca5;

--seq-100: #f0e7d4;
--seq-200: #d9cfb0;
--seq-300: #b3c0a4;
--seq-400: #83a596;
--seq-500: #558a80;
--seq-600: #356a65;
--seq-700: #1e4a48;
--map-empty: #e8e3d7;

--notice-bg: #eef1ea;  --notice-border: #c8d3c8;
--warning-bg: #f4ecd9; --warning-border: #ddc99a;
--warn-text: #7a5410;  --error-text: #9d2c22;  --ok-text: #1f5d55;
```

Dark (both scopes):

```css
--page: #141310;  --surface: #1b1a16;  --surface-raised: #23211c;
--ink: #ece8de;   --ink-secondary: #b6b1a4;  --ink-muted: #7d7970;
--border: rgba(236, 232, 222, 0.14);  --grid: #2b2924;  --axis: #3a372f;

--accent: #7fb8ad;  --accent-hover: #9ecec4;  --accent-ink: #141310;  --focus-ring: #7fb8ad;
--control-bg: #1c1b17;  --control-selected: #272521;  --control-rule: #ece8de;

--series-1: #7fb8ad;  --series-2: #d98b5a;  --series-3: #a396db;

--seq-100: #1e3a38; --seq-200: #24504c; --seq-300: #356a65; --seq-400: #558a80;
--seq-500: #83a596; --seq-600: #b3c0a4; --seq-700: #d9cfb0;
--map-empty: #26241f;

--notice-bg: #17201c;  --notice-border: #2f4a42;
--warning-bg: #2a2313; --warning-border: #5c4a23;
--warn-text: #e3b562;  --error-text: #f0a79c;  --ok-text: #7fb8ad;
```

Shape and spacing, same file:

```css
--radius-sm: 2px;  --radius-md: 3px;  --radius-lg: 4px;   /* were 4 / 8 / 12 */
--space-7: 4rem;                                           /* new: between sections */
```

Contrast (verify, don't take my word): `--ink`/`--page` 13.6:1, `--ink-secondary`/`--page` 7.4:1, `--accent`/`--page` 6.3:1, dark `--ink`/`--page` 14.2:1, `--accent`/`--page` 7.9:1. Extend `tokens.test.ts` to cover `--control-selected` as a background for `--ink`, and the new ramp ends against `--surface`.

## 2. Typography

Two families, sharply divided by role. **Serif** — wordmark, every `h1`/`h2`/`h3`, deck lines, chart titles, Methods body. **Sans** (the existing stack, unchanged) — nav, labels, buttons, inputs, table headers, axis ticks, footnotes, data values.

```css
--font-serif: 'Source Serif 4', 'Iowan Old Style', Georgia, serif;
```

Self-host: two static latin-subset woff2 files (400 and 600) in `apps/web/public/fonts/`, `@font-face` in `tokens.css` with `font-display: swap`, and `<link rel="preload" as="font" type="font/woff2" crossorigin>` for the 600 in `index.html`. No Google Fonts CDN — this app makes no third-party requests and should keep it that way. Source Serif 4 is OFL; add it to the third-party notices the launch checklist asks for.

| Element | Now | Change to |
|---|---|---|
| Wordmark | 20px sans 700 | 22px serif 600, `letter-spacing: -0.01em` |
| `h1` (page and chart titles) | 20px sans 700 | 28px serif 600, `line-height: 1.15` |
| `h2` | 20px sans 700 | 21px serif 600, `line-height: 1.25` |
| Deck line | 17px sans | 19px serif, `line-height: 1.45`, `max-width: 34rem` |
| Methods prose | 15px/1.5 sans | 16.5px/1.62 serif |
| Nav, labels, buttons | 13px sans | unchanged size, `letter-spacing: 0.02em` on nav |
| Chart values | 15px sans 700 | 14px sans 500, `font-variant-numeric: tabular-nums` |

Add `font-variant-numeric: tabular-nums` to every numeric surface: chart value labels, axis ticks, all table cells, the `n` in captions. `charts/theme.ts` keeps `FONT_FAMILY` as the sans stack — chart marks stay sans.

## 3. Controls (the change that matters most)

`components/controls/RadioRow.module.css`. Today the selected option is a solid `--accent` block with white text; five or six of those stack above the chart and read as primary actions.

```css
.row    { background: var(--control-bg); border-radius: var(--radius-md); }
.option { padding: 6px 12px; font-size: var(--text-sm); color: var(--ink-secondary); }
.option[data-checked] {
  background: var(--control-selected);
  color: var(--ink);
  font-weight: 550;
  box-shadow: inset 0 -2px 0 var(--control-rule);
}
.option[data-disabled] { color: var(--ink-muted); opacity: 1; }
```

Keep `width: fit-content` on `.row` at desktop widths — a segmented group should be as wide as its labels, never stretched to fill a column. Selects and inputs: `background: var(--surface)`, `border: 1px solid rgba(27,26,23,0.18)` (token it if you prefer), `border-radius: var(--radius-md)`, `padding: 7px 9px`.

## 4. Layout and rhythm

- `components/AppShell.module.css`: `.layout { max-width: 60rem; padding: clamp(16px, 4vw, 32px); }` (was 68rem / 16px). The Codebook table may opt out to 68rem; prose columns cap at 38rem (§6).
- Header on one row: wordmark, then nav with `margin-right: auto`, then the theme control at the far right. Nav gap 24px, items `--ink-secondary` at 13px; the active item is `--ink` with `text-decoration: underline; text-underline-offset: 6px; text-decoration-thickness: 1px` — drop the 2px border.
- Theme control becomes icon-only, 34px square (44px under 40rem), inline stroke SVG (moon/sun), `aria-label` naming the action.
- Use `--space-7` between: header and deck, deck and controls, controls and chart, chart and footnote. The old 16px gap everywhere is why the page reads as one undifferentiated stream.

## 5. The chart block

`charts/ChartFigure.module.css` and `views/AtlasView.module.css`:

- Remove `background`, `border` and `border-radius` from the chart container. Separate it with `border-top: 1px solid var(--grid)` and `padding: var(--space-6) 0 var(--space-5)`.
- Keep a bordered surface only for the expanded data table.
- Chart values: 14px/500, tabular, and reduce the gap between the plot's right edge and the value column to 16px.
- Direct-label every row (already true) and keep the axis at the top of the chart.

## 6. Page by page

**Atlas.** Deck at 19px serif in `--ink-secondary` with the count in `--ink`. CSV/PNG become 13px text links at the right end of the chart title row (`Download CSV · PNG`), not outlined buttons. The "What this score is" block loses its left rule and tint: plain 14px `--ink-secondary` paragraph under the subtitle with the "See the full entry →" link inline.

**Codebook.** Variable names `--ink` at 14.5px/500, `text-decoration: none`, underline on hover. Row padding 13px, `border-top: 1px solid var(--grid)` per row, no outer border. Column headers 11.5px sans, `letter-spacing: 0.06em`, uppercase, `--ink-secondary`. Family values render through the topic display names already built for the picker, not raw codes. The "Chartable" header text goes (visually-hidden label for screen readers); the link reads "Chart it →" and right-aligns. Filter selects share `min-width: 8rem`.

**Methods.** Replace the tinted rounded lead card with a rule-bounded lead: `border-top: 1px solid var(--ink)`, `border-bottom: 1px solid var(--grid)`, 22px padding, two 19px serif paragraphs, sources on one 13px line below. Body column `max-width: 38rem`.

**Map.** Remove the sphere outline. Non-study land `--map-empty`; give the "no estimate" legend swatch a 1px `--axis` border so it is distinguishable from land. Legend moves under the subtitle: a 140px ramp with min and max values only.

## 7. Components

- **Notice / banner**: full-width band inside the column — `border-top`/`border-bottom: 1px solid var(--warning-border)`, no radius, 13px, one line, bold only on the word that carries the state.
- **Buttons**: secondary only — `background: var(--surface)`, 1px border, `--radius-md`, 13px. No filled buttons anywhere in the app.
- **Links**: `color: var(--accent)`, `text-underline-offset: 2px`, `text-decoration-thickness: 1px`, hover `--accent-hover`.
- **Focus**: keep `2px solid var(--focus-ring)` with `outline-offset: 2px`.

## 8. Responsive

- Segmented groups must never orphan an option. Under 40rem make `.row` a grid: `grid-template-columns: repeat(N, minmax(0, 1fr))` driven by option count, so three options divide evenly instead of wrapping 2 + 1. Groups whose labels are long (Statistic) become a native `<select>` under 30rem.
- Fold display options into a disclosure under 40rem: Measure and Wave stay visible; View, Statistic, Sort, Order and Countries move into a `<details>` labelled "More options — chart, sort, countries". The chart should start within the first screen at 390×844.
- Data table: wrap in `overflow-x: auto`; drop the CI column under 30rem (it stays in the CSV).
- Touch targets 44px under 40rem — theme button, segmented options, country checkboxes.

## 9. Gates that will move

Expect to update, not to weaken: `tokens.test.ts` (new pairs), any component test asserting a colour or a radius, Playwright assertions that match on button styling, and the Lighthouse contrast audit. Re-run `pnpm -C apps/web budget` after adding the fonts — the JS budget should not move at all; if it does, something imported a font file into the bundle instead of referencing it from `public/`.

## 10. Documentation

**ADR-0012 — visual identity**: the palette (warm paper, ink-teal accent, warm data series, sand→teal ramp), the serif/sans split and why fonts are self-hosted, controls demoted to tint-plus-rule, cards replaced by rules and space. Record what was rejected and why: filled accent buttons (read as a product), pure-white surfaces and near-black ink (harsh on warm paper), a blue sequential ramp (indistinguishable at the light end on off-white), Google Fonts CDN (third-party request). Register it in `docs/adr/README.md` and update ADR-0010's consequences to point at it. Refresh the README screenshot.

## How to land it

Two PRs, each green on `pnpm -C apps/web test`, `pnpm -C apps/web e2e`, `pnpm -C apps/web budget` and `make lint typecheck` before it opens:

1. `claude/redesign-foundation` — §1 tokens, §2 typography and the font files, §3 controls, §4 layout and header, §5 chart block. This is the pass that changes how the site feels; it should be reviewable as one visual diff.
2. `claude/redesign-pages` — §6 page-by-page, §7 components, §8 responsive, §9 test updates, §10 ADR-0012 and the README screenshot.

Finish by looking at it yourself with the real tier and the API up (`rsync -a --delete data/static/ apps/web/public/data/`, `make api`, `make web`), at 390 px and 1280 px in both themes: Atlas chart and map, a breakdown with small cells, Codebook list and a variable detail, Methods. In the second PR's description, note anything from the artboards you deliberately did differently, and why.
