// The Methods page's diagrams (ADR-0021): small explanatory drawings set
// between the sections of docs/METHODS.md, where a "figure:" comment asks
// for one. Like the charts, every colour is a `var(--token)` string
// (ADR-0010); unlike the charts they draw no data, except the
// weights diagram, which is drawn from the server's own weight table
// (`meta.weight_table` — the rules are never restated here). Example
// numbers belong to "Country A", "Country B", … and to no real country.

import type { ReactNode } from 'react'
import type { Meta, WeightSpec } from '../../api/types'
import { eligibleWords, type MethodsFigureName } from './document'
import { WAVE_CHIPS } from '../../waves'
import styles from './MethodsFigures.module.css'

const ACCENT = 'var(--accent)'
const SERIES_2 = 'var(--series-2)'
const INK = 'var(--ink)'
const INK_SECONDARY = 'var(--ink-secondary)'
const INK_MUTED = 'var(--ink-muted)'
const GRID = 'var(--grid)'
const WHISKER = 'var(--whisker)'
const CARD = 'var(--plot-background)'
const POSITIVE = 'var(--div-pos-mark)'
const NEGATIVE = 'var(--div-neg-mark)'

/** A diagram: the drawing, read by assistive tech as one image with
 * `label` as its words, and a caption under it. */
function Figure({
  label,
  caption,
  viewBox,
  children,
}: {
  label: string
  caption: ReactNode
  viewBox: string
  children: ReactNode
}) {
  return (
    <figure className={styles.figure}>
      <svg viewBox={viewBox} role="img" aria-label={label} className={styles.drawing}>
        {children}
      </svg>
      <figcaption className={styles.caption}>{caption}</figcaption>
    </figure>
  )
}

/** A numbered marker, keyed to the list under the drawing. */
function Badge({ x, y, n }: { x: number; y: number; n: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={8} fill={INK} />
      <text x={x} y={y + 3.5} textAnchor="middle" className={styles.badge}>
        {n}
      </text>
    </g>
  )
}

// --- How to read the charts -------------------------------------------------

/** Three example rows on a 6.5–8.0 window (160 px a point from x = 70). */
const READING_ROWS = [
  { label: 'Country A', y: 48, estimate: 7.66, lo: 7.58, hi: 7.74 },
  { label: 'Country B', y: 80, estimate: 7.1, lo: 6.8, hi: 7.4 },
  { label: 'Country C', y: 112, estimate: 6.92, lo: 6.86, hi: 6.98 },
] as const
const readingX = (value: number) => 70 + (value - 6.5) * 160

function ReadingFigure() {
  const [, picked] = READING_ROWS
  const cardX = readingX(picked.hi) + 6
  return (
    <Figure
      viewBox="0 0 440 146"
      label="An example chart: three countries, each a dot with a line through it. Country B's line is the longest. Its hover card reads: Country B; Mean: 7.10 on a 0–10 scale; 95% CI: [6.80, 7.40]; Based on 412 people."
      caption={
        <ol className={styles.key}>
          <li>The dot: the estimate.</li>
          <li>The line: its 95% confidence interval (CI).</li>
          <li>
            The hover card: what the dot is, its value in words, its CI, and how many people it
            rests on.
          </li>
        </ol>
      }
    >
      {[6.5, 7, 7.5, 8].map((tick) => (
        <g key={tick}>
          <line x1={readingX(tick)} x2={readingX(tick)} y1={28} y2={126} stroke={GRID} />
          <text x={readingX(tick)} y={18} textAnchor="middle" className={styles.tick}>
            {tick.toFixed(1)}
          </text>
        </g>
      ))}
      {READING_ROWS.map((row) => (
        <g key={row.label}>
          <text x={62} y={row.y + 4} textAnchor="end" className={styles.label}>
            {row.label}
          </text>
          <line
            x1={readingX(row.lo)}
            x2={readingX(row.hi)}
            y1={row.y}
            y2={row.y}
            stroke={WHISKER}
            strokeWidth={1.5}
          />
          <circle
            cx={readingX(row.estimate)}
            cy={row.y}
            r={4.5}
            fill={ACCENT}
            stroke="var(--surface)"
            strokeWidth={2}
          />
        </g>
      ))}
      {/* Country B's hover card, as the page draws one — set past the
          end of its line, so the line shows whole. */}
      <path
        d={`M ${cardX} ${picked.y} l 8 -6 v -14 h 204 v 77 h -204 v -51 z`}
        fill={CARD}
        stroke={GRID}
        className={styles.card}
      />
      <text x={cardX + 18} y={picked.y - 4} className={styles.cardHeading}>
        {picked.label}
      </text>
      <text x={cardX + 18} y={picked.y + 13} className={styles.cardLine}>
        Mean: 7.10 on a 0–10 scale
      </text>
      <text x={cardX + 18} y={picked.y + 30} className={styles.cardLine}>
        95% CI: [6.80, 7.40]
      </text>
      <text x={cardX + 18} y={picked.y + 47} className={styles.cardLine}>
        Based on 412 people
      </text>
      <Badge x={readingX(picked.estimate)} y={picked.y - 16} n={1} />
      <Badge x={readingX(picked.lo)} y={picked.y - 16} n={2} />
      <Badge x={cardX + 204} y={picked.y - 20} n={3} />
    </Figure>
  )
}

