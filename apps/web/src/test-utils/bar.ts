// The question bar's controls in the order they render (ADR-0029): each
// child of a `data-bar="question"` row by its label — a legend, or the
// label line above it.

export function barLabels(root: ParentNode = document): string[] {
  return [...root.querySelectorAll('[data-bar="question"] > *')].map(
    (control) => control.querySelector('legend, span')?.textContent?.trim() ?? '',
  )
}
