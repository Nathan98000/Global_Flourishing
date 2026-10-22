// The question bar's controls in the order they render (ADR-0029): each
// control in a `data-bar="question"` row by its label — a legend, or the
// label line above it (the row's note, a <p>, is no control).

export function barLabels(root: ParentNode = document): string[] {
  return [...root.querySelectorAll('[data-bar="question"] > :not(p)')].map(
    (control) => control.querySelector('legend, span')?.textContent?.trim() ?? '',
  )
}