// --- Survey weights ---------------------------------------------------------

/** Ten people, seven easy to reach and three hard to reach, on a 5 × 2
 * grid; weighted to a population that is half and half, each easy one
 * counts 5/7 and each hard one 5/3 (dot area ∝ weight). */
const PEOPLE = Array.from({ length: 10 }, (_, index) => ({
  x: 30 + (index % 5) * 35,
  y: index < 5 ? 58 : 94,
  hard: index >= 7,
}))

function WeightingFigure() {
  const radius = (hard: boolean, weighted: boolean) =>
    weighted ? 11 * Math.sqrt(hard ? 5 / 3 : 5 / 7) : 11
  const people = (offset: number, weighted: boolean) =>
    PEOPLE.map((person, index) => (
      <circle
        key={index}
        cx={person.x + offset}
        cy={person.y}
        r={radius(person.hard, weighted)}
        fill={person.hard ? SERIES_2 : ACCENT}
      />
    ))
  return (
    <Figure
      viewBox="0 0 440 160"
      label="Ten people who answered: seven easy to reach, three hard to reach. Weighted to a population that is half and half, each easy-to-reach person counts about 0.7 and each hard-to-reach person about 1.7."
      caption="Seven in ten of the people who answered were easy to reach, though such people are half of the adults. Weighting counts each of them a little less and each harder-to-reach person a little more, so the answers speak for the whole population."
    >
      <text x={105} y={20} textAnchor="middle" className={styles.title}>
        Who answered
      </text>
      <text x={345} y={20} textAnchor="middle" className={styles.title}>
        Who they stand for
      </text>
      {people(0, false)}
      <path
        d="M 202 76 h 30 m -7 -6 l 7 6 l -7 6"
        fill="none"
        stroke={INK_SECONDARY}
        strokeWidth={1.5}
      />
      {people(240, true)}
      <text x={287} y={130} textAnchor="middle" className={styles.label}>
        each ×0.7
      </text>
      <text x={375} y={130} textAnchor="middle" className={styles.label}>
        each ×1.7
      </text>
      <circle cx={6} cy={150} r={5} fill={ACCENT} />
      <text x={16} y={154} className={styles.label}>
        easier to reach
      </text>
      <circle cx={126} cy={150} r={5} fill={SERIES_2} />
      <text x={136} y={154} className={styles.label}>
        harder to reach
      </text>
    </Figure>
  )
}

// --- Which weight, when -----------------------------------------------------

/** Each wave's column centre. */
const WAVE_X: Record<string, number> = { Y1: 222, MY: 318, Y2: 414 }

/** One rule: its weight and who it counts on the left, a dot at each
 * wave it uses, joined (over the midyear when it skips it). */
