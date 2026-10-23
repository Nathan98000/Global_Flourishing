// A view's state in the controls' own words (ADR-0029): the chart's
// subtitle carries it — "Mean score, 0–10 · 2023 · all countries ·
// highest first" — and so does the phone's summary line. Control words
// only; every data label still comes from the server.

import type { EstimateRow } from '../api/types'
import { listWords } from '../charts/summary'
import { lowerFirst } from '../labels'
import type { SortDir } from '../sortRows'

/** The Countries control's state: "all countries", "3 countries". */
export function countriesPhrase(chosen: number, total: number): string {
  if (chosen === 0 || chosen === total) return 'all countries'
  return `${chosen} ${chosen === 1 ? 'country' : 'countries'}`
}

/** The order's state: "highest first" or "lowest first". */
export function orderPhrase(dir: SortDir): string {
  return dir === 'asc' ? 'lowest first' : 'highest first'
}

/** Clauses joined into one line, empty ones left out. */
export function stateLine(...clauses: (string | false | null | undefined)[]): string {
  return clauses.filter((clause): clause is string => Boolean(clause)).join(' · ')
}

/** The interval level a chart's key names, when its marks carry
 * intervals (a median ships none): the rows' own level. */
export function keyCiLevel(rows: readonly EstimateRow[]): number | undefined {
  const withCI = rows.find((row) => row.ci_lo !== null && row.ci_hi !== null)
  return withCI?.ci_level
}

/** The thin-estimate threshold a chart's key names, when any of its rows
 * is thin (ADR-0031): the server's `meta.suppression.flag_below`. */
export function keyThinBelow(
  rows: readonly Pick<EstimateRow, 'flagged' | 'estimate'>[],
  suppression: { flag_below: number } | undefined,
): number | undefined {
  return suppression &&
    suppression.flag_below > 0 &&
    rows.some((row) => row.flagged && row.estimate !== null)
    ? suppression.flag_below
    : undefined
}

/** What a chart holds, counted in words a listener can place (H3):
 * "1 country", "23 countries", "8 groups" — never "rows" or "cells". */
const UNITS = {
  countries: 'country',
  states: 'state',
  groups: 'group',
  questions: 'question',
} as const

export function countOf(n: number, unit: keyof typeof UNITS): string {
  return `${n} ${n === 1 ? UNITS[unit] : unit}`
}

/** The polite announcement when a view updates (H3): the chart's title,
 * its subtitle — the view's state in the controls' words, so it changes
 * with the year, the statistic, the order, the answer and the countries
 * — then what it holds, counted. "Updated: Secure Flourishing Index —
 * mean score, 0–10 · 2024 · all countries · lowest first. 23 countries." */
export function updatedLine(title: string, subtitle: string, ...counts: string[]): string {
  const state = subtitle ? ` — ${lowerFirst(subtitle)}` : ''
  return `Updated: ${title}${state}. ${counts.join(', ')}.`
}

/** The chosen countries gave no answers to the question (H14): said in
 * place of the chart — "Indonesia has no answers to this question". */
export function noAnswersLine(countries: readonly string[]): string {
  return `${listWords(countries)} ${countries.length === 1 ? 'has' : 'have'} no answers to this question`
}

/** Whether the chosen countries' rows hold no answer at all. */
export function noAnswers(chosen: readonly number[], rows: readonly EstimateRow[]): boolean {
  return chosen.length > 0 && !rows.some((row) => row.estimate !== null)
}
