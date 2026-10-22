// The Methods document's structure, apart from the page's components
// (fast refresh): where docs/METHODS.md asks for a diagram, its sections
// for the contents list, the diagrams by name, and who a weight rule
// counts, in words (ADR-0021).

import type { WeightSpec } from '../../api/types'

/** The diagrams by the name a "figure:" comment in METHODS.md gives. */
export const METHODS_FIGURES = [
  'reading',
  'weighting',
  'waves',
  'clustering',
  'average',
  'change',
] as const
export type MethodsFigureName = (typeof METHODS_FIGURES)[number]

export function isMethodsFigure(name: string): name is MethodsFigureName {
  return (METHODS_FIGURES as readonly string[]).includes(name)
}

/** Where the document asks for a diagram: `<!-- figure: waves -->`, on a
 * line of its own between sections' blocks (never inside a list or a
 * fold — the page is split there). */
const FIGURE_MARK = /<!--\s*figure:\s*([a-z-]+)\s*-->/g

export type MethodsPart = { html: string } | { figure: MethodsFigureName }

/** The rendered document cut at its figure marks: runs of HTML with the
 * diagrams between them. A mark naming no diagram is dropped. */
export function methodsParts(html: string): MethodsPart[] {
  const pieces = html.split(FIGURE_MARK)
  return pieces.flatMap((piece, index): MethodsPart[] => {
    if (index % 2 === 0) return piece.trim() ? [{ html: piece }] : []
    return isMethodsFigure(piece) ? [{ figure: piece }] : []
  })
}

/** The document's sections (its H2s), for the contents list: id and
 * words, markup stripped. */
export function methodsSections(html: string): { id: string; title: string }[] {
  return [...html.matchAll(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g)].map((match) => ({
    id: match[1] ?? '',
    title: (match[2] ?? '')
      .replace(/<[^>]+>/g, '')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&'),
  }))
}

/** Who a rule counts, from its flags: everyone, or the people the flags
 * require — "in Wave 2 and a standalone midyear". */
export function eligibleWords(
  spec: Pick<
    WeightSpec,
    'requires_retained_y2' | 'requires_has_midyear' | 'requires_midyear_type_1'
  >,
): string {
  const midyear = spec.requires_midyear_type_1 ? 'a standalone midyear' : 'the midyear'
  if (spec.requires_retained_y2 && spec.requires_has_midyear) return `in Wave 2 and ${midyear}`
  if (spec.requires_retained_y2) return 'in Wave 2'
  if (spec.requires_has_midyear) return `in ${midyear}`
  return 'everyone'
}
