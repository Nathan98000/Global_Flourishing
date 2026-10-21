// A hover card's text as lines (TipCard.tsx draws them in React): its
// heading, then the rest; and the same card written into a box built
// outside React (the Correlates list's row buttons, RankedBar.tsx).

import styles from './TipCard.module.css'

/** The heading — what the mark is — and the lines under it. */
export function split(text: string): [string, string[]] {
  const [heading = '', ...lines] = text.split('\n')
  return [heading, lines]
}

/** The card's lines, written into a tooltip box built outside React. */
export function fillTipCard(box: HTMLElement, text: string): void {
  const [heading, lines] = split(text)
  const head = document.createElement('span')
  head.className = styles.heading ?? ''
  head.textContent = heading
  box.replaceChildren(
    head,
    ...lines.map((line) => {
      const span = document.createElement('span')
      span.className = styles.line ?? ''
      span.textContent = line
      return span
    }),
  )
}