function WeightRow({ spec, y }: { spec: WeightSpec; y: number }) {
  const xs = spec.waves.map((wave) => WAVE_X[wave] ?? 0)
  const [first = 0, last = 0] = [xs[0], xs[xs.length - 1]]
  const skipsMidyear = spec.waves.length === 2 && spec.waves[0] === 'Y1' && spec.waves[1] === 'Y2'
  return (
    <g>
      <title>{spec.rationale}</title>
      <text x={0} y={y - 2} className={styles.code}>
        {spec.weight}
        {!spec.is_default && <tspan className={styles.label}> (alternative)</tspan>}
      </text>
      <text x={0} y={y + 13} className={styles.label}>
        {eligibleWords(spec)}
      </text>
      {xs.length > 1 &&
        (skipsMidyear ? (
          <path
            d={`M ${first} ${y} Q ${(first + last) / 2} ${y - 26} ${last} ${y}`}
            fill="none"
            stroke={ACCENT}
            strokeWidth={2.5}
          />
        ) : (
          <line x1={first} x2={last} y1={y} y2={y} stroke={ACCENT} strokeWidth={2.5} />
        ))}
      {xs.map((x) => (
        <circle key={x} cx={x} cy={y} r={6} fill={ACCENT} />
      ))}
    </g>
  )
}

function WavesFigure({ meta }: { meta: Meta | undefined }) {
  const global = (meta?.weight_table ?? []).filter((spec) => spec.scope === 'global')
  const single = global.filter((spec) => spec.kind === 'cross_section')
  const panels = global.filter((spec) => spec.kind !== 'cross_section')
  if (global.length === 0) return null
  const rowStep = 38
  const singleTop = 62
  const panelHeading = singleTop + single.length * rowStep + 6
  const panelTop = panelHeading + 34
  const height = panelTop + (panels.length - 1) * rowStep + 26
  return (
    <Figure
      viewBox={`0 0 440 ${height}`}
      label={`Which weight goes with which survey rounds. One round: ${single
        .map((spec) => `${spec.waves.join(', ')} uses ${spec.weight}`)
        .join('; ')}. The same people across rounds: ${panels
        .map((spec) => `${spec.waves.join(' to ')} uses ${spec.weight}`)
        .join('; ')}.`}
      caption="Each row is one rule from the weight table: the weight, who it counts, and the survey rounds it joins. Hover over a row for why that weight."
    >
      {Object.entries(WAVE_X).map(([wave, x]) => (
        <g key={wave}>
          <line x1={x} x2={x} y1={28} y2={height - 6} stroke={GRID} />
          <text x={x} y={16} textAnchor="middle" className={styles.title}>
            {WAVE_CHIPS[wave] ?? wave}
          </text>
        </g>
      ))}
      <text x={0} y={40} className={styles.group}>
        A number from one round
      </text>
      {single.map((spec, index) => (
        <WeightRow key={spec.key} spec={spec} y={singleTop + index * rowStep} />
      ))}
      <text x={0} y={panelHeading} className={styles.group}>
        The same people across rounds
      </text>
      {panels.map((spec, index) => (
        <WeightRow key={spec.key} spec={spec} y={panelTop + index * rowStep} />
      ))}
    </Figure>
  )
}

// --- Confidence intervals and clustering ------------------------------------

/** Twenty-four people sampled one by one: spread over the whole box. */
const SCATTERED = [
  [28, 44],
  [62, 38],
  [104, 46],
  [146, 40],
  [186, 50],
  [40, 70],
  [84, 64],
  [126, 74],
  [168, 66],
  [24, 98],
  [66, 92],
  [108, 100],
  [150, 94],
  [192, 104],
  [46, 124],
  [88, 118],
  [130, 128],
  [172, 120],
  [34, 82],
  [196, 80],
  [116, 56],
  [58, 110],
  [160, 108],
  [94, 84],
] as const

/** The same number of people sampled in four places (two strata, two
 * places each): six around each place's centre. */
