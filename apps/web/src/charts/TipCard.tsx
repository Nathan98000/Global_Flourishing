// A hover card drawn in HTML (the matrices' cells, the Correlates list's
// row buttons) in the look of Plot's own tips (theme.ts TIP_OPTIONS):
// its first line, what the mark is, set apart in ink at 600; every
// further line its own line in secondary ink (ADR-0022). The text is the
// same "\n"-joined lines the Plot tips take.

import styles from './TipCard.module.css'
import { split } from './tipLines'

/** The card's lines, for a React tooltip box. */
export function TipCardText({ text }: { text: string }) {
  const [heading, lines] = split(text)
  return (
    <>
      <span className={styles.heading}>{heading}</span>
      {lines.map((line, index) => (
        <span key={index} className={styles.line}>
          {line}
        </span>
      ))}
    </>
  )
}
