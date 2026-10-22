// Wave codes in words — the one place the client names a wave (F6):
// titles for subtitles, short chips for controls, and the wave pairs
// the change views compare. Navigation copy, like topics.ts; every data
// label still comes from the server.

import type { Wave } from './api/types'
import type { ChangeLeg } from './api/change'

export const WAVE_TITLES: Record<string, string> = {
  Y1: '2023',
  MY: 'Midyear survey, Nov 2023–Dec 2024',
  Y2: '2024',
}

/** Human chip labels for the wave codes (F6). */
export const WAVE_CHIPS: Record<string, string> = {
  Y1: '2023',
  MY: 'Midyear',
  Y2: '2024',
}

/** The surveys by name, for a sentence ("this question wasn't asked in
 * the midyear survey"). */
export const WAVE_NAMES: Record<string, string> = {
  Y1: '2023',
  MY: 'the midyear survey',
  Y2: '2024',
}

/** What the midyear survey is, in the line under a Year control that
 * offers it. */
export const MIDYEAR_HINT = 'a shorter survey between the two years'

/** That line: "Midyear: a shorter survey between the two years." */
export const MIDYEAR_NOTE = `Midyear: ${MIDYEAR_HINT}.`

/** Why each year that can't be chosen can't, short enough to sit on the
 * Year label's own line (G14) — "Midyear: not asked", "Midyear, 2024:
 * not asked". Every disabled option points to it (RadioRow's `note`). */
export function yearReason(
  options: readonly { value: string; disabled?: boolean }[],
): string | undefined {
  const off = options
    .filter((option) => option.disabled)
    .map((option) => WAVE_MOMENTS[option.value as Wave] ?? option.value)
  return off.length > 0 ? `${off.join(', ')}: not asked` : undefined
}

/** The line under a question bar whose Year offers Midyear: what it is. */
export function yearNote(
  options: readonly { value: string; disabled?: boolean }[],
): string | undefined {
  return options.some((option) => option.value === 'MY' && !option.disabled)
    ? MIDYEAR_NOTE
    : undefined
}

/** The moment in time, for "2023 → Midyear" style pair labels — the
 * same short names the controls use. */
export const WAVE_MOMENTS: Record<Wave, string> = {
  Y1: '2023',
  MY: 'Midyear',
  Y2: '2024',
}

/** "2023 → 2024" — what a comparison is, never "wave pair". */
export function pairTitle(from: Wave, to: Wave, via?: Wave): string {
  return [from, via, to]
    .filter((wave): wave is Wave => wave !== undefined)
    .map((wave) => WAVE_MOMENTS[wave])
    .join(' → ')
}

/** The three-point panel's legs, by what each one is. */
export const LEG_TITLES: Record<ChangeLeg, string> = {
  y1_my: pairTitle('Y1', 'MY'),
  my_y2: pairTitle('MY', 'Y2'),
  y1_y2: pairTitle('Y1', 'Y2'),
}

export function legTitle(leg: string | null | undefined): string {
  if (leg === null || leg === undefined) return '—'
  return (LEG_TITLES as Record<string, string>)[leg] ?? leg
}