const PLACES = [
  [280, 58],
  [368, 60],
  [292, 112],
  [358, 110],
] as const
const AROUND = [
  [0, 0],
  [-9, -7],
  [9, -6],
  [-8, 8],
  [8, 7],
  [0, -12],
] as const

function ClusteringFigure() {
  return (
    <Figure
      viewBox="0 0 440 196"
      label="Left: twenty-four people sampled one by one, spread out; under them, a short line. Right: twenty-four people sampled in four places, two places in each of two strata; under them, a longer line."
      caption="People from the same place tend to answer alike, so a sample gathered in a few places knows less than its size suggests. The confidence interval is computed from the real design, so it is wider for a clustered sample."
    >
      <text x={110} y={18} textAnchor="middle" className={styles.title}>
        Sampled one by one
      </text>
      <text x={330} y={18} textAnchor="middle" className={styles.title}>
        Sampled in places
      </text>
      <rect x={10} y={28} width={200} height={110} fill="none" stroke={GRID} />
      <rect x={230} y={28} width={200} height={110} fill="none" stroke={GRID} />
      <line x1={230} x2={430} y1={84} y2={84} stroke={GRID} strokeDasharray="4 3" />
      <text x={426} y={40} textAnchor="end" className={styles.small}>
        stratum
      </text>
      <text x={426} y={97} textAnchor="end" className={styles.small}>
        stratum
      </text>
      {SCATTERED.map(([x, y], index) => (
        <circle key={index} cx={x} cy={y} r={3.5} fill={ACCENT} />
      ))}
      {PLACES.map(([cx, cy]) => (
        <g key={`${cx}:${cy}`}>
          <circle cx={cx} cy={cy} r={19} fill="none" stroke={INK_MUTED} strokeDasharray="3 2" />
          {AROUND.map(([dx, dy], index) => (
            <circle key={index} cx={cx + dx} cy={cy + dy} r={3.5} fill={ACCENT} />
          ))}
        </g>
      ))}
      <line x1={88} x2={132} y1={160} y2={160} stroke={WHISKER} strokeWidth={1.5} />
      <circle cx={110} cy={160} r={4.5} fill={ACCENT} stroke="var(--surface)" strokeWidth={2} />
      <line x1={282} x2={378} y1={160} y2={160} stroke={WHISKER} strokeWidth={1.5} />
      <circle cx={330} cy={160} r={4.5} fill={ACCENT} stroke="var(--surface)" strokeWidth={2} />
      <text x={110} y={186} textAnchor="middle" className={styles.label}>
        narrower interval
      </text>
      <text x={330} y={186} textAnchor="middle" className={styles.label}>
        wider interval
      </text>
    </Figure>
  )
}

// --- All countries ----------------------------------------------------------

/** Six example countries' correlations on −0.1 to 0.3 (825 px a unit from
 * x = 100); their plain average is +0.10. */
const AVERAGE_ROWS = [0.22, 0.15, 0.12, 0.08, 0.05, -0.02] as const
const averageX = (value: number) => 100 + (value + 0.1) * 825

function AverageFigure() {
  const mean = AVERAGE_ROWS.reduce((sum, value) => sum + value, 0) / AVERAGE_ROWS.length
  const signed = (value: number) =>
    `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(2)}`
  return (
    <Figure
      viewBox="0 0 440 210"
      label={`Six countries' correlations, from ${signed(Math.max(...AVERAGE_ROWS))} down to ${signed(Math.min(...AVERAGE_ROWS))}, and a dashed line at their plain average, ${signed(mean)}, labelled All countries.`}
      caption="All countries is the plain average of the countries' own numbers: every country counts once, whatever its size."
    >
      <line
        x1={averageX(mean)}
        x2={averageX(mean)}
        y1={32}
        y2={178}
        stroke={INK}
        strokeDasharray="3 3"
      />
      <text x={averageX(mean)} y={22} textAnchor="middle" className={styles.cardHeading}>
        All countries {signed(mean)}
      </text>
      <line x1={averageX(0)} x2={averageX(0)} y1={32} y2={178} stroke={INK} />
      {[-0.1, 0.1, 0.2, 0.3].map((tick) => (
        <line key={tick} x1={averageX(tick)} x2={averageX(tick)} y1={32} y2={178} stroke={GRID} />
      ))}
      {[-0.1, 0, 0.1, 0.2, 0.3].map((tick) => (
        <text key={tick} x={averageX(tick)} y={196} textAnchor="middle" className={styles.tick}>
          {tick === 0 ? '0' : signed(tick)}
        </text>
      ))}
      {AVERAGE_ROWS.map((value, index) => {
        const y = 46 + index * 25
        return (
          <g key={index}>
            <text x={90} y={y + 4} textAnchor="end" className={styles.label}>
              Country {String.fromCharCode(65 + index)}
            </text>
            <circle
              cx={averageX(value)}
              cy={y}
              r={5}
              fill={value < 0 ? NEGATIVE : POSITIVE}
              stroke="var(--surface)"
              strokeWidth={2}
            />
          </g>
        )
      })}
    </Figure>
  )
}

// --- Change: the same people ------------------------------------------------

/** Two crowds: different people each year (left). The same six people
 * twice (right), one of whom was not asked again. */
const CROWD_2023 = [44, 62, 80, 98, 116, 134] as const
const CROWD_2024 = [52, 70, 88, 106, 124] as const
const PAIRS = [
  [44, 62],
  [62, 46],
  [80, 100],
  [98, 84],
  [116, 116],
] as const

function ChangeFigure() {
  return (
    <Figure
      viewBox="0 0 440 196"
      label="Left: two different crowds, one asked in 2023 and one in 2024. Right: the same people asked in both years, each joined by a line from their 2023 answer to their 2024 answer; one person was not asked again and is left out."
      caption="Comparing two crowds mixes real change with changes in who answered. The Change page follows the same people: each person's later answer minus their earlier one, averaged with the longitudinal weight."
    >
      <text x={105} y={18} textAnchor="middle" className={styles.title}>
        Two crowds
      </text>
      <text x={335} y={18} textAnchor="middle" className={styles.title}>
        The same people
      </text>
      {CROWD_2023.map((y) => (
        <circle key={y} cx={60} cy={y} r={6} fill={ACCENT} />
      ))}
      {CROWD_2024.map((y) => (
        <circle key={y} cx={150} cy={y} r={6} fill={SERIES_2} />
      ))}
      <text x={105} y={96} textAnchor="middle" className={styles.title}>
        ≠
      </text>
      {PAIRS.map(([from, to]) => (
        <g key={from}>
          <line x1={285} x2={385} y1={from} y2={to} stroke={ACCENT} strokeWidth={1.5} />
          <circle cx={285} cy={from} r={6} fill={ACCENT} />
          <circle cx={385} cy={to} r={6} fill={ACCENT} />
        </g>
      ))}
      <line x1={285} x2={385} y1={134} y2={134} stroke={INK_MUTED} strokeDasharray="3 3" />
      <circle cx={285} cy={134} r={6} fill={ACCENT} />
      <circle cx={385} cy={134} r={5.5} fill="none" stroke={INK_MUTED} strokeWidth={1.5} />
      <text x={385} y={154} textAnchor="middle" className={styles.small}>
        not asked again
      </text>
      {[60, 285].map((x) => (
        <text key={x} x={x} y={176} textAnchor="middle" className={styles.label}>
          2023
        </text>
      ))}
      {[150, 385].map((x) => (
        <text key={x} x={x} y={176} textAnchor="middle" className={styles.label}>
          2024
        </text>
      ))}
    </Figure>
  )
}

export function MethodsFigure({ name, meta }: { name: MethodsFigureName; meta?: Meta }) {
  return (
    <div data-figure={name}>
      {name === 'reading' && <ReadingFigure />}
      {name === 'weighting' && <WeightingFigure />}
      {name === 'waves' && <WavesFigure meta={meta} />}
      {name === 'clustering' && <ClusteringFigure />}
      {name === 'average' && <AverageFigure />}
      {name === 'change' && <ChangeFigure />}
    </div>
  )
}
